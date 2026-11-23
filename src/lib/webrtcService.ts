import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './firebase';

const RTC_SERVERS: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun.cloudflare.com:3478',
      ],
    },
  ],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 6,
};

export type VideoQualityMode = 'auto' | 'economy' | 'hd';
export type CallNetworkHealth = 'good' | 'fair' | 'poor' | 'reconnecting';

export interface RealWebRTCSessionHandle {
  callId: string;
  pc: RTCPeerConnection;
  localStream: MediaStream;
  remoteStream: MediaStream;
  switchCamera: () => Promise<MediaStream | null>;
  setVideoQualityMode: (mode: VideoQualityMode) => Promise<void>;
  cleanup: () => void;
}

export type SingleMediaPermState = 'granted' | 'prompt' | 'denied' | 'unknown';

export interface MediaPermissionSnapshot {
  mic: SingleMediaPermState;
  cam: SingleMediaPermState;
}

export async function queryMediaPermissionSnapshot(): Promise<MediaPermissionSnapshot> {
  if (
    typeof navigator === 'undefined' ||
    !('permissions' in navigator) ||
    typeof navigator.permissions.query !== 'function'
  ) {
    return { mic: 'unknown', cam: 'unknown' };
  }

  const queryOne = async (name: 'microphone' | 'camera'): Promise<SingleMediaPermState> => {
    try {
      const status = await navigator.permissions.query({
        name: name as PermissionName,
      });
      if (status.state === 'granted' || status.state === 'prompt' || status.state === 'denied') {
        return status.state;
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const [mic, cam] = await Promise.all([queryOne('microphone'), queryOne('camera')]);
  return { mic, cam };
}

/**
 * Requests microphone + camera permission together once so browsers that persist
 * site grants remember both audio and video calls without prompting separately.
 */
export async function preauthorizeMediaPermissions(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return {
      ok: false,
      message: 'Este navegador não suporta acesso à câmera e microfone.',
    };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: 'user' },
    });
    stream.getTracks().forEach((t) => t.stop());
    return {
      ok: true,
      message:
        'Câmera e microfone autorizados! Se o celular ainda perguntar no iPhone, mude Câmera e Microfone de "Perguntar" para "Permitir" nos Ajustes do Safari.',
    };
  } catch (err) {
    // Fallback to audio-only if device has no camera
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStream.getTracks().forEach((t) => t.stop());
      return {
        ok: true,
        message: 'Microfone autorizado com sucesso!',
      };
    } catch {
      const denied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      return {
        ok: false,
        message: denied
          ? 'Permissão negada. Libere Câmera e Microfone nas permissões do site/navegador.'
          : 'Não foi possível acessar a câmera ou microfone neste aparelho.',
      };
    }
  }
}

interface VideoEncodingProfile {
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
}

const VIDEO_PROFILES: Record<'hd' | 'smooth' | 'balanced' | 'economy', VideoEncodingProfile> = {
  hd: { maxBitrate: 1_100_000, maxFramerate: 30, scaleResolutionDownBy: 1.0 },
  smooth: { maxBitrate: 550_000, maxFramerate: 24, scaleResolutionDownBy: 1.0 },
  balanced: { maxBitrate: 340_000, maxFramerate: 20, scaleResolutionDownBy: 1.4 },
  economy: { maxBitrate: 210_000, maxFramerate: 18, scaleResolutionDownBy: 1.9 },
};

function hintVideoMotion(stream: MediaStream): void {
  stream.getVideoTracks().forEach((track) => {
    try {
      if ('contentHint' in track) {
        track.contentHint = 'motion';
      }
    } catch {
      // Ignore on unsupported browsers
    }
  });
}

/**
 * Prioritizes hardware-accelerated H.264 first (native silicon on iPhone & Android)
 * and lightweight VP8 second to prevent software VP9/AV1 CPU throttling & freezing.
 */
