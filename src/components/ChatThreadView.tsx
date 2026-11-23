import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCheck,
  Image as ImageIcon,
  Mic,
  Pause,
  Phone,
  Play,
  Receipt,
  Send,
  Square,
  Store,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import type { ChatMessage } from '../types/zapei';
import { formatBRL } from '../lib/gradeParser';
import { blobToDataUrl, compressImageFileToDataUrl } from '../lib/phoneUtils';

export interface ActiveChatPeer {
  uid: string;
  name: string;
  initials: string;
  avatarBg: string;
  phone?: string;
  role: 'normal' | 'reseller' | 'manufacturer';
  hasStorefront: boolean;
  storefrontName?: string;
  deliveryPolicyLabel?: string;
}

interface ChatThreadViewProps {
  myUid: string;
  peer: ActiveChatPeer;
  messages: ChatMessage[];
  onBack?: () => void;
  onSendText: (text: string) => Promise<void>;
  onSendAudio: (mediaUrl: string, durationLabel: string) => Promise<void>;
  onSendImage: (mediaUrl: string, caption: string) => Promise<void>;
  onStartCall: (type: 'audio' | 'video') => void;
  onOpenStorefront: () => void;
  onInspectOrder: (orderId?: string) => void;
}

const RealAudioBubble: React.FC<{
  mediaUrl?: string;
  duration?: string;
  isMine: boolean;
}> = ({ mediaUrl, duration, isMine }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      void el.play().catch(() => {});
    }
  };

  return (
    <div className="flex min-w-[210px] items-center gap-3 py-0.5">
      {mediaUrl && (
        <audio
          ref={audioRef}
          src={mediaUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration && Number.isFinite(el.duration)) {
              setProgress(Math.min(100, (el.currentTime / el.duration) * 100));
            }
          }}
          className="hidden"
        />
      )}
      <button
        type="button"
        onClick={togglePlay}
        disabled={!mediaUrl}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${
          isMine
            ? 'bg-white/20 text-white hover:bg-white/30'
            : 'bg-[#0F5132] text-white hover:bg-[#146c43]'
        }`}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </button>
      <div className="flex-1">
        <div
          className={`h-1.5 w-full overflow-hidden rounded-full ${
            isMine ? 'bg-white/25' : 'bg-slate-200'
          }`}
        >
          <div
            className={`h-full transition-all ${isMine ? 'bg-white' : 'bg-[#0F5132]'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] opacity-80">
          <span>Mensagem de voz</span>
          <span className="font-mono tabular-nums">{duration || '0:00'}</span>
        </div>
      </div>
    </div>
  );
};

