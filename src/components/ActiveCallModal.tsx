import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { startRingtoneAudio } from '../lib/webrtcService';

export interface ActiveCallUIState {
  callId: string;
  direction: 'outgoing' | 'incoming';
  callType: 'audio' | 'video';
  peerId: string;
  peerName: string;
  peerInitials: string;
  peerAvatarColor: string;
  status: 'ringing' | 'connecting' | 'active' | 'ended' | 'declined' | 'missed';
  offerSdp?: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  errorMessage?: string;
}

interface ActiveCallModalProps {
  call: ActiveCallUIState;
  onAcceptIncoming: () => void;
  onDeclineIncoming: () => void;
  onEndCall: (durationLabel: string) => void;
}

export const ActiveCallModal: React.FC<ActiveCallModalProps> = ({
  call,
  onAcceptIncoming,
  onDeclineIncoming,
  onEndCall,
}) => {
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Real acoustic ringtone while an incoming call is ringing
  useEffect(() => {
    if (call.direction === 'incoming' && call.status === 'ringing') {
      const stopRingtone = startRingtoneAudio();
      return () => stopRingtone();
    }
    return undefined;
  }, [call.direction, call.status]);

  // Real duration clock starts ONLY when WebRTC session is active
  useEffect(() => {
    if (call.status !== 'active') {
      setSeconds(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [call.status]);

  // Attach real local MediaStream to preview video element whenever it mounts/updates
  useEffect(() => {
    if (localVideoRef.current && call.localStream) {
      localVideoRef.current.srcObject = call.localStream;
      void localVideoRef.current.play().catch(() => {});
    }
  }, [call.localStream, call.status, call.callType, cameraOff]);

  // Attach real remote MediaStream to audio & video elements whenever they mount/update
  useEffect(() => {
    if (remoteAudioRef.current && call.remoteStream) {
      remoteAudioRef.current.srcObject = call.remoteStream;
      remoteAudioRef.current.muted = remoteMuted;
      void remoteAudioRef.current.play().catch(() => {});
    }
    if (remoteVideoRef.current && call.remoteStream) {
      remoteVideoRef.current.srcObject = call.remoteStream;
      void remoteVideoRef.current.play().catch(() => {});
    }
  }, [call.remoteStream, call.status, call.callType, remoteMuted]);

  const formattedTime = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  const toggleMicrophone = () => {
    if (!call.localStream) return;
    const nextMuted = !muted;
    call.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  };

  const toggleCamera = () => {
    if (!call.localStream) return;
    const nextOff = !cameraOff;
    call.localStream.getVideoTracks().forEach((track) => {
      track.enabled = !nextOff;
    });
    setCameraOff(nextOff);
  };

  const toggleRemoteAudio = () => {
    const next = !remoteMuted;
    setRemoteMuted(next);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = next;
    }
  };

  const statusText = () => {
    if (call.errorMessage) return 'Permissão necessária';
    if (call.direction === 'incoming' && call.status === 'ringing') {
      return call.callType === 'video'
        ? 'Chamada de vídeo recebida...'
        : 'Ligação de voz recebida...';
    }
    if (call.direction === 'outgoing' && call.status === 'ringing') {
      return 'Chamando via áudio/vídeo em tempo real...';
    }
    if (call.status === 'connecting') {
      return 'Estabelecendo conexão WebRTC P2P...';
    }
    if (call.status === 'active') {
      return formattedTime;
    }
    if (call.status === 'declined') return 'Chamada recusada';
    if (call.status === 'missed') return 'Chamada não atendida';
    return 'Chamada encerrada';
  };

  const isVideoActive = call.callType === 'video' && call.status === 'active';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071924]/95 backdrop-blur-md p-4">
      {/* Hidden real remote audio playback element */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#0D2B3E] via-[#0B2231] to-[#081721] text-white shadow-2xl">
        {/* Remote Video Full Background when video call is active */}
        {isVideoActive && (
          <div className="relative h-80 w-full bg-black">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="h-full w-full object-cover"
            />
            {call.localStream && !cameraOff && (
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="absolute bottom-3 right-3 h-28 w-20 rounded-xl border border-white/25 object-cover shadow-lg"
              />
            )}
            <div className="absolute left-3 top-3 rounded-lg bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {call.peerName} · <span className="font-mono tabular-nums">{formattedTime}</span>
            </div>
          </div>
        )}

        {/* Header & Avatar (for audio calls, ringing state, or local preview while calling) */}
        {!isVideoActive && (
          <div className="px-6 pt-8 pb-6 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-medium tracking-wide text-emerald-300/90 uppercase">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              {call.callType === 'video' ? 'Zapei Vídeo P2P' : 'Zapei Voz P2P'}
            </div>

            {call.callType === 'video' && call.localStream && !cameraOff ? (
              <div className="mx-auto mt-5 h-52 w-full overflow-hidden rounded-2xl border border-white/15 bg-black">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div
                className="mx-auto mt-6 flex h-24 w-24 items-center justify-center rounded-full text-2xl font-bold text-white shadow-lg ring-4 ring-white/10"
                style={{ backgroundColor: call.peerAvatarColor || '#0F5132' }}
              >
                {call.peerInitials}
              </div>
            )}

            <h2 className="mt-4 text-xl font-bold tracking-tight text-white">
              {call.peerName}
            </h2>
            <p className="mt-1 font-mono text-sm text-slate-300 tabular-nums">
              {statusText()}
            </p>
          </div>
        )}

        {/* Error Box (e.g., mic/camera permission denied) */}
        {call.errorMessage && (
          <div className="mx-6 mb-4 rounded-xl border border-amber-400/30 bg-amber-500/15 p-3.5 text-left text-xs text-amber-100">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{call.errorMessage}</p>
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="border-t border-white/10 bg-black/25 px-6 py-5">
          {call.direction === 'incoming' && call.status === 'ringing' && !call.errorMessage ? (
            <div className="flex items-center justify-around gap-4">
              <button
                type="button"
                onClick={onDeclineIncoming}
                className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                <PhoneOff className="h-5 w-5" />
                Recusar
              </button>
              <button
                type="button"
                onClick={onAcceptIncoming}
                className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#0F5132] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#146c43]"
              >
                {call.callType === 'video' ? (
                  <Video className="h-5 w-5" />
                ) : (
                  <Phone className="h-5 w-5" />
                )}
                Atender
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={toggleMicrophone}
                disabled={!call.localStream}
                title={muted ? 'Ativar microfone' : 'Silenciar microfone'}
                className={`flex h-12 w-12 items-center justify-center rounded-full border transition disabled:opacity-40 ${
                  muted
                    ? 'border-white bg-white text-slate-900'
                    : 'border-white/15 bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>

              {call.callType === 'video' && (
                <button
                  type="button"
                  onClick={toggleCamera}
                  disabled={!call.localStream}
                  title={cameraOff ? 'Ligar câmera' : 'Desligar câmera'}
                  className={`flex h-12 w-12 items-center justify-center rounded-full border transition disabled:opacity-40 ${
                    cameraOff
                      ? 'border-white bg-white text-slate-900'
                      : 'border-white/15 bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {cameraOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                </button>
              )}

              <button
                type="button"
                onClick={toggleRemoteAudio}
                title={remoteMuted ? 'Ativar som' : 'Silenciar áudio recebido'}
                className={`flex h-12 w-12 items-center justify-center rounded-full border transition ${
                  remoteMuted
                    ? 'border-white bg-white text-slate-900'
                    : 'border-white/15 bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {remoteMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>

              <button
                type="button"
                onClick={() => onEndCall(formattedTime)}
                title="Encerrar chamada"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-700"
              >
                <PhoneOff className="h-6 w-6" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