function preferHardwareVideoCodec(pc: RTCPeerConnection): void {
  try {
    const caps =
      typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function'
        ? RTCRtpSender.getCapabilities('video')
        : null;
    if (!caps?.codecs?.length) return;

    const h264 = caps.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
    const vp8 = caps.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/vp8');
    const rest = caps.codecs.filter(
      (c) =>
        c.mimeType.toLowerCase() !== 'video/h264' && c.mimeType.toLowerCase() !== 'video/vp8'
    );
    const ordered = [...h264, ...vp8, ...rest];
    if (ordered.length === 0) return;

    pc.getTransceivers().forEach((transceiver) => {
      if (
        transceiver.sender.track?.kind === 'video' &&
        typeof transceiver.setCodecPreferences === 'function'
      ) {
        try {
          transceiver.setCodecPreferences(ordered);
        } catch {
          // Some browsers reject subset codec lists; keep default safely
        }
      }
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Applies smooth mobile video bitrate + maintain-framerate degradation preference,
 * and locks high-priority voice bitrate so audio stays crisp even on weak 4G.
 */
async function applyMediaSenderTuning(
  pc: RTCPeerConnection,
  profile: VideoEncodingProfile
): Promise<void> {
  const senders = pc.getSenders();
  for (const sender of senders) {
    if (!sender.track) continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      if (sender.track.kind === 'video') {
        params.degradationPreference = 'maintain-framerate';
        params.encodings[0].maxBitrate = profile.maxBitrate;
        params.encodings[0].maxFramerate = profile.maxFramerate;
        params.encodings[0].scaleResolutionDownBy = profile.scaleResolutionDownBy;
        params.encodings[0].priority = 'medium';
      } else if (sender.track.kind === 'audio') {
        params.encodings[0].maxBitrate = 32_000;
        params.encodings[0].priority = 'high';
      }

      await sender.setParameters(params);
    } catch {
      // Some mobile browsers ignore individual optional encoding fields
    }
  }
}

async function acquireCallMediaStream(callType: 'audio' | 'video'): Promise<MediaStream> {
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  if (callType === 'audio') {
    return navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    });
  }
  try {
    // Mobile-optimized 480p @ 24fps (WhatsApp sweet spot: ~70% less upload bandwidth & CPU load vs 720p@30)
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: {
        facingMode: 'user',
        width: { ideal: 640, max: 960 },
        height: { ideal: 480, max: 540 },
        frameRate: { ideal: 24, max: 24 },
      },
    });
    hintVideoMotion(stream);
    return stream;
  } catch (err) {
    // Only retry simplified constraints if the failure was OverconstrainedError (not permission denied)
    if (err instanceof DOMException && err.name === 'OverconstrainedError') {
      const fallback = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      hintVideoMotion(fallback);
      return fallback;
    }
    throw err;
  }
}

function createCameraSwitcher(
  pc: RTCPeerConnection,
  getCurrentStream: () => MediaStream,
  setCurrentStream: (next: MediaStream) => void,
  reapplyCurrentQuality: () => Promise<void>
): () => Promise<MediaStream | null> {
  let facingMode: 'user' | 'environment' = 'user';

  return async () => {
    const currentStream = getCurrentStream();
    const oldVideoTrack = currentStream.getVideoTracks()[0];
    if (!oldVideoTrack) return null;

    const currentDeviceId = oldVideoTrack.getSettings?.().deviceId;
    const nextFacing: 'user' | 'environment' =
      facingMode === 'user' ? 'environment' : 'user';

    // Try picking the exact alternate camera deviceId first to avoid re-prompting where possible
    let alternateDeviceId: string | undefined;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
      if (cameras.length >= 2 && currentDeviceId) {
        const other = cameras.find((d) => d.deviceId !== currentDeviceId);
        if (other) alternateDeviceId = other.deviceId;
      }
    } catch {
      // Fall back to facingMode
    }

    // Stop old track first on mobile devices that only allow one active camera at a time
    oldVideoTrack.stop();

    try {
      const videoConstraint: MediaTrackConstraints = alternateDeviceId
        ? {
            deviceId: { exact: alternateDeviceId },
            width: { ideal: 640, max: 960 },
            height: { ideal: 480, max: 540 },
            frameRate: { ideal: 24, max: 24 },
          }
        : {
            facingMode: { ideal: nextFacing },
            width: { ideal: 640, max: 960 },
            height: { ideal: 480, max: 540 },
            frameRate: { ideal: 24, max: 24 },
          };

      const fresh = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: false,
      });
      hintVideoMotion(fresh);
      const newVideoTrack = fresh.getVideoTracks()[0];
      if (!newVideoTrack) return null;

      facingMode = nextFacing;
      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(newVideoTrack);
        void reapplyCurrentQuality();
      }

      const updatedStream = new MediaStream([
        ...currentStream.getAudioTracks(),
        newVideoTrack,
      ]);
      setCurrentStream(updatedStream);
      return updatedStream;
    } catch {
      // Fall back to previous camera if rear/front camera unavailable
      try {
        const fallback = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24 },
          },
          audio: false,
        });
        hintVideoMotion(fallback);
        const fallbackTrack = fallback.getVideoTracks()[0];
        if (fallbackTrack) {
          const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(fallbackTrack);
            void reapplyCurrentQuality();
          }
          const restoredStream = new MediaStream([
            ...currentStream.getAudioTracks(),
            fallbackTrack,
          ]);
          setCurrentStream(restoredStream);
          return restoredStream;
        }
      } catch {
        // ignore
      }
      return null;
    }
  };
}

/**
 * Monitors real-time WebRTC connection stats to smoothly adapt video bitrate/scale
 * before freezing happens, and triggers automatic ICE restart recovery on signal drops.
 */
