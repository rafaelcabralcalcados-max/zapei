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
  cleanup: () => void;
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
  const localStream = await navigator.mediaDevices.getUserMedia({
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

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
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
    localStream.getTracks().forEach((t) => t.stop());
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

  const cleanup = () => {
    unsubCall();
    unsubCandidates();
    localStream.getTracks().forEach((t) => t.stop());
    pc.close();
  };

  return { callId, pc, localStream, remoteStream, cleanup };
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
  const localStream = await navigator.mediaDevices.getUserMedia({
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

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
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
    localStream.getTracks().forEach((t) => t.stop());
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

  const cleanup = () => {
    unsubCall();
    unsubCandidates();
    localStream.getTracks().forEach((t) => t.stop());
    pc.close();
  };

  return { callId: params.callId, pc, localStream, remoteStream, cleanup };
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

/**
 * Plays a real subtle acoustic ringtone via Web Audio API while an incoming call is ringing.
 */
export function startRingtoneAudio(): () => void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    let stopped = false;

    const pulse = () => {
      if (stopped) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.52);
    };

    pulse();
    const interval = window.setInterval(pulse, 1600);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      void ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}
