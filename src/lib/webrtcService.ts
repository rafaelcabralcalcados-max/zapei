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
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

export interface RealWebRTCSessionHandle {
  callId: string;
  pc: RTCPeerConnection;
  localStream: MediaStream;
  remoteStream: MediaStream;
  switchCamera: () => Promise<MediaStream | null>;
  cleanup: () => void;
}

function createCameraSwitcher(
  pc: RTCPeerConnection,
  getCurrentStream: () => MediaStream,
  setCurrentStream: (next: MediaStream) => void
): () => Promise<MediaStream | null> {
  let facingMode: 'user' | 'environment' = 'user';

  return async () => {
    const currentStream = getCurrentStream();
    const oldVideoTrack = currentStream.getVideoTracks()[0];
    if (!oldVideoTrack) return null;

    const nextFacing: 'user' | 'environment' =
      facingMode === 'user' ? 'environment' : 'user';

    // Stop old track first on mobile devices that only allow one active camera at a time
    oldVideoTrack.stop();

    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      const newVideoTrack = fresh.getVideoTracks()[0];
      if (!newVideoTrack) return null;

      facingMode = nextFacing;
      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(newVideoTrack);
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
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        });
        const fallbackTrack = fallback.getVideoTracks()[0];
        if (fallbackTrack) {
          const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(fallbackTrack);
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
}): Promise<RealWebRTCSessionHandle> {
  let activeLocalStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video:
      params.callType === 'video'
        ? {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : false,
  });

  const remoteStream = new MediaStream();
  const pc = new RTCPeerConnection(RTC_SERVERS);

  activeLocalStream.getTracks().forEach((track) => {
    pc.addTrack(track, activeLocalStream);
  });

  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      event.streams[0].getTracks().forEach((track) => {
        if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
          remoteStream.addTrack(track);
        }
      });
    } else if (event.track) {
      if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
    }
    params.onRemoteStream(new MediaStream(remoteStream.getTracks()));
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

  let remoteDescApplied = false;
  const queuedRemoteCandidates: RTCIceCandidateInit[] = [];

  const unsubCall = onSnapshot(
    callDocRef,
    async (snap) => {
      const data = snap.data();
      if (!data) return;
      if (data.status) {
        params.onStatusChange(data.status);
      }
      if (!remoteDescApplied && data.answerSdp) {
        remoteDescApplied = true;
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'answer', sdp: data.answerSdp })
        );
        for (const c of queuedRemoteCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
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
          if (remoteDescApplied) {
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
    }
  );

  const cleanup = () => {
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
}): Promise<RealWebRTCSessionHandle> {
  let activeLocalStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video:
      params.callType === 'video'
        ? {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : false,
  });

  const remoteStream = new MediaStream();
  const pc = new RTCPeerConnection(RTC_SERVERS);

  activeLocalStream.getTracks().forEach((track) => {
    pc.addTrack(track, activeLocalStream);
  });

  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      event.streams[0].getTracks().forEach((track) => {
        if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
          remoteStream.addTrack(track);
        }
      });
    } else if (event.track) {
      if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
    }
    params.onRemoteStream(new MediaStream(remoteStream.getTracks()));
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

  const unsubCall = onSnapshot(
    callDocRef,
    (snap) => {
      const data = snap.data();
      if (data?.status) {
        params.onStatusChange(data.status);
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
    }
  );

  const cleanup = () => {
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
 * Unlocks BOTH Web Audio API and a persistent HTMLAudioElement on the user's first touch/click.
 * Reusing the exact same primed HTMLAudioElement allows iOS Safari and Android Chrome
 * to play the incoming call ringtone loudly even when the call arrives minutes later.
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
  } catch {
    // Non-fatal
  }
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