function attachAdaptiveQualityAndRecovery(params: {
  pc: RTCPeerConnection;
  callType: 'audio' | 'video';
  isCaller: boolean;
  onRequestIceRestart?: () => Promise<void>;
  onNetworkHealthChange?: (health: CallNetworkHealth) => void;
}): {
  setMode: (mode: VideoQualityMode) => Promise<void>;
  reapplyCurrent: () => Promise<void>;
  stop: () => void;
} {
  let mode: VideoQualityMode = 'auto';
  let autoTier: 'smooth' | 'balanced' | 'economy' = 'smooth';
  let healthyStreak = 0;
  let lastPacketsLost = 0;
  let lastPacketsReceived = 0;
  let lastHealth: CallNetworkHealth = 'good';
  let iceRestartTimer: number | null = null;
  let lastIceRestartMs = 0;
  let stopped = false;

  const emitHealth = (next: CallNetworkHealth) => {
    if (next !== lastHealth) {
      lastHealth = next;
      params.onNetworkHealthChange?.(next);
    }
  };

  const getActiveProfile = (): VideoEncodingProfile => {
    if (mode === 'economy') return VIDEO_PROFILES.economy;
    if (mode === 'hd') return VIDEO_PROFILES.hd;
    return VIDEO_PROFILES[autoTier];
  };

  const reapplyCurrent = async () => {
    if (stopped) return;
    await applyMediaSenderTuning(params.pc, getActiveProfile());
  };

  const setMode = async (nextMode: VideoQualityMode) => {
    mode = nextMode;
    if (nextMode === 'auto') {
      autoTier = 'smooth';
      healthyStreak = 0;
    }
    await reapplyCurrent();
  };

  // Automatic ICE recovery when switching Wi-Fi <-> 4G or brief signal drops
  const triggerIceRestartSafe = () => {
    if (stopped || !params.isCaller || !params.onRequestIceRestart) return;
    const now = Date.now();
    if (now - lastIceRestartMs < 8000) return;
    lastIceRestartMs = now;
    void params.onRequestIceRestart().catch(() => {});
  };

  params.pc.oniceconnectionstatechange = () => {
    if (stopped) return;
    const state = params.pc.iceConnectionState;
    if (iceRestartTimer) {
      window.clearTimeout(iceRestartTimer);
      iceRestartTimer = null;
    }

    if (state === 'connected' || state === 'completed') {
      emitHealth('good');
      void reapplyCurrent();
    } else if (state === 'disconnected') {
      emitHealth('reconnecting');
      iceRestartTimer = window.setTimeout(() => {
        if (!stopped && params.pc.iceConnectionState === 'disconnected') {
          triggerIceRestartSafe();
        }
      }, 3500);
    } else if (state === 'failed') {
      emitHealth('reconnecting');
      triggerIceRestartSafe();
    }
  };

  // Periodic adaptive bitrate check (every 2.5s) for smooth anti-freeze video
  const statsInterval = window.setInterval(() => {
    if (stopped || params.pc.iceConnectionState !== 'connected') return;
    void params.pc
      .getStats()
      .then((stats) => {
        if (stopped) return;
        let rttMs = 0;
        let packetsLostNow = 0;
        let packetsRecvNow = 0;
        let limited = false;

        stats.forEach((report) => {
          if (
            report.type === 'candidate-pair' &&
            (report as RTCIceCandidatePairStats).state === 'succeeded' &&
            typeof (report as RTCIceCandidatePairStats).currentRoundTripTime === 'number'
          ) {
            rttMs = Math.max(
              rttMs,
              ((report as RTCIceCandidatePairStats).currentRoundTripTime || 0) * 1000
            );
          }
          if (report.type === 'outbound-rtp' && (report as { kind?: string }).kind === 'video') {
            const reason = (report as { qualityLimitationReason?: string })
              .qualityLimitationReason;
            if (reason === 'bandwidth' || reason === 'cpu') {
              limited = true;
            }
          }
          if (report.type === 'inbound-rtp' && (report as { kind?: string }).kind === 'video') {
            packetsLostNow += Number((report as { packetsLost?: number }).packetsLost || 0);
            packetsRecvNow += Number((report as { packetsReceived?: number }).packetsReceived || 0);
          }
        });

        const deltaLost = Math.max(0, packetsLostNow - lastPacketsLost);
        const deltaRecv = Math.max(0, packetsRecvNow - lastPacketsReceived);
        lastPacketsLost = packetsLostNow;
        lastPacketsReceived = packetsRecvNow;
        const lossRatio = deltaRecv + deltaLost > 0 ? deltaLost / (deltaRecv + deltaLost) : 0;

        const isPoor = lossRatio > 0.05 || rttMs > 420;
        const isFair = !isPoor && (lossRatio > 0.02 || rttMs > 240 || limited);

        if (isPoor) {
          emitHealth('poor');
          healthyStreak = 0;
          if (params.callType === 'video' && mode === 'auto' && autoTier !== 'economy') {
            autoTier = autoTier === 'smooth' ? 'balanced' : 'economy';
            void reapplyCurrent();
          }
        } else if (isFair) {
          emitHealth('fair');
          healthyStreak = 0;
          if (params.callType === 'video' && mode === 'auto' && autoTier === 'smooth') {
            autoTier = 'balanced';
            void reapplyCurrent();
          }
        } else {
          emitHealth('good');
          healthyStreak += 1;
          if (
            params.callType === 'video' &&
            mode === 'auto' &&
            autoTier !== 'smooth' &&
            healthyStreak >= 3
          ) {
            autoTier = autoTier === 'economy' ? 'balanced' : 'smooth';
            healthyStreak = 0;
            void reapplyCurrent();
          }
        }
      })
      .catch(() => {});
  }, 2500);

  return {
    setMode,
    reapplyCurrent,
    stop: () => {
      stopped = true;
      window.clearInterval(statsInterval);
      if (iceRestartTimer) window.clearTimeout(iceRestartTimer);
    },
  };
}

