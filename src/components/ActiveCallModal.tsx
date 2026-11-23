import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Gauge,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import {
  startRingbackToneAudio,
  startRingtoneAudio,
  unlockCallAudio,
  type CallNetworkHealth,
  type VideoQualityMode,
} from '../lib/webrtcService';

export interface ActiveCallUIState {
  callId: string;
  direction: 'outgoing' | 'incoming';
  callType: 'audio' | 'video';
  peerId: string;
  peerName: string;
  peerInitials: string;
  peerAvatarColor: string;
  peerAvatarUrl?: string;
  status: 'ringing' | 'connecting' | 'active' | 'ended' | 'declined' | 'missed';
  offerSdp?: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remotePushDelivered?: boolean | null;
  networkHealth?: CallNetworkHealth;
  videoQuality?: VideoQualityMode;
  errorMessage?: string;
}

interface ActiveCallModalProps {
  call: ActiveCallUIState;
  onAcceptIncoming: () => void;
  onDeclineIncoming: () => void;
  onEndCall: (durationLabel: string) => void;
  onSwitchCamera?: () => Promise<void>;
  onChangeVideoQuality?: (mode: VideoQualityMode) => void;
}

export const ActiveCallModal: React.FC<ActiveCallModalProps> = ({
  call,
  onAcceptIncoming,
  onDeclineIncoming,
  onEndCall,
  onSwitchCamera,
  onChangeVideoQuality,
}) => {
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [swappedView, setSwappedView] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [flippingCamera, setFlippingCamera] = useState(false);
  const [ringtoneBlocked, setRingtoneBlocked] = useState(false);

  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Real acoustic ringtone (incoming) or calling ringback tone (outgoing)
  useEffect(() => {
    setRingtoneBlocked(false);
    if (call.direction === 'incoming' && call.status === 'ringing') {
      const stopRingtone = startRingtoneAudio((blocked) => setRingtoneBlocked(blocked));
      return () => stopRingtone();
    }
    if (call.direction === 'outgoing' && call.status === 'ringing') {
      const stopRingback = startRingbackToneAudio();
      return () => stopRingback();
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

  const isVideoCall = call.callType === 'video';
  const isVideoActive = isVideoCall && call.status === 'active';

  // Determine which stream goes to main full-screen video vs floating PiP
  const mainStream = isVideoActive
    ? swappedView
      ? call.localStream
      : call.remoteStream
    : isVideoCall
      ? call.localStream
      : null;

  const pipStream = isVideoActive
    ? swappedView
      ? call.remoteStream
      : call.localStream
    : null;

  const mainIsLocal = isVideoActive ? swappedView : true;

  // Auto-hide controls after 4.5s during active video call (reduces mobile GPU overdraw & feels like WhatsApp)
  useEffect(() => {
    if (!isVideoActive || !controlsVisible) return undefined;
    const t = window.setTimeout(() => setControlsVisible(false), 4500);
    return () => window.clearTimeout(t);
  }, [isVideoActive, controlsVisible]);

  // Attach audio stream always to hidden <audio> element (only reassign if stream changed to avoid glitches)
  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el || !call.remoteStream) return;
    if (el.srcObject !== call.remoteStream) {
      el.srcObject = call.remoteStream;
    }
    el.muted = remoteMuted;
    if (el.paused) {
      void el.play().catch(() => {});
    }
  }, [call.remoteStream, remoteMuted]);

  const showMainVideo = isVideoCall && Boolean(mainStream) && (!mainIsLocal || !cameraOff);
  const showPipVideo = isVideoActive && Boolean(pipStream) && (mainIsLocal || !cameraOff);

  // Attach main full-screen video stream ONLY when stream reference changes or element remounts (prevents decoder flush/freezes!)
  useEffect(() => {
    const el = mainVideoRef.current;
    if (!el) return;
    if (el.srcObject !== mainStream) {
      el.srcObject = mainStream;
    }
    if (mainStream && el.paused) {
      void el.play().catch(() => {});
    }
  }, [mainStream, showMainVideo]);

  // Attach floating PiP video stream ONLY when stream reference changes or element remounts
  useEffect(() => {
    const el = pipVideoRef.current;
    if (!el) return;
    if (el.srcObject !== pipStream) {
      el.srcObject = pipStream;
    }
    if (pipStream && el.paused) {
      void el.play().catch(() => {});
    }
  }, [pipStream, showPipVideo]);

  const currentQuality: VideoQualityMode = call.videoQuality || 'auto';
  const cycleQualityMode = () => {
    if (!onChangeVideoQuality) return;
    const next: VideoQualityMode =
      currentQuality === 'auto'
        ? 'economy'
        : currentQuality === 'economy'
          ? 'hd'
          : 'auto';
    onChangeVideoQuality(next);
  };
  const qualityLabel =
    currentQuality === 'economy' ? 'Leve 4G' : currentQuality === 'hd' ? 'HD' : 'Auto';

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

  const handleFlipCamera = async () => {
    if (!onSwitchCamera || flippingCamera || cameraOff) return;
    setFlippingCamera(true);
    try {
      await onSwitchCamera();
    } finally {
      setFlippingCamera(false);
    }
  };

  const statusText = () => {
    if (call.errorMessage) return 'Permissão necessária';
    if (call.direction === 'incoming' && call.status === 'ringing') {
      return isVideoCall ? 'Chamada de vídeo recebida...' : 'Ligação de voz recebida...';
    }
    if (call.direction === 'outgoing' && call.status === 'ringing') {
      return 'Chamando...';
    }
    if (call.status === 'connecting') {
      return 'Conectando chamada...';
    }
    if (call.status === 'active') {
      return formattedTime;
    }
    if (call.status === 'declined') return 'Chamada recusada';
    if (call.status === 'missed') return 'Chamada não atendida';
    return 'Chamada encerrada';
  };

  return (
    <div className="fixed inset-0 z-50 h-[100dvh] w-full overflow-hidden bg-[#06151E] text-white select-none">
      {/* Hidden real remote audio playback element */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* FULL-SCREEN VIDEO CANVAS (WhatsApp-style edge-to-edge) */}
      {showMainVideo ? (
        <div
          className="absolute inset-0 h-full w-full bg-black"
          onClick={() => {
            if (isVideoActive) setControlsVisible((v) => !v);
          }}
        >
          <video
            ref={mainVideoRef}
            autoPlay
            muted
            playsInline
            disablePictureInPicture
            className="h-full w-full object-cover transform-gpu"
          />
          {/* Subtle top & bottom readability gradients */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 via-black/25 to-transparent transition-opacity duration-200 ${
              controlsVisible || !isVideoActive ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/75 via-black/30 to-transparent transition-opacity duration-200 ${
              controlsVisible || !isVideoActive ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>
      ) : (
        /* Full-screen dark gradient for audio calls or camera-off state */
        <div className="absolute inset-0 bg-gradient-to-b from-[#0D2B3E] via-[#091D2B] to-[#051018]" />
      )}

      {/* TOP OVERLAY HEADER (Peer Info + Live Timer — solid translucent bg without GPU-heavy video blur) */}
      <header
        className={`relative z-20 flex items-center justify-between gap-2 px-3.5 sm:px-4 pt-safe pb-3 transition-opacity duration-200 ${
          isVideoActive && !controlsVisible ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5 rounded-2xl bg-black/65 px-3 py-2">
          {call.peerAvatarUrl ? (
            <img
              src={call.peerAvatarUrl}
              alt={call.peerName}
              className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full object-cover ring-2 ring-white/25"
            />
          ) : (
            <div
              className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white/20"
              style={{ backgroundColor: call.peerAvatarColor || '#0E7A34' }}
            >
              {call.peerInitials}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-white sm:text-base">
              {call.peerName}
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="font-mono tabular-nums">{statusText()}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* 1-tap Video Quality toggle (Auto / Leve 4G / HD) */}
          {isVideoActive && onChangeVideoQuality && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cycleQualityMode();
              }}
              title="Alterar velocidade do vídeo (Auto / Leve 4G / HD)"
              className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition ${
                currentQuality === 'economy'
                  ? 'bg-emerald-600/90 text-white'
                  : 'bg-black/65 text-white hover:bg-black/80'
              }`}
            >
              <Gauge className="h-3.5 w-3.5" />
              <span>{qualityLabel}</span>
            </button>
          )}

          {/* Quick Camera Flip button on top-right during video call */}
          {isVideoCall && call.localStream && onSwitchCamera && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleFlipCamera();
              }}
              disabled={flippingCamera || cameraOff}
              title="Virar câmera (frontal / traseira)"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/80 disabled:opacity-40"
            >
              <SwitchCamera className={`h-5 w-5 ${flippingCamera ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </header>

      {/* Live Reconnecting / Weak Signal Indicator */}
      {call.status === 'active' &&
        (call.networkHealth === 'reconnecting' || call.networkHealth === 'poor') && (
          <div className="pointer-events-none fixed inset-x-0 top-20 z-30 flex justify-center px-4 pt-safe">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-black/80 px-3.5 py-1.5 text-xs font-semibold text-amber-200 shadow-lg">
              <Wifi className="h-3.5 w-3.5 animate-pulse" />
              {call.networkHealth === 'reconnecting'
                ? 'Reconectando vídeo automaticamente...'
                : 'Sinal fraco — vídeo ajustado para não travar'}
            </div>
          </div>
        )}

      {/* FLOATING SELF-PREVIEW PiP (Tap to swap full-screen & mini view like WhatsApp) */}
      {showPipVideo && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSwappedView((v) => !v);
          }}
          title="Toque para alternar as câmeras na tela"
          className={`absolute right-3.5 z-30 h-36 w-24 sm:h-44 sm:w-28 overflow-hidden rounded-2xl border-2 border-white/40 bg-black shadow-2xl transition-all duration-200 ${
            controlsVisible ? 'bottom-28 sm:bottom-32' : 'bottom-6'
          }`}
        >
          <video
            ref={pipVideoRef}
            autoPlay
            muted
            playsInline
            disablePictureInPicture
            className="h-full w-full object-cover transform-gpu"
          />
        </button>
      )}

      {/* CENTER AVATAR & CALLING STATE (for Voice Calls, Incoming Ringing, or Camera Off) */}
      {!showMainVideo && (
        <div className="relative z-10 flex h-[calc(100%-15rem)] flex-col items-center justify-center px-6 text-center">
          <div className="relative">
            {(call.status === 'ringing' || call.status === 'connecting') && (
              <span className="absolute -inset-4 rounded-full bg-emerald-400/20 animate-ping" />
            )}
            {call.peerAvatarUrl ? (
              <img
                src={call.peerAvatarUrl}
                alt={call.peerName}
                className="relative h-32 w-32 sm:h-36 sm:w-36 rounded-full object-cover shadow-2xl ring-4 ring-white/20"
              />
            ) : (
              <div
                className="relative flex h-32 w-32 sm:h-36 sm:w-36 items-center justify-center rounded-full text-4xl font-bold text-white shadow-2xl ring-4 ring-white/15"
                style={{ backgroundColor: call.peerAvatarColor || '#0E7A34' }}
              >
                {call.peerInitials}
              </div>
            )}
          </div>

          <h2 className="mt-6 text-2xl font-bold tracking-tight text-white">
            {call.peerName}
          </h2>
          <p className="mt-1.5 font-mono text-sm text-emerald-200/90 tabular-nums">
            {statusText()}
          </p>
          {call.direction === 'outgoing' && call.status === 'ringing' && call.remotePushDelivered === true && (
            <p className="mt-3 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3.5 py-1 text-[11px] font-medium text-emerald-200">
              Toque enviado ao aparelho de {call.peerName}
            </p>
          )}
          {call.direction === 'outgoing' && call.status === 'ringing' && call.remotePushDelivered === false && (
            <p className="mt-3 max-w-xs rounded-2xl border border-amber-300/35 bg-amber-500/15 px-3.5 py-2 text-[11px] leading-relaxed text-amber-100">
              O aparelho de {call.peerName} ainda não ativou toque com tela bloqueada — só tocará se o ChatFi estiver aberto na tela.
            </p>
          )}
          {ringtoneBlocked && call.direction === 'incoming' && call.status === 'ringing' && (
            <button
              type="button"
              onClick={() => {
                unlockCallAudio();
                setRingtoneBlocked(false);
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-100 backdrop-blur-md hover:bg-emerald-500/30"
            >
              <Volume2 className="h-4 w-4" />
              Toque para ativar som do toque
            </button>
          )}
        </div>
      )}

      {/* Error Box (e.g., mic/camera permission denied) */}
      {call.errorMessage && (
        <div className="fixed inset-x-4 bottom-28 z-30 mx-auto max-w-md rounded-2xl border border-amber-400/40 bg-amber-950/85 p-4 text-left text-xs text-amber-100 backdrop-blur-md">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p>{call.errorMessage}</p>
          </div>
        </div>
      )}

      {/* BOTTOM FLOATING ACTION DOCK (WhatsApp-style — translucent dark surface, zero GPU blur lag) */}
      <footer
        className={`fixed inset-x-0 bottom-0 z-30 px-4 pt-3 pb-safe transition-opacity duration-200 ${
          isVideoActive && !controlsVisible ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        <div className="mx-auto max-w-md rounded-3xl border border-white/15 bg-black/75 px-4 py-3.5 shadow-2xl">
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
                className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#0E7A34] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0B5D27]"
              >
                {isVideoCall ? <Video className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
                Atender
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-around gap-2 sm:gap-3">
              {isVideoCall && onSwitchCamera && (
                <button
                  type="button"
                  onClick={() => void handleFlipCamera()}
                  disabled={!call.localStream || flippingCamera || cameraOff}
                  title="Virar câmera"
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
                >
                  <SwitchCamera className="h-5 w-5" />
                </button>
              )}

              {isVideoCall && (
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

              <button
                type="button"
                onClick={toggleRemoteAudio}
                title={remoteMuted ? 'Ativar som' : 'Silenciar som'}
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
      </footer>
    </div>
  );
};