export const ChatThreadView: React.FC<ChatThreadViewProps> = ({
  myUid,
  peer,
  messages,
  onBack,
  onSendText,
  onSendAudio,
  onSendImage,
  onStartCall,
  onOpenStorefront,
  onInspectOrder,
}) => {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [mediaError, setMediaError] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, peer.uid]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleSubmitText = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setDraft('');
    setSending(true);
    try {
      await onSendText(trimmed);
    } finally {
      setSending(false);
    }
  };

  const startRealRecording = async () => {
    setMediaError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      recordStreamRef.current = stream;
      audioChunksRef.current = [];

      const candidateMimeTypes = [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
      ];
      const mimeType =
        typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
          ? candidateMimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
          : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);

      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 45) {
            void stopAndSendRecording();
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setMediaError('Não foi possível acessar o microfone. Verifique a permissão no navegador.');
    }
  };

  const cancelRecording = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
    audioChunksRef.current = [];
    setRecording(false);
    setRecordSeconds(0);
  };

  const stopAndSendRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    const finalSeconds = Math.max(1, recordSeconds);
    const durationLabel = `${Math.floor(finalSeconds / 60)}:${(finalSeconds % 60)
      .toString()
      .padStart(2, '0')}`;

    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      });
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordStreamRef.current = null;
      setRecording(false);
      setRecordSeconds(0);

      if (blob.size === 0) return;
      try {
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.length > 480000) {
          setMediaError('Áudio muito longo. Grave mensagens de até 40 segundos.');
          return;
        }
        await onSendAudio(dataUrl, durationLabel);
      } catch {
        setMediaError('Erro ao enviar mensagem de voz.');
      }
    };

    recorder.stop();
  };

  const handleImagePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMediaError('');
    setSending(true);
    try {
      const dataUrl = await compressImageFileToDataUrl(file, 840, 0.74);
      if (dataUrl.length > 480000) {
        const smaller = await compressImageFileToDataUrl(file, 600, 0.62);
        await onSendImage(smaller, file.name);
      } else {
        await onSendImage(dataUrl, file.name);
      }
    } catch {
      setMediaError('Não foi possível processar a imagem selecionada.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-[#F1F5F9]">
      {/* Top Chat Header */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-2.5 pb-2.5 pt-safe sm:px-4 md:py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 md:hidden"
              aria-label="Voltar para conversas"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div
            className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: peer.avatarBg || '#0F5132' }}
          >
            {peer.initials}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold text-slate-900 sm:text-base">
              {peer.name}
            </h2>
            <p className="truncate text-xs text-slate-500">
              {peer.hasStorefront
                ? peer.storefrontName || 'Vitrine comercial ativa'
                : peer.phone || 'Contato Zapei'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {peer.hasStorefront && (
            <button
              type="button"
              onClick={onOpenStorefront}
              title="Abrir vitrine"
              className="flex h-9 items-center gap-1.5 rounded-xl bg-[#0F5132] px-2.5 text-xs font-semibold text-white transition hover:bg-[#146c43] sm:h-10 sm:px-3"
            >
              <Store className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Vitrine</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onStartCall('audio')}
            title="Ligação de voz"
            className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 hover:text-[#0F5132]"
          >
            <Phone className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onStartCall('video')}
            title="Chamada de vídeo"
            className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 hover:text-[#0D2B3E]"
          >
            <Video className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Messages Stream */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3.5 sm:px-5 space-y-2.5">
        {messages.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p className="text-sm font-semibold text-slate-800">
              Conversa iniciada com {peer.name}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Envie texto, áudio gravado pelo microfone, fotos reais ou inicie uma ligação de voz/vídeo.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderId === myUid;
            return (
              <div
                key={msg.id}
                className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] min-w-0 overflow-hidden break-words rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${
                    isMine
                      ? 'rounded-br-sm bg-[#0F5132] text-white'
                      : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  {msg.type === 'audio' ? (
                    <RealAudioBubble
                      mediaUrl={msg.mediaUrl}
                      duration={msg.audioDuration}
                      isMine={isMine}
                    />
                  ) : msg.type === 'image' ? (
                    <div className="space-y-1.5">
                      {msg.mediaUrl && (
                        <button
                          type="button"
                          onClick={() => setPreviewImage(msg.mediaUrl || null)}
                          className="block overflow-hidden rounded-xl"
                        >
                          <img
                            src={msg.mediaUrl}
                            alt={msg.text || 'Foto enviada'}
                            className="max-h-64 w-full rounded-xl object-cover"
                          />
                        </button>
                      )}
                      {msg.text && <p className="text-xs opacity-90">{msg.text}</p>}
                    </div>
                  ) : msg.type === 'order_card' ? (
                    <div
                      className={`rounded-xl border p-3 ${
                        isMine
                          ? 'border-white/20 bg-white/10 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-bold uppercase tracking-wide">
                          Pedido {msg.orderCode || ''}
                        </span>
                        {typeof msg.orderTotal === 'number' && (
                          <span className="font-mono text-sm font-bold tabular-nums">
                            {formatBRL(msg.orderTotal)}
                          </span>
                        )}
                      </div>
                      {msg.orderSummary && (
                        <p className="mt-1 text-xs opacity-90">{msg.orderSummary}</p>
                      )}
                      {msg.orderStatusLabel && (
                        <p className="mt-1.5 text-[11px] font-medium opacity-80">
                          Status: {msg.orderStatusLabel}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => onInspectOrder(msg.orderId)}
                        className={`mt-2.5 w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          isMine
                            ? 'bg-white text-[#0F5132] hover:bg-slate-100'
                            : 'bg-[#0D2B3E] text-white hover:bg-[#143d57]'
                        }`}
                      >
                        Abrir detalhes do pedido
                      </button>
                    </div>
                  ) : msg.type === 'billing_reminder' ? (
                    <div
                      className={`rounded-xl border p-3 ${
                        isMine
                          ? 'border-orange-300/40 bg-orange-500/20 text-white'
                          : 'border-orange-200 bg-orange-50 text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold">
                        <Receipt className="h-4 w-4 text-[#F97316]" />
                        <span>Lembrete Financeiro {msg.orderCode || ''}</span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed">{msg.text}</p>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>
                  )}

                  <div
                    className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                      isMine ? 'text-emerald-100/80' : 'text-slate-400'
                    }`}
                  >
                    <span className="font-mono tabular-nums">{msg.timestamp}</span>
                    {isMine && <CheckCheck className="h-3.5 w-3.5" />}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Media Error Banner */}
      {mediaError && (
        <div className="flex items-center justify-between bg-amber-50 px-4 py-2 text-xs text-amber-800 border-t border-amber-200">
          <span>{mediaError}</span>
          <button
            type="button"
            onClick={() => setMediaError('')}
            className="ml-2 text-amber-700 hover:text-amber-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Composer */}
      <footer className="shrink-0 border-t border-slate-200 bg-white px-2.5 pt-2.5 pb-safe sm:px-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImagePicked}
          className="hidden"
        />

        {recording ? (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600 animate-pulse" />
              <span className="truncate text-xs font-semibold text-red-700">
                Gravando...
              </span>
              <span className="shrink-0 font-mono text-xs font-bold text-red-800 tabular-nums">
                {Math.floor(recordSeconds / 60)}:
                {(recordSeconds % 60).toString().padStart(2, '0')}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={cancelRecording}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                title="Cancelar gravação"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void stopAndSendRecording()}
                className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0F5132] px-3 py-2 text-xs font-semibold text-white hover:bg-[#146c43]"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Enviar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitText} className="flex w-full min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="Enviar foto do aparelho"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-[#0F5132]"
            >
              <ImageIcon className="h-5 w-5" />
            </button>

            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Digite uma mensagem..."
              className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0F5132] focus:bg-white focus:outline-none"
            />

            {draft.trim() ? (
              <button
                type="submit"
                disabled={sending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0F5132] text-white transition hover:bg-[#146c43] disabled:opacity-50"
                aria-label="Enviar mensagem"
              >
                <Send className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startRealRecording()}
                title="Gravar mensagem de voz"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0D2B3E] text-white transition hover:bg-[#143d57]"
                aria-label="Gravar áudio"
              >
                <Mic className="h-5 w-5" />
              </button>
            )}
          </form>
        )}
      </footer>

      {/* Image Lightbox */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={previewImage}
            alt="Visualização"
            className="max-h-[85vh] max-w-full rounded-2xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