/**
 * Starts a REAL outgoing WebRTC audio or video call via getUserMedia + RTCPeerConnection + Firestore signaling.
 */
export async function startRealOutgoingCall(params: {
  db: Firestore;
  callerId: string;
  callerName: string;
  callerInitials: string;
  callerAvatarColor: string;
  calleeId: string;
  calleeName: string;
  calleeInitials: string;
  calleeAvatarColor: string;
  callType: 'audio' | 'video';
  onRemoteStream: (stream: MediaStream) => void;
  onStatusChange: (status: 'ringing' | 'active' | 'ended' | 'declined' | 'missed') => void;
  onNetworkHealthChange?: (health: CallNetworkHealth) => void;
}): Promise<RealWebRTCSessionHandle> {
  let activeLocalStream = await acquireCallMediaStream(params.callType);

  const remoteStream = new MediaStream();
  const pc = new RTCPeerConnection(RTC_SERVERS);

  activeLocalStream.getTracks().forEach((track) => {
    pc.addTrack(track, activeLocalStream);
  });

  if (params.callType === 'video') {
    preferHardwareVideoCodec(pc);
  }
  await applyMediaSenderTuning(pc, VIDEO_PROFILES.smooth);

  pc.ontrack = (event) => {
    let added = false;
    if (event.streams && event.streams[0]) {
      event.streams[0].getTracks().forEach((track) => {
        if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
          remoteStream.addTrack(track);
          added = true;
        }
      });
    } else if (event.track) {
      if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
        added = true;
      }
    }
    if (added) {
      params.onRemoteStream(remoteStream);
    }
  };

  const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const callDocRef = doc(params.db, 'calls', callId);
  const callerCandidatesRef = collection(params.db, 'calls', callId, 'callerCandidates');
  const calleeCandidatesRef = collection(params.db, 'calls', callId, 'calleeCandidates');

  const pendingIce: RTCIceCandidate[] = [];
  let callDocCreated = false;

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    if (!callDocCreated) {
      pendingIce.push(event.candidate);
      return;
    }
    const candId = `cand_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    void setDoc(doc(callerCandidatesRef, candId), {
      senderId: params.callerId,
      receiverId: params.calleeId,
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid ?? '',
      sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0,
      createdAt: serverTimestamp(),
    }).catch((err) => {
      console.error('ICE write failed:', err);
    });
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  try {
    await setDoc(callDocRef, {
      callerId: params.callerId,
      callerName: params.callerName.slice(0, 80),
      callerInitials: params.callerInitials.slice(0, 4),
      callerAvatarColor: params.callerAvatarColor.slice(0, 20),
      calleeId: params.calleeId,
      calleeName: params.calleeName.slice(0, 80),
      calleeInitials: params.calleeInitials.slice(0, 4),
      calleeAvatarColor: params.calleeAvatarColor.slice(0, 20),
      callType: params.callType,
      status: 'ringing',
      offerSdp: offer.sdp || '',
      durationLabel: '00:00',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    callDocCreated = true;
  } catch (error) {
    activeLocalStream.getTracks().forEach((t) => t.stop());
    pc.close();
    handleFirestoreError(error, OperationType.CREATE, `calls/${callId}`);
  }

  for (const cand of pendingIce) {
    const candId = `cand_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    void setDoc(doc(callerCandidatesRef, candId), {
      senderId: params.callerId,
      receiverId: params.calleeId,
      candidate: cand.candidate,
      sdpMid: cand.sdpMid ?? '',
      sdpMLineIndex: cand.sdpMLineIndex ?? 0,
      createdAt: serverTimestamp(),
    }).catch(() => {});
  }

  let lastAppliedAnswerSdp = '';
  const queuedRemoteCandidates: RTCIceCandidateInit[] = [];

  const adaptive = attachAdaptiveQualityAndRecovery({
    pc,
    callType: params.callType,
    isCaller: true,
    onNetworkHealthChange: params.onNetworkHealthChange,
    onRequestIceRestart: async () => {
      if (pc.signalingState !== 'stable') return;
      const restartOffer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(restartOffer);
      await updateDoc(callDocRef, {
        offerSdp: restartOffer.sdp || '',
        updatedAt: serverTimestamp(),
      });
    },
  });

  const unsubCall = onSnapshot(
    callDocRef,
    async (snap) => {
      const data = snap.data();
      if (!data) return;
      if (data.status) {
        params.onStatusChange(data.status);
      }
      if (
        typeof data.answerSdp === 'string' &&
        data.answerSdp &&
        data.answerSdp !== lastAppliedAnswerSdp &&
        pc.signalingState === 'have-local-offer'
      ) {
        const isFirstAnswer = !lastAppliedAnswerSdp;
        lastAppliedAnswerSdp = data.answerSdp;
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'answer', sdp: data.answerSdp })
        );
        if (isFirstAnswer) {
          for (const c of queuedRemoteCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          queuedRemoteCandidates.length = 0;
        }
        void adaptive.reapplyCurrent();
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `calls/${callId}`);
    }
  );

  const calleeCandQuery = query(
    calleeCandidatesRef,
    where('receiverId', '==', params.callerId)
  );
  const unsubCandidates = onSnapshot(
    calleeCandQuery,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const d = change.doc.data();
          const candInit: RTCIceCandidateInit = {
            candidate: d.candidate,
            sdpMid: d.sdpMid,
            sdpMLineIndex: d.sdpMLineIndex,
          };
          if (lastAppliedAnswerSdp) {
            void pc.addIceCandidate(new RTCIceCandidate(candInit)).catch(() => {});
          } else {
            queuedRemoteCandidates.push(candInit);
          }
        }
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `calls/${callId}/calleeCandidates`);
    }
  );

  const switchCamera = createCameraSwitcher(
    pc,
    () => activeLocalStream,
    (next) => {
      activeLocalStream = next;
    },
    adaptive.reapplyCurrent
  );

  const cleanup = () => {
    adaptive.stop();
    unsubCall();
    unsubCandidates();
    activeLocalStream.getTracks().forEach((t) => t.stop());
    pc.close();
  };

  return {
    callId,
    pc,
    get localStream() {
      return activeLocalStream;
    },
    remoteStream,
    switchCamera,
    setVideoQualityMode: adaptive.setMode,
    cleanup,
  };
}

/**
 * Answers a REAL incoming WebRTC call with real microphone/camera capture and ICE signaling.
 */
export async function answerRealIncomingCall(params: {
  db: Firestore;
  callId: string;
  callerId: string;
  calleeId: string;
  callType: 'audio' | 'video';
  offerSdp: string;
  onRemoteStream: (stream: MediaStream) => void;
  onStatusChange: (status: 'ringing' | 'active' | 'ended' | 'declined' | 'missed') => void;
  onNetworkHealthChange?: (health: CallNetworkHealth) => void;
}): Promise<RealWebRTCSessionHandle> {
  let activeLocalStream = await acquireCallMediaStream(params.callType);

  const remoteStream = new MediaStream();
  const pc = new RTCPeerConnection(RTC_SERVERS);

  activeLocalStream.getTracks().forEach((track) => {
    pc.addTrack(track, activeLocalStream);
  });

  if (params.callType === 'video') {
    preferHardwareVideoCodec(pc);
  }
  await applyMediaSenderTuning(pc, VIDEO_PROFILES.smooth);

  pc.ontrack = (event) => {
    let added = false;
    if (event.streams && event.streams[0]) {
      event.streams[0].getTracks().forEach((track) => {
        if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
          remoteStream.addTrack(track);
          added = true;
        }
      });
    } else if (event.track) {
      if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
        added = true;
      }
    }
    if (added) {
      params.onRemoteStream(remoteStream);
    }
  };

  const callDocRef = doc(params.db, 'calls', params.callId);
  const callerCandidatesRef = collection(params.db, 'calls', params.callId, 'callerCandidates');
  const calleeCandidatesRef = collection(params.db, 'calls', params.callId, 'calleeCandidates');

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const candId = `cand_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    void setDoc(doc(calleeCandidatesRef, candId), {
      senderId: params.calleeId,
      receiverId: params.callerId,
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid ?? '',
      sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0,
      createdAt: serverTimestamp(),
    }).catch(() => {});
  };

  let lastAppliedOfferSdp = params.offerSdp;

  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: params.offerSdp })
  );
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  try {
    await updateDoc(callDocRef, {
      status: 'active',
      answerSdp: answer.sdp || '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    activeLocalStream.getTracks().forEach((t) => t.stop());
    pc.close();
    handleFirestoreError(error, OperationType.UPDATE, `calls/${params.callId}`);
  }

  const adaptive = attachAdaptiveQualityAndRecovery({
    pc,
    callType: params.callType,
    isCaller: false,
    onNetworkHealthChange: params.onNetworkHealthChange,
  });
  void adaptive.reapplyCurrent();

  const unsubCall = onSnapshot(
    callDocRef,
    async (snap) => {
      const data = snap.data();
      if (data?.status) {
        params.onStatusChange(data.status);
      }
      // Seamlessly accept caller's automatic ICE restart renegotiation offer if network changed
      if (
        data?.status === 'active' &&
        typeof data.offerSdp === 'string' &&
        data.offerSdp &&
        data.offerSdp !== lastAppliedOfferSdp &&
        pc.signalingState === 'stable'
      ) {
        lastAppliedOfferSdp = data.offerSdp;
        try {
          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'offer', sdp: data.offerSdp })
          );
          const restartAnswer = await pc.createAnswer();
          await pc.setLocalDescription(restartAnswer);
          await updateDoc(callDocRef, {
            answerSdp: restartAnswer.sdp || '',
            updatedAt: serverTimestamp(),
          });
          void adaptive.reapplyCurrent();
        } catch {
          // Ignore transient renegotiation collisions
        }
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `calls/${params.callId}`);
    }
  );

  const callerCandQuery = query(
    callerCandidatesRef,
    where('receiverId', '==', params.calleeId)
  );
  const unsubCandidates = onSnapshot(
    callerCandQuery,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const d = change.doc.data();
          void pc
            .addIceCandidate(
              new RTCIceCandidate({
                candidate: d.candidate,
                sdpMid: d.sdpMid,
                sdpMLineIndex: d.sdpMLineIndex,
              })
            )
            .catch(() => {});
        }
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `calls/${params.callId}/callerCandidates`);
    }
  );

  const switchCamera = createCameraSwitcher(
    pc,
    () => activeLocalStream,
    (next) => {
      activeLocalStream = next;
    },
    adaptive.reapplyCurrent
  );

  const cleanup = () => {
    adaptive.stop();
    unsubCall();
    unsubCandidates();
    activeLocalStream.getTracks().forEach((t) => t.stop());
    pc.close();
  };

  return {
    callId: params.callId,
    pc,
    get localStream() {
      return activeLocalStream;
    },
    remoteStream,
    switchCamera,
    setVideoQualityMode: adaptive.setMode,
    cleanup,
  };
}

export async function updateRealCallStatus(
  db: Firestore,
  callId: string,
  status: 'ended' | 'declined' | 'missed',
  durationLabel: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'calls', callId), {
      status,
      durationLabel,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Call may already be in terminal state (ended/declined) from the remote peer
  }
}

let sharedAudioCtx: AudioContext | null = null;
let cachedRingtoneUrl: string | null = null;
let primedRingtoneEl: HTMLAudioElement | null = null;
let ringtoneElementPrimed = false;
let isCurrentlyRinging = false;
let cachedMsgChimeUrl: string | null = null;
let primedMsgChimeEl: HTMLAudioElement | null = null;
let msgChimeElementPrimed = false;
let lastMsgChimeMs = 0;
let audioCtxUnlocked = false;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
    return sharedAudioCtx;
  }
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  sharedAudioCtx = new AudioCtx();
  return sharedAudioCtx;
}

/**
 * Generates a real, loud PCM WAV ringtone Blob URL so mobile Safari/Chrome
 * plays an unmistakable classic phone ring via HTMLAudioElement.
 */
function getRingtoneWavUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (cachedRingtoneUrl) return cachedRingtoneUrl;
  try {
    const sampleRate = 22050;
    const durationSec = 2.0;
    const numSamples = Math.floor(sampleRate * durationSec);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i += 1) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Loud two-burst melodic phone ring (0.00-0.44s, 0.52-0.98s, pause until 2.0s)
    for (let i = 0; i < numSamples; i += 1) {
      const t = i / sampleRate;
      let sample = 0;
      const inFirst = t >= 0.0 && t < 0.44;
      const inSecond = t >= 0.52 && t < 0.98;
      if (inFirst || inSecond) {
        const localT = inFirst ? t : t - 0.52;
        const burstLen = inFirst ? 0.44 : 0.46;
        const attack = Math.min(1, localT / 0.015);
        const release = Math.min(1, Math.max(0, (burstLen - localT) / 0.05));
        const env = attack * release;
        const f1 = inFirst ? 659.25 : 783.99; // E5 -> G5
        const f2 = inFirst ? 880.0 : 1046.5; // A5 -> C6
        const trillo = 0.8 + 0.2 * Math.sin(2 * Math.PI * 20 * localT);
        sample =
          0.55 *
          env *
          trillo *
          (Math.sin(2 * Math.PI * f1 * t) + 0.75 * Math.sin(2 * Math.PI * f2 * t));
      }
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    cachedRingtoneUrl = URL.createObjectURL(blob);
    return cachedRingtoneUrl;
  } catch {
    return null;
  }
}

function getOrCreatePrimedAudioElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (primedRingtoneEl) return primedRingtoneEl;
  const wavUrl = getRingtoneWavUrl();
  if (!wavUrl) return null;
  const el = new Audio(wavUrl);
  el.loop = true;
  el.preload = 'auto';
  primedRingtoneEl = el;
  return el;
}

/**
 * Generates a crisp, unmistakable two-note WhatsApp-style message chime WAV Blob URL
 * so mobile Safari/Chrome plays message alerts loudly via a primed HTMLAudioElement.
 */
function getMessageChimeWavUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (cachedMsgChimeUrl) return cachedMsgChimeUrl;
  try {
    const sampleRate = 22050;
    const durationSec = 0.42;
    const numSamples = Math.floor(sampleRate * durationSec);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i += 1) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Bright two-note marimba/pop chime: Note 1 (0.00-0.11s, A5), Note 2 (0.12-0.38s, D6)
    for (let i = 0; i < numSamples; i += 1) {
      const t = i / sampleRate;
      let sample = 0;
      if (t >= 0 && t < 0.115) {
        const lt = t;
        const env = Math.min(1, lt / 0.008) * Math.exp(-lt * 22);
        sample +=
          0.72 *
          env *
          (Math.sin(2 * Math.PI * 880 * lt) + 0.35 * Math.sin(2 * Math.PI * 1760 * lt));
      }
      if (t >= 0.115 && t < 0.41) {
        const lt = t - 0.115;
        const env = Math.min(1, lt / 0.008) * Math.exp(-lt * 13);
        sample +=
          0.78 *
          env *
          (Math.sin(2 * Math.PI * 1174.66 * lt) + 0.35 * Math.sin(2 * Math.PI * 2349.32 * lt));
      }
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    cachedMsgChimeUrl = URL.createObjectURL(blob);
    return cachedMsgChimeUrl;
  } catch {
    return null;
  }
}

function getOrCreatePrimedMessageChimeElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (primedMsgChimeEl) return primedMsgChimeEl;
  const wavUrl = getMessageChimeWavUrl();
  if (!wavUrl) return null;
  const el = new Audio(wavUrl);
  el.loop = false;
  el.preload = 'auto';
  primedMsgChimeEl = el;
  return el;
}

/**
 * Unlocks Web Audio API AND persistent HTMLAudioElements (ringtone + message chime)
 * on the user's first touch/click so iOS Safari and Android Chrome play both loudly.
 */
export function unlockCallAudio(): void {
  try {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    if (ctx && !audioCtxUnlocked) {
      const silentBuf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = silentBuf;
      src.connect(ctx.destination);
      src.start(0);
      audioCtxUnlocked = true;
    }

    const el = getOrCreatePrimedAudioElement();
    if (el && !ringtoneElementPrimed && !isCurrentlyRinging) {
      el.muted = true;
      el.volume = 0;
      const p = el.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          ringtoneElementPrimed = true;
          if (!isCurrentlyRinging) {
            el.pause();
            el.currentTime = 0;
            el.muted = false;
            el.volume = 1.0;
          }
        }).catch(() => {
          // Will retry on next user tap
        });
      }
    }

    const msgEl = getOrCreatePrimedMessageChimeElement();
    if (msgEl && !msgChimeElementPrimed) {
      msgEl.muted = true;
      msgEl.volume = 0;
      const mp = msgEl.play();
      if (mp && typeof mp.then === 'function') {
        mp.then(() => {
          msgChimeElementPrimed = true;
          msgEl.pause();
          msgEl.currentTime = 0;
          msgEl.muted = false;
          msgEl.volume = 1.0;
        }).catch(() => {
          // Will retry on next user tap
        });
      }
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Plays a crisp, loud WhatsApp-style double-note notification chime + short vibration
 * when a new text, audio, or photo message arrives.
 */
export function playMessageNotificationSound(force = false): void {
  if (typeof window === 'undefined') return;
  const nowMs = Date.now();
  if (!force && nowMs - lastMsgChimeMs < 350) return;
  lastMsgChimeMs = nowMs;

  // Short crisp haptic feedback on Android
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([120, 60, 120]);
    }
  } catch {
    // Ignore on iOS / unsupported devices
  }

  // Primary path: primed HTMLAudioElement (most reliable on mobile Safari & Android Chrome)
  const el = getOrCreatePrimedMessageChimeElement();
  let playedHtml = false;
  if (el) {
    try {
      el.muted = false;
      el.volume = 1.0;
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.then === 'function') {
        playedHtml = true;
        p.catch(() => {
          playMessageChimeWebAudioFallback();
        });
      }
    } catch {
      playedHtml = false;
    }
  }

  if (!playedHtml) {
    playMessageChimeWebAudioFallback();
  }
}

function playMessageChimeWebAudioFallback(): void {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
  try {
    const now = ctx.currentTime;
    const playNote = (offset: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.linearRampToValueAtTime(0.32, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + dur + 0.02);
    };
    playNote(0, 880, 0.11);
    playNote(0.115, 1174.66, 0.24);
  } catch {
    // Non-fatal
  }
}

/**
 * Plays a soft, subtle WhatsApp-style pop when the user sends a message.
 */
export function playMessageSentSound(): void {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(780, now + 0.06);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {
    // Non-fatal
  }
}

/**
 * Plays the message notification chime immediately on tap so the user can test it.
 */
export function testMessageNotificationSound(): void {
  unlockCallAudio();
  playMessageNotificationSound(true);
}

export function installAudioUnlockListeners(): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    unlockCallAudio();
  };
  const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'click', 'keydown'];
  events.forEach((ev) => window.addEventListener(ev, handler, { passive: true }));
  return () => {
    events.forEach((ev) => window.removeEventListener(ev, handler));
  };
}

/**
 * Plays a 2-second test ringtone on user tap so the user can confirm their phone speaker rings.
 */
export function testRingtoneSound(): void {
  unlockCallAudio();
  const stop = startRingtoneAudio();
  window.setTimeout(() => {
    stop();
  }, 2100);
}

/**
 * Plays a loud, clear incoming call ringtone (primed HTMLAudioElement + Web Audio fallback + Android vibration).
 */
export function startRingtoneAudio(
  onBlockedChange?: (blocked: boolean) => void
): () => void {
  let stopped = false;
  let webAudioInterval: number | null = null;
  let vibrateInterval: number | null = null;
  let htmlAudioPlaying = false;
  isCurrentlyRinging = true;

  // 1. Trigger continuous vibration on supported Android phones
  const doVibrate = () => {
    if (stopped) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([550, 220, 550, 220, 550]);
      }
    } catch {
      // Ignore on iOS / unsupported devices
    }
  };
  doVibrate();
  vibrateInterval = window.setInterval(doVibrate, 2400);

  // 2. Reuse the SAME primed HTMLAudioElement (critical for iOS Safari & Android Chrome!)
  const el = getOrCreatePrimedAudioElement();
  if (el) {
    try {
      el.loop = true;
      el.muted = false;
      el.volume = 1.0;
      el.currentTime = 0;
      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (stopped) {
              el.pause();
              return;
            }
            htmlAudioPlaying = true;
            onBlockedChange?.(false);
          })
          .catch(() => {
            // Fall back to unlocked Web Audio context below
          });
      }
    } catch {
      // Fall back to Web Audio below
    }
  }

  // 3. Web Audio dual-tone ringtone fallback (fires if HTMLAudio was blocked)
  const ctx = getOrCreateAudioContext();
  if (ctx) {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const pulseWebAudio = () => {
      if (stopped || htmlAudioPlaying) return;
      if (ctx.state === 'suspended') {
        onBlockedChange?.(true);
        void ctx.resume().catch(() => {});
        return;
      }
      onBlockedChange?.(false);
      const now = ctx.currentTime;
      const playBurst = (startOffset: number, freqA: number, freqB: number) => {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = 'sine';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(freqA, now + startOffset);
        osc2.frequency.setValueAtTime(freqB, now + startOffset);
        gain.gain.setValueAtTime(0.001, now + startOffset);
        gain.gain.linearRampToValueAtTime(0.36, now + startOffset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + 0.42);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(now + startOffset);
        osc2.start(now + startOffset);
        osc1.stop(now + startOffset + 0.44);
        osc2.stop(now + startOffset + 0.44);
      };
      playBurst(0, 659.25, 880.0);
      playBurst(0.5, 783.99, 1046.5);
    };

    window.setTimeout(pulseWebAudio, 150);
    webAudioInterval = window.setInterval(pulseWebAudio, 2000);
  }

  return () => {
    stopped = true;
    isCurrentlyRinging = false;
    if (webAudioInterval) window.clearInterval(webAudioInterval);
    if (vibrateInterval) window.clearInterval(vibrateInterval);
    if (el) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {
        // Ignore
      }
    }
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(0);
      }
    } catch {
      // Ignore
    }
  };
}

/**
 * Plays a classic Brazilian/ITU-T calling ringback tone ("tuuu... tuuu...")
 * for the caller while waiting for the other phone to answer.
 */
export function startRingbackToneAudio(): () => void {
  let stopped = false;
  let interval: number | null = null;
  const ctx = getOrCreateAudioContext();
  if (!ctx) return () => {};

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }

  const pulse = () => {
    if (stopped || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(425, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.04);
    gain.gain.setValueAtTime(0.16, now + 0.9);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1.05);
  };

  pulse();
  interval = window.setInterval(pulse, 3600);

  return () => {
    stopped = true;
    if (interval) window.clearInterval(interval);
  };
}
