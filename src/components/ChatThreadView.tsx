import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Film,
  Forward,
  Image as ImageIcon,
  Loader2,
  Mic,
  Pause,
  Phone,
  Play,
  Radio,
  Receipt,
  Reply,
  Search,
  Send,
  Share2,
  Smile,
  Square,
  Store,
  Trash2,
  Video,
  WifiOff,
  X,
} from 'lucide-react';
import type { ChatMessage } from '../types/zapei';
import { formatBRL } from '../lib/gradeParser';
import { getDeterministicChatId } from '../lib/firebase';
import {
  formatBytesPtBr,
  getLocalMediaObjectUrlsForChat,
  subscribeLocalMediaChanges,
} from '../lib/localMediaCache';
import {
  IMAGE_JPEG_QUALITY,
  MAX_AUDIO_SECONDS,
  MAX_IMAGE_WIDTH,
  MAX_VIDEO_BYTES,
  type MediaResolveResult,
  receiveAndDeliverTransitMedia,
} from '../lib/mediaTransitService';
import {
  compressImageFileToBlob,
  extractVideoDurationLabel,
} from '../lib/phoneUtils';
import {
  classifySharedFile,
  extractAudioDurationLabel,
  normalizeSharedAudioMimeType,
} from '../lib/shareTargetInbox';
import {
  getContactPresenceDisplay,
  type PresenceSnapshot,
} from '../lib/presenceUtils';
import type { AvatarPreviewTarget } from './AvatarLightboxModal';

export interface ActiveChatPeer {
  uid: string;
  name: string;
  initials: string;
  avatarBg: string;
  avatarUrl?: string;
  phone?: string;
  role: 'normal' | 'reseller' | 'manufacturer';
  hasStorefront: boolean;
  storefrontName?: string;
  deliveryPolicyLabel?: string;
}

export interface ForwardTarget {
  uid: string;
  name: string;
  initials: string;
  avatarBg: string;
  avatarUrl?: string;
  subtitle?: string;
}

interface ChatThreadViewProps {
  myUid: string;
  myName: string;
  peer: ActiveChatPeer;
  peerPresence?: PresenceSnapshot | null;
  messages: ChatMessage[];
  forwardTargets?: ForwardTarget[];
  isOffline?: boolean;
  pendingCount?: number;
  onBack?: () => void;
  onSendText: (text: string) => Promise<void>;
  onSendAudio: (blob: Blob, durationLabel: string) => Promise<void>;
  onSendImage: (blob: Blob, caption: string) => Promise<void>;
  onSendVideo: (blob: Blob, durationLabel: string, caption: string) => Promise<void>;
  onForwardMessage?: (target: ForwardTarget, msg: ChatMessage) => Promise<void>;
  onNotify?: (message: string) => void;
  onStartCall: (type: 'audio' | 'video') => void;
  onOpenStorefront: () => void;
  onInspectOrder: (orderId?: string) => void;
  onPreviewAvatar?: (target: AvatarPreviewTarget) => void;
}

const QUICK_EMOJIS = [
  '😀', '😂', '😍', '🥰', '😘', '😊', '😉', '😎',
  '🤔', '😢', '😭', '😡', '👍', '👎', '👏', '🙏',
  '🔥', '❤️', '💚', '🎉', '🥳', '🙌', '👌', '💪',
  '🤝', '📸', '📞', '✅', '❌', '💯', '✨', '🚀',
];

function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function getExtensionFromMime(mime: string, fallback: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.startsWith('video/mp4')) return 'mp4';
  if (lower.startsWith('video/quicktime')) return 'mov';
  if (lower.startsWith('video/webm')) return 'webm';
  if (lower.includes('mp4') || lower.includes('m4a')) return 'm4a';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  return fallback;
}

async function mediaUrlToBlobAndFile(
  mediaUrl: string,
  baseName: string,
  fallbackExt: string
): Promise<{ blob: Blob; file: File; filename: string }> {
  let blob: Blob;
  if (mediaUrl.startsWith('data:')) {
    const commaIdx = mediaUrl.indexOf(',');
    const header = mediaUrl.slice(0, commaIdx);
    const dataPart = mediaUrl.slice(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : fallbackExt === 'jpg' ? 'image/jpeg' : 'audio/webm';
    const binary = atob(dataPart);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: mime });
  } else {
    const res = await fetch(mediaUrl);
    blob = await res.blob();
  }

  const ext = getExtensionFromMime(blob.type || '', fallbackExt);
  const safeBase = baseName
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32) || 'chatfi-midia';
  const filename = `${safeBase}-${Date.now().toString().slice(-5)}.${ext}`;
  const file = new File([blob], filename, {
    type: blob.type || (fallbackExt === 'jpg' ? 'image/jpeg' : 'audio/webm'),
  });
  return { blob, file, filename };
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}

async function copyTextFallback(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

interface ParsedQuotedText {
  quoteSender: string;
  quoteSnippet: string;
  body: string;
}

function parseQuotedMessage(text: string): ParsedQuotedText | null {
  if (!text.startsWith('» ')) return null;
  const firstBreak = text.indexOf('\n');
  if (firstBreak === -1) return null;
  const headerLine = text.slice(2, firstBreak).trim();
  const body = text.slice(firstBreak + 1);
  if (!body.trim()) return null;
  const colonIdx = headerLine.indexOf(':');
  if (colonIdx === -1) {
    return { quoteSender: 'Mensagem', quoteSnippet: headerLine, body };
  }
  return {
    quoteSender: headerLine.slice(0, colonIdx).trim() || 'Mensagem',
    quoteSnippet: headerLine.slice(colonIdx + 1).trim(),
    body,
  };
}

function getReplySnippet(msg: ChatMessage): string {
  if (msg.type === 'image') {
    const cleanCaption = msg.text && msg.text !== 'Foto' ? ` — ${msg.text}` : '';
    return `📷 Foto${cleanCaption}`.slice(0, 72);
  }
  if (msg.type === 'video') {
    const cleanCaption = msg.text && msg.text !== 'Vídeo' ? ` — ${msg.text}` : '';
    return `🎬 Vídeo${cleanCaption}`.slice(0, 72);
  }
  if (msg.type === 'audio') {
    return `🎤 Mensagem de voz (${msg.audioDuration || '0:00'})`;
  }
  if (msg.type === 'order_card') {
    return `📦 Pedido ${msg.orderCode || ''}`.trim();
  }
  const parsed = parseQuotedMessage(msg.text);
  const raw = parsed ? parsed.body : msg.text;
  return raw.replace(/\s+/g, ' ').trim().slice(0, 72);
}

function formatAudioSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const RealAudioBubble: React.FC<{
  mediaUrl?: string;
  duration?: string;
  isMine: boolean;
}> = ({ mediaUrl, duration, isMine }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTimeLabel, setCurrentTimeLabel] = useState('');
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
    if (playing) {
      el.pause();
    } else {
      void el.play().catch(() => {});
    }
  };

  const cycleSpeed = () => {
    const next: 1 | 1.5 | 2 = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !el.duration || !Number.isFinite(el.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    setProgress(ratio * 100);
    setCurrentTimeLabel(formatAudioSeconds(el.currentTime));
  };

  return (
    <div className="flex min-w-[220px] items-center gap-2.5 py-0.5">
      {mediaUrl && (
        <audio
          ref={audioRef}
          src={mediaUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
            setCurrentTimeLabel('');
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration && Number.isFinite(el.duration)) {
              setProgress(Math.min(100, (el.currentTime / el.duration) * 100));
              setCurrentTimeLabel(formatAudioSeconds(el.currentTime));
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
            : 'bg-[#0E7A34] text-white hover:bg-[#0B5D27]'
        }`}
        aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </button>

      <div className="min-w-0 flex-1">
        <div
          role="slider"
          aria-label="Progresso do áudio"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          tabIndex={0}
          onClick={handleSeek}
          className="cursor-pointer py-2"
        >
          <div
            className={`h-1.5 w-full overflow-hidden rounded-full ${
              isMine ? 'bg-white/25' : 'bg-slate-200'
            }`}
          >
            <div
              className={`h-full transition-all ${isMine ? 'bg-white' : 'bg-[#0E7A34]'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] opacity-85">
          <span className="font-mono tabular-nums">
            {playing && currentTimeLabel ? currentTimeLabel : duration || '0:00'}
          </span>
          <button
            type="button"
            onClick={cycleSpeed}
            className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold transition ${
              isMine
                ? 'bg-white/20 text-white hover:bg-white/30'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
            title="Alterar velocidade do áudio"
          >
            {speed}x
          </button>
        </div>
      </div>
    </div>
  );
};

export const ChatThreadView: React.FC<ChatThreadViewProps> = ({
  myUid,
  myName,
  peer,
  peerPresence,
  messages,
  forwardTargets = [],
  isOffline = false,
  pendingCount = 0,
  onBack,
  onSendText,
  onSendAudio,
  onSendImage,
  onSendVideo,
  onForwardMessage,
  onNotify,
  onStartCall,
  onOpenStorefront,
  onInspectOrder,
  onPreviewAvatar,
}) => {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [mediaError, setMediaError] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [presenceNowMs, setPresenceNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setPresenceNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const peerPresenceDisplay = useMemo(
    () =>
      getContactPresenceDisplay(peerPresence, {
        fallback: peer.hasStorefront
          ? peer.storefrontName || 'Vitrine comercial ativa'
          : peer.phone || 'Disponível',
        nowMs: presenceNowMs,
      }),
    [peerPresence, peer.hasStorefront, peer.storefrontName, peer.phone, presenceNowMs]
  );

  // WhatsApp-style local IndexedDB media map (instant zero-network playback + auto transit download)
  const [resolvedMedia, setResolvedMedia] = useState<Record<string, MediaResolveResult>>({});
  const [localCacheTick, setLocalCacheTick] = useState(0);

  // WhatsApp-style media & message interaction states
  const [lightboxMsg, setLightboxMsg] = useState<ChatMessage | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<{
    blob: Blob;
    previewUrl: string;
    sizeBytes: number;
    caption: string;
  } | null>(null);
  const [pendingVideo, setPendingVideo] = useState<{
    blob: Blob;
    previewUrl: string;
    durationLabel: string;
    sizeBytes: number;
    caption: string;
  } | null>(null);
  const [replyingTo, setReplyingTo] = useState<{
    senderName: string;
    snippet: string;
  } | null>(null);
  const [actionSheetMsg, setActionSheetMsg] = useState<ChatMessage | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardingUid, setForwardingUid] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const activeChatId = useMemo(
    () => getDeterministicChatId(myUid, peer.uid),
    [myUid, peer.uid]
  );

  const notify = (text: string) => {
    if (onNotify) {
      onNotify(text);
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, peer.uid]);

  useEffect(() => {
    setReplyingTo(null);
    setShowEmojiPicker(false);
    setActionSheetMsg(null);
  }, [peer.uid]);

  // React immediately if user deletes media in Settings -> Armazenamento e Dados
  useEffect(() => {
    return subscribeLocalMediaChanges(() => {
      setLocalCacheTick((t) => t + 1);
    });
  }, []);

  // Preload all permanently stored IndexedDB media for this chat instantaneously
  useEffect(() => {
    let cancelled = false;
    void getLocalMediaObjectUrlsForChat(activeChatId).then((cachedMap) => {
      if (cancelled) return;
      setResolvedMedia((prev) => {
        const next: Record<string, MediaResolveResult> = {};
        // Preserve downloading/expired states only for items not yet in cache
        for (const [id, val] of Object.entries(prev)) {
          if (val.status === 'downloading') next[id] = val;
        }
        cachedMap.forEach((entry, msgId) => {
          next[msgId] = {
            status: 'ready',
            url: entry.url,
            sizeBytes: entry.record.sizeBytes,
            mimeType: entry.record.mimeType,
          };
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeChatId, localCacheTick]);

  // Resolve and auto-download incoming transit media into local IndexedDB (+ mark delivered + wipe cloud)
  useEffect(() => {
    let cancelled = false;
    const mediaMessages = messages.filter(
      (m) => m.type === 'image' || m.type === 'audio' || m.type === 'video'
    );
    if (mediaMessages.length === 0) return undefined;

    for (const msg of mediaMessages) {
      void (async () => {
        setResolvedMedia((prev) => {
          const cur = prev[msg.id];
          if (cur?.status === 'ready') return prev;
          return { ...prev, [msg.id]: { status: 'downloading' } };
        });

        const result = await receiveAndDeliverTransitMedia({
          msg,
          myUid,
          peerUid: peer.uid,
          peerName: peer.name,
        });

        if (cancelled) return;
        setResolvedMedia((prev) => ({
          ...prev,
          [msg.id]: result,
        }));
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [messages, myUid, peer.uid, peer.name, isOffline, localCacheTick]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const getResolvedMediaUrl = (msg: ChatMessage): string | undefined => {
    const resolved = resolvedMedia[msg.id];
    if (resolved?.status === 'ready' && resolved.url) return resolved.url;
    if (resolved?.status === 'deleted_locally' || resolved?.status === 'expired') {
      return undefined;
    }
    if (msg.mediaUrl && msg.mediaUrl.startsWith('data:')) return msg.mediaUrl;
    return undefined;
  };

  const filteredForwardTargets = useMemo(() => {
    const q = forwardSearch
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    if (!q) return forwardTargets;
    return forwardTargets.filter((t) =>
      `${t.name} ${t.subtitle || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes(q)
    );
  }, [forwardTargets, forwardSearch]);

  // --- REAL MEDIA SAVE / SHARE / COPY / FORWARD HANDLERS ---

  const handleSaveMedia = async (
    mediaUrl: string | undefined,
    kind: 'image' | 'audio' | 'video'
  ) => {
    if (!mediaUrl || mediaBusy) return;
    setMediaBusy(true);
    try {
      const baseName =
        kind === 'image' ? 'chatfi-foto' : kind === 'video' ? 'chatfi-video' : 'chatfi-audio';
      const fallbackExt = kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : 'webm';
      const { blob, filename } = await mediaUrlToBlobAndFile(mediaUrl, baseName, fallbackExt);
      triggerBlobDownload(blob, filename);
      if (kind === 'image' && isIOSDevice()) {
        notify('Foto baixada! No iPhone, use "Compartilhar → Salvar Imagem" para guardar direto no rolo da câmera.');
      } else {
        notify(
          kind === 'image'
            ? 'Foto salva no aparelho!'
            : kind === 'video'
              ? 'Vídeo salvo no aparelho!'
              : 'Áudio salvo no aparelho!'
        );
      }
    } catch {
      notify('Não foi possível salvar o arquivo agora.');
    } finally {
      setMediaBusy(false);
    }
  };

  const handleShareMedia = async (
    mediaUrl: string | undefined,
    kind: 'image' | 'audio' | 'video',
    caption?: string
  ) => {
    if (!mediaUrl || mediaBusy) return;
    setMediaBusy(true);
    try {
      const baseName =
        kind === 'image' ? 'chatfi-foto' : kind === 'video' ? 'chatfi-video' : 'chatfi-audio';
      const fallbackExt = kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : 'webm';
      const { blob, file, filename } = await mediaUrlToBlobAndFile(mediaUrl, baseName, fallbackExt);
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      const shareData: ShareData = {
        files: [file],
        title: 'ChatFi',
        ...(caption && caption !== 'Foto' && caption !== 'Vídeo' ? { text: caption } : {}),
      };

      if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare(shareData))) {
        await nav.share(shareData);
        return;
      }

      // Desktop / unsupported browser fallback: save locally so user can share immediately
      triggerBlobDownload(blob, filename);
      notify(
        kind === 'image'
          ? 'Foto baixada para você compartilhar.'
          : kind === 'video'
            ? 'Vídeo baixado para você compartilhar.'
            : 'Áudio baixado para você compartilhar.'
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      notify('Compartilhamento indisponível neste dispositivo.');
    } finally {
      setMediaBusy(false);
    }
  };

  const handleShareText = async (text: string) => {
    const clean = parseQuotedMessage(text)?.body || text;
    if (!clean.trim()) return;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text: clean });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
    const copied = await copyTextFallback(clean);
    notify(copied ? 'Mensagem copiada para compartilhar!' : 'Não foi possível copiar.');
  };

  const handleCopyText = async (text: string) => {
    const clean = parseQuotedMessage(text)?.body || text;
    const copied = await copyTextFallback(clean);
    notify(copied ? 'Mensagem copiada!' : 'Não foi possível copiar o texto.');
  };

  const handleStartReply = (msg: ChatMessage) => {
    const senderName = msg.senderId === myUid ? 'Você' : peer.name;
    setReplyingTo({
      senderName,
      snippet: getReplySnippet(msg),
    });
    setActionSheetMsg(null);
    window.setTimeout(() => composerInputRef.current?.focus(), 60);
  };

  const handleOpenForward = (msg: ChatMessage) => {
    setActionSheetMsg(null);
    setLightboxMsg(null);
    setForwardSearch('');
    setForwardMsg(msg);
  };

  const handleConfirmForward = async (target: ForwardTarget) => {
    if (!forwardMsg || !onForwardMessage || forwardingUid) return;
    setForwardingUid(target.uid);
    try {
      await onForwardMessage(target, forwardMsg);
      setForwardMsg(null);
    } catch {
      notify('Não foi possível encaminhar a mensagem.');
    } finally {
      setForwardingUid(null);
    }
  };

  // --- SEND TEXT / AUDIO / PHOTO WITH CAPTION PREVIEW ---

  const handleSubmitText = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    const payload = replyingTo
      ? `» ${replyingTo.senderName}: ${replyingTo.snippet}\n${trimmed}`
      : trimmed;

    setDraft('');
    setReplyingTo(null);
    setShowEmojiPicker(false);
    setSending(true);
    try {
      await onSendText(payload);
    } finally {
      setSending(false);
    }
  };

  const startRealRecording = async () => {
    setMediaError('');
    setShowEmojiPicker(false);
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
          if (s >= MAX_AUDIO_SECONDS) {
            void stopAndSendRecording();
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setMediaError('Microfone indisponível. Autorize o acesso em Configurações > Privacidade e Permissões.');
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
      setSending(true);
      try {
        await onSendAudio(blob, durationLabel);
      } catch (err) {
        setMediaError(
          err instanceof Error ? err.message : 'Erro ao enviar mensagem de voz.'
        );
      } finally {
        setSending(false);
      }
    };

    recorder.stop();
  };

  const preparePendingVideo = async (file: File) => {
    if (file.size > MAX_VIDEO_BYTES) {
      setMediaError(
        `Vídeo muito grande (${formatBytesPtBr(file.size)}). O limite máximo é de 25 MB.`
      );
      return;
    }
    const durationLabel = await extractVideoDurationLabel(file);
    const previewUrl = URL.createObjectURL(file);
    setPendingVideo({
      blob: file,
      previewUrl,
      durationLabel,
      sizeBytes: file.size,
      caption: '',
    });
  };

  const handleImagePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMediaError('');
    setShowEmojiPicker(false);
    setSending(true);
    try {
      const detectedKind = classifySharedFile(file);
      if (detectedKind === 'video') {
        await preparePendingVideo(file);
        return;
      }
      if (detectedKind === 'audio') {
        const mimeType = normalizeSharedAudioMimeType(file);
        const audioBlob =
          file.type === mimeType ? file : new Blob([await file.arrayBuffer()], { type: mimeType });
        const durationLabel = await extractAudioDurationLabel(audioBlob);
        await onSendAudio(audioBlob, durationLabel);
        return;
      }
      const { blob } = await compressImageFileToBlob(
        file,
        MAX_IMAGE_WIDTH,
        IMAGE_JPEG_QUALITY
      );
      const previewUrl = URL.createObjectURL(blob);
      setPendingPhoto({
        blob,
        previewUrl,
        sizeBytes: blob.size,
        caption: '',
      });
    } catch (err) {
      setMediaError(
        err instanceof Error ? err.message : 'Não foi possível processar o arquivo selecionado.'
      );
    } finally {
      setSending(false);
    }
  };

  const handleVideoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMediaError('');
    setShowEmojiPicker(false);
    setSending(true);
    try {
      await preparePendingVideo(file);
    } catch {
      setMediaError('Não foi possível preparar o vídeo selecionado.');
    } finally {
      setSending(false);
    }
  };

  const closePendingPhoto = () => {
    if (pendingPhoto) {
      URL.revokeObjectURL(pendingPhoto.previewUrl);
      setPendingPhoto(null);
    }
  };

  const closePendingVideo = () => {
    if (pendingVideo) {
      URL.revokeObjectURL(pendingVideo.previewUrl);
      setPendingVideo(null);
    }
  };

  const handleConfirmSendPendingPhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPhoto || sending) return;
    const { blob, previewUrl, caption } = pendingPhoto;
    setPendingPhoto(null);
    URL.revokeObjectURL(previewUrl);
    setSending(true);
    try {
      await onSendImage(blob, caption.trim() || 'Foto');
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Erro ao enviar foto.');
    } finally {
      setSending(false);
    }
  };

  const handleConfirmSendPendingVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingVideo || sending) return;
    const { blob, previewUrl, durationLabel, caption } = pendingVideo;
    setPendingVideo(null);
    URL.revokeObjectURL(previewUrl);
    setSending(true);
    try {
      await onSendVideo(blob, durationLabel, caption.trim() || '');
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Erro ao enviar vídeo.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-[#ECE5DD]/60">
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
          <button
            type="button"
            onClick={() =>
              onPreviewAvatar?.({
                name: peer.name,
                initials: peer.initials,
                avatarBg: peer.avatarBg,
                avatarUrl: peer.avatarUrl,
                subtitle: peerPresenceDisplay.isPresence
                  ? peerPresenceDisplay.label
                  : peer.phone || peer.storefrontName,
              })
            }
            title="Ver foto de perfil"
            aria-label={`Ampliar foto de ${peer.name}`}
            className="relative shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/40"
          >
            {peer.avatarUrl ? (
              <img
                src={peer.avatarUrl}
                alt={peer.name}
                className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
              />
            ) : (
              <div
                className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: peer.avatarBg || '#0E7A34' }}
              >
                {peer.initials}
              </div>
            )}
            {peerPresenceDisplay.isOnline && (
              <span
                className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-[#0E7A34] ring-2 ring-white"
                aria-label="Online"
              />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold text-slate-900 sm:text-base">
              {peer.name}
            </h2>
            <p
              className={`truncate text-xs ${
                peerPresenceDisplay.isOnline
                  ? 'font-semibold text-[#0E7A34]'
                  : 'text-slate-500'
              }`}
            >
              {peerPresenceDisplay.isOnline
                ? peer.hasStorefront && peer.storefrontName
                  ? `online · ${peer.storefrontName}`
                  : 'online'
                : peerPresenceDisplay.isPresence
                  ? peerPresenceDisplay.label
                  : peer.hasStorefront
                    ? peer.storefrontName || 'Vitrine comercial ativa'
                    : peerPresenceDisplay.label}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {peer.hasStorefront && (
            <button
              type="button"
              onClick={onOpenStorefront}
              title="Abrir vitrine"
              className="flex h-9 items-center gap-1.5 rounded-xl bg-[#0E7A34] px-2.5 text-xs font-semibold text-white transition hover:bg-[#0B5D27] sm:h-10 sm:px-3"
            >
              <Store className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Vitrine</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onStartCall('audio')}
            title="Ligação de voz"
            className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 hover:text-[#0E7A34]"
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

      {/* Discreet Offline Mode Banner inside open chat */}
      {isOffline && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200/80 bg-amber-50/95 px-3.5 py-2 text-xs text-amber-900">
          <div className="flex min-w-0 items-center gap-2">
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span className="truncate font-medium">
              Sem conexão — Suas mensagens serão enviadas assim que o sinal voltar
            </span>
          </div>
          {pendingCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
              <Clock className="h-3 w-3" />
              {pendingCount}
            </span>
          )}
        </div>
      )}

      {/* Messages Stream */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2.5 py-3.5 sm:px-5 space-y-2.5">
        {messages.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p className="text-sm font-semibold text-slate-800">
              Conversa iniciada com {peer.name}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Envie texto, áudio, fotos da câmera ou galeria, ou inicie uma ligação de voz ou vídeo em tela cheia.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderId === myUid;
            const parsedQuote =
              msg.type === 'text' ? parseQuotedMessage(msg.text) : null;
            const resolvedState = resolvedMedia[msg.id];
            const resolvedUrl = getResolvedMediaUrl(msg);
            const hasRealCaption =
              (msg.type === 'image' || msg.type === 'video') &&
              Boolean(msg.text) &&
              msg.text.trim() !== 'Foto' &&
              msg.text.trim() !== 'Vídeo' &&
              !msg.text.trim().startsWith('Vídeo (') &&
              !/^[\w-]+\.(jpe?g|png|webp|heic|gif|mp4|mov|webm)$/i.test(msg.text.trim());

            const mediaStatusPlaceholder = (kindLabel: string) => {
              const st = resolvedState?.status;
              if (st === 'deleted_locally') {
                return (
                  <div
                    className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs ${
                      isMine ? 'bg-white/10 text-emerald-100' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Trash2 className="h-4 w-4 shrink-0 opacity-75" />
                    <span>{kindLabel} apagado deste aparelho</span>
                  </div>
                );
              }
              if (st === 'expired') {
                return (
                  <div
                    className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs ${
                      isMine ? 'bg-white/10 text-emerald-100' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Clock className="h-4 w-4 shrink-0 opacity-75" />
                    <span>Mídia expirada (mais de 14 dias sem receber)</span>
                  </div>
                );
              }
              if (st === 'offline_waiting') {
                return (
                  <div
                    className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs ${
                      isMine ? 'bg-white/10 text-emerald-100' : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    <WifiOff className="h-4 w-4 shrink-0" />
                    <span>Sem sinal — {kindLabel.toLowerCase()} será baixado quando a internet voltar</span>
                  </div>
                );
              }
              return (
                <div
                  className={`flex items-center gap-2 rounded-xl px-3 py-3 text-xs ${
                    isMine ? 'bg-white/10 text-emerald-50' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  <span>
                    Baixando {kindLabel.toLowerCase()} para o aparelho
                    {msg.mediaSizeBytes ? ` (${formatBytesPtBr(msg.mediaSizeBytes)})` : ''}...
                  </span>
                </div>
              );
            };

            return (
              <div
                key={msg.id}
                className={`group flex ${isMine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`relative max-w-[86%] min-w-0 overflow-hidden break-words rounded-2xl shadow-sm sm:max-w-[70%] ${
                    msg.type === 'image' || msg.type === 'video' ? 'p-1.5' : 'px-3.5 py-2'
                  } ${
                    isMine
                      ? 'rounded-br-sm bg-[#0E7A34] text-white'
                      : 'rounded-bl-sm border border-slate-200/90 bg-white text-slate-800'
                  }`}
                >
                  {/* WhatsApp-style Message Options Trigger */}
                  <button
                    type="button"
                    onClick={() => setActionSheetMsg(msg)}
                    aria-label="Opções da mensagem"
                    title="Opções da mensagem"
                    className={`absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full transition ${
                      msg.type === 'image' || msg.type === 'video'
                        ? 'bg-black/50 text-white hover:bg-black/70'
                        : isMine
                          ? 'bg-[#0E7A34]/85 text-emerald-100 hover:bg-white/20 hover:text-white'
                          : 'bg-white/90 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                    }`}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>

                  {msg.type === 'audio' ? (
                    <div className="pr-6">
                      {resolvedUrl ? (
                        <RealAudioBubble
                          mediaUrl={resolvedUrl}
                          duration={msg.audioDuration}
                          isMine={isMine}
                        />
                      ) : (
                        mediaStatusPlaceholder('Áudio')
                      )}
                    </div>
                  ) : msg.type === 'image' ? (
                    <div className="space-y-1.5">
                      {resolvedUrl ? (
                        <button
                          type="button"
                          onClick={() => setLightboxMsg(msg)}
                          className="block w-full overflow-hidden rounded-xl bg-black/10"
                        >
                          <img
                            src={resolvedUrl}
                            alt={hasRealCaption ? msg.text : 'Foto enviada'}
                            className="max-h-72 w-full rounded-xl object-cover"
                          />
                        </button>
                      ) : (
                        <div className="pr-7">{mediaStatusPlaceholder('Foto')}</div>
                      )}
                      {hasRealCaption && (
                        <p className="px-1.5 text-sm leading-snug">{msg.text}</p>
                      )}
                      {/* Instant WhatsApp-style Save / Share / Forward buttons right on every photo */}
                      {resolvedUrl && (
                        <div
                          className={`flex items-center gap-1 px-1 pt-0.5 ${
                            isMine ? 'border-t border-white/15' : 'border-t border-slate-100'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void handleSaveMedia(resolvedUrl, 'image')}
                            disabled={mediaBusy}
                            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${
                              isMine
                                ? 'text-emerald-50 hover:bg-white/15'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Download className="h-3.5 w-3.5 shrink-0" />
                            <span>Salvar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleShareMedia(
                                resolvedUrl,
                                'image',
                                hasRealCaption ? msg.text : undefined
                              )
                            }
                            disabled={mediaBusy}
                            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${
                              isMine
                                ? 'text-emerald-50 hover:bg-white/15'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Share2 className="h-3.5 w-3.5 shrink-0" />
                            <span>Compartilhar</span>
                          </button>
                          {onForwardMessage && (
                            <button
                              type="button"
                              onClick={() => handleOpenForward(msg)}
                              className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                                isMine
                                  ? 'text-emerald-50 hover:bg-white/15'
                                  : 'text-slate-700 hover:bg-slate-100'
                              }`}
                              title="Encaminhar foto"
                            >
                              <Forward className="h-3.5 w-3.5 shrink-0" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : msg.type === 'video' ? (
                    <div className="space-y-1.5">
                      {resolvedUrl ? (
                        <div className="relative overflow-hidden rounded-xl bg-black">
                          <video
                            src={resolvedUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="max-h-72 w-full rounded-xl bg-black object-contain"
                          />
                          {(msg.videoDuration || msg.mediaSizeBytes) && (
                            <div className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
                              <Film className="h-3 w-3" />
                              {msg.videoDuration && <span>{msg.videoDuration}</span>}
                              {msg.mediaSizeBytes && (
                                <span className="opacity-80">
                                  {formatBytesPtBr(msg.mediaSizeBytes)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="pr-7">{mediaStatusPlaceholder('Vídeo')}</div>
                      )}
                      {hasRealCaption && (
                        <p className="px-1.5 text-sm leading-snug">{msg.text}</p>
                      )}
                      {resolvedUrl && (
                        <div
                          className={`flex items-center gap-1 px-1 pt-0.5 ${
                            isMine ? 'border-t border-white/15' : 'border-t border-slate-100'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void handleSaveMedia(resolvedUrl, 'video')}
                            disabled={mediaBusy}
                            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${
                              isMine
                                ? 'text-emerald-50 hover:bg-white/15'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Download className="h-3.5 w-3.5 shrink-0" />
                            <span>Salvar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleShareMedia(
                                resolvedUrl,
                                'video',
                                hasRealCaption ? msg.text : undefined
                              )
                            }
                            disabled={mediaBusy}
                            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition ${
                              isMine
                                ? 'text-emerald-50 hover:bg-white/15'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Share2 className="h-3.5 w-3.5 shrink-0" />
                            <span>Compartilhar</span>
                          </button>
                          {onForwardMessage && (
                            <button
                              type="button"
                              onClick={() => handleOpenForward(msg)}
                              className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                                isMine
                                  ? 'text-emerald-50 hover:bg-white/15'
                                  : 'text-slate-700 hover:bg-slate-100'
                              }`}
                              title="Encaminhar vídeo"
                            >
                              <Forward className="h-3.5 w-3.5 shrink-0" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : msg.type === 'order_card' ? (
                    <div
                      className={`mr-6 rounded-xl border p-3 ${
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
                            ? 'bg-white text-[#0E7A34] hover:bg-slate-100'
                            : 'bg-[#0D2B3E] text-white hover:bg-[#143d57]'
                        }`}
                      >
                        Abrir detalhes do pedido
                      </button>
                    </div>
                  ) : msg.type === 'billing_reminder' ? (
                    <div
                      className={`mr-6 rounded-xl border p-3 ${
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
                  ) : parsedQuote ? (
                    <div className="pr-6">
                      <div
                        className={`mb-1.5 rounded-lg border-l-4 px-2.5 py-1.5 text-xs ${
                          isMine
                            ? 'border-emerald-300 bg-black/20 text-emerald-50'
                            : 'border-[#0E7A34] bg-slate-100 text-slate-600'
                        }`}
                      >
                        <p
                          className={`font-bold ${
                            isMine ? 'text-emerald-200' : 'text-[#0E7A34]'
                          }`}
                        >
                          {parsedQuote.quoteSender}
                        </p>
                        <p className="line-clamp-2 opacity-90">
                          {parsedQuote.quoteSnippet}
                        </p>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {parsedQuote.body}
                      </p>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap pr-6 text-sm leading-relaxed">
                      {msg.text}
                    </p>
                  )}

                  <div
                    className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                      msg.type === 'image' || msg.type === 'video' ? 'px-1.5 pb-0.5' : ''
                    } ${isMine ? 'text-emerald-100/80' : 'text-slate-400'}`}
                  >
                    {msg.viaMesh && (
                      <span
                        title="Entregue via rede local Mesh"
                        className="inline-flex items-center gap-0.5 opacity-90"
                      >
                        <Radio className="h-3 w-3" />
                      </span>
                    )}
                    <span className="font-mono tabular-nums">{msg.timestamp}</span>
                    {isMine &&
                      (msg.deliveryStatus === 'pending' || msg.deliveryStatus === 'sending' ? (
                        <span
                          title="Aguardando rede"
                          className="inline-flex items-center gap-0.5 text-amber-200"
                        >
                          <Clock className="h-3.5 w-3.5" />
                          <span className="text-[9px] font-semibold">
                            {msg.deliveryStatus === 'sending' ? 'Enviando...' : 'Aguardando rede'}
                          </span>
                        </span>
                      ) : msg.mediaDelivered === false ? (
                        <span title="Enviado — aguardando aparelho do contato baixar">
                          <Check className="h-3.5 w-3.5 text-emerald-100/80" />
                        </span>
                      ) : msg.mediaDelivered === true ? (
                        <span title="Entregue e salvo no aparelho do contato">
                          <CheckCheck className="h-3.5 w-3.5 text-sky-300" />
                        </span>
                      ) : (
                        <CheckCheck className="h-3.5 w-3.5" />
                      ))}
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
        <div className="flex items-center justify-between border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
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

      {/* WhatsApp-style Reply Preview Bar */}
      {replyingTo && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
          <div className="min-w-0 flex-1 border-l-4 border-[#0E7A34] pl-2.5">
            <p className="truncate text-xs font-bold text-[#0E7A34]">
              Respondendo a {replyingTo.senderName}
            </p>
            <p className="truncate text-xs text-slate-600">{replyingTo.snippet}</p>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            aria-label="Cancelar resposta"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Quick Emoji Picker Drawer */}
      {showEmojiPicker && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2.5">
          <div className="grid grid-cols-8 gap-1 sm:grid-cols-16">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setDraft((prev) => prev + emoji);
                  composerInputRef.current?.focus();
                }}
                className="flex h-9 items-center justify-center rounded-lg text-xl transition hover:bg-slate-100 active:scale-95"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Composer */}
      <footer className="shrink-0 border-t border-slate-200 bg-white px-2 pt-2 pb-safe sm:px-4">
        {/* Gallery photo, video & phone/WhatsApp audio picker */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*,video/*,audio/*,.opus,.ogg,.mp3,.m4a,.aac,.wav,.amr,.3gp"
          onChange={handleImagePicked}
          className="hidden"
        />
        {/* Direct video picker (up to 25 MB) */}
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          onChange={handleVideoPicked}
          className="hidden"
        />
        {/* Direct mobile camera capture */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImagePicked}
          className="hidden"
        />

        {recording ? (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-600" />
              <span className="truncate text-xs font-semibold text-red-700">
                Gravando...
              </span>
              <span className="shrink-0 font-mono text-xs font-bold text-red-800 tabular-nums">
                {Math.floor(recordSeconds / 60)}:
                {(recordSeconds % 60).toString().padStart(2, '0')} / 3:00
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={cancelRecording}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                title="Cancelar gravação"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void stopAndSendRecording()}
                className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0E7A34] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0B5D27]"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Enviar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitText} className="flex w-full min-w-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              title="Emojis"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition sm:h-11 sm:w-11 ${
                showEmojiPicker
                  ? 'border-[#0E7A34] bg-emerald-50 text-[#0E7A34]'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
              aria-label="Abrir emojis"
            >
              <Smile className="h-5 w-5" />
            </button>

            <input
              ref={composerInputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setShowEmojiPicker(false)}
              placeholder="Mensagem"
              className="h-9 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0E7A34] focus:bg-white focus:outline-none sm:h-11"
            />

            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              disabled={sending}
              title="Enviar foto, vídeo ou áudio do aparelho"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-[#0E7A34] sm:h-11 sm:w-11"
              aria-label="Galeria de fotos e áudios"
            >
              <ImageIcon className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={sending}
              title="Enviar vídeo (até 25 MB)"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-[#0E7A34] sm:h-11 sm:w-11"
              aria-label="Enviar vídeo"
            >
              <Film className="h-5 w-5" />
            </button>

            {!draft.trim() && (
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={sending}
                title="Tirar foto com a câmera"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-[#0E7A34] sm:h-11 sm:w-11"
                aria-label="Câmera"
              >
                <Camera className="h-5 w-5" />
              </button>
            )}

            {draft.trim() ? (
              <button
                type="submit"
                disabled={sending}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0E7A34] text-white transition hover:bg-[#0B5D27] disabled:opacity-50 sm:h-11 sm:w-11"
                aria-label="Enviar mensagem"
              >
                <Send className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startRealRecording()}
                disabled={sending}
                title="Gravar mensagem de voz (até 3 min)"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0E7A34] text-white transition hover:bg-[#0B5D27] disabled:opacity-50 sm:h-11 sm:w-11"
                aria-label="Gravar áudio"
              >
                <Mic className="h-5 w-5" />
              </button>
            )}
          </form>
        )}
      </footer>

      {/* WhatsApp-style Photo Caption Preview Modal (before sending) */}
      {pendingPhoto && (
        <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-black text-white">
          <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-safe">
            <button
              type="button"
              onClick={closePendingPhoto}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="Cancelar envio de foto"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="text-center">
              <p className="text-sm font-bold">Enviar foto</p>
              <p className="text-[11px] text-white/70">
                Para {peer.name} · {formatBytesPtBr(pendingPhoto.sizeBytes)}
              </p>
            </div>
            <div className="h-10 w-10" />
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            <img
              src={pendingPhoto.previewUrl}
              alt="Prévia da foto"
              className="max-h-full max-w-full rounded-xl object-contain"
            />
          </div>

          <form
            onSubmit={handleConfirmSendPendingPhoto}
            className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-black/90 px-3 pt-3 pb-safe sm:px-5"
          >
            <input
              type="text"
              value={pendingPhoto.caption}
              onChange={(e) =>
                setPendingPhoto((prev) =>
                  prev ? { ...prev, caption: e.target.value } : null
                )
              }
              placeholder="Adicione uma legenda..."
              className="h-11 min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-4 text-sm text-white placeholder:text-white/55 focus:border-emerald-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0E7A34] text-white shadow-lg transition hover:bg-[#0B5D27] active:scale-95"
              aria-label="Confirmar envio da foto"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
        </div>
      )}

      {/* WhatsApp-style Video Caption Preview Modal (before sending, up to 25 MB) */}
      {pendingVideo && (
        <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-black text-white">
          <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-safe">
            <button
              type="button"
              onClick={closePendingVideo}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="Cancelar envio de vídeo"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="text-center">
              <p className="text-sm font-bold">Enviar vídeo</p>
              <p className="text-[11px] text-white/70">
                Para {peer.name}
                {pendingVideo.durationLabel ? ` · ${pendingVideo.durationLabel}` : ''} ·{' '}
                {formatBytesPtBr(pendingVideo.sizeBytes)}
              </p>
            </div>
            <div className="h-10 w-10" />
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            <video
              src={pendingVideo.previewUrl}
              controls
              playsInline
              className="max-h-full max-w-full rounded-xl bg-black"
            />
          </div>

          <form
            onSubmit={handleConfirmSendPendingVideo}
            className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-black/90 px-3 pt-3 pb-safe sm:px-5"
          >
            <input
              type="text"
              value={pendingVideo.caption}
              onChange={(e) =>
                setPendingVideo((prev) =>
                  prev ? { ...prev, caption: e.target.value } : null
                )
              }
              placeholder="Adicione uma legenda para o vídeo..."
              className="h-11 min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-4 text-sm text-white placeholder:text-white/55 focus:border-emerald-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0E7A34] text-white shadow-lg transition hover:bg-[#0B5D27] active:scale-95"
              aria-label="Confirmar envio do vídeo"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
        </div>
      )}

      {/* Full-Screen WhatsApp-Style Photo Viewer (Save + Share + Forward) */}
      {lightboxMsg && getResolvedMediaUrl(lightboxMsg) && (
        <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-black text-white">
          {/* Viewer Top Bar */}
          <div className="flex shrink-0 items-center justify-between gap-2 bg-gradient-to-b from-black/85 to-transparent px-3 pb-3 pt-safe sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setLightboxMsg(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Fechar foto"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">
                  {lightboxMsg.senderId === myUid ? myName || 'Você' : peer.name}
                </p>
                <p className="text-[11px] text-white/70">{lightboxMsg.timestamp}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void handleSaveMedia(getResolvedMediaUrl(lightboxMsg), 'image')
                }
                disabled={mediaBusy}
                title="Salvar foto"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <Download className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleShareMedia(
                    getResolvedMediaUrl(lightboxMsg),
                    'image',
                    lightboxMsg.text && lightboxMsg.text !== 'Foto'
                      ? lightboxMsg.text
                      : undefined
                  )
                }
                disabled={mediaBusy}
                title="Compartilhar foto"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <Share2 className="h-5 w-5" />
              </button>
              {onForwardMessage && (
                <button
                  type="button"
                  onClick={() => handleOpenForward(lightboxMsg)}
                  title="Encaminhar foto"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                >
                  <Forward className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          {/* Center Photo Canvas */}
          <div className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-6">
            <img
              src={getResolvedMediaUrl(lightboxMsg)}
              alt={lightboxMsg.text || 'Visualização da foto'}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          {/* Bottom Caption + Clear Thumb-Friendly Action Bar */}
          <div className="shrink-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-4 pt-3 pb-safe">
            {lightboxMsg.text &&
              lightboxMsg.text.trim() !== 'Foto' &&
              !/^[\w-]+\.(jpe?g|png|webp|heic|gif)$/i.test(lightboxMsg.text.trim()) && (
                <p className="mb-3 text-center text-sm text-white/95">
                  {lightboxMsg.text}
                </p>
              )}
            <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  void handleSaveMedia(getResolvedMediaUrl(lightboxMsg), 'image')
                }
                disabled={mediaBusy}
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/25 active:scale-95"
              >
                <Download className="h-4 w-4 shrink-0" />
                <span>Salvar</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleShareMedia(
                    getResolvedMediaUrl(lightboxMsg),
                    'image',
                    lightboxMsg.text && lightboxMsg.text !== 'Foto'
                      ? lightboxMsg.text
                      : undefined
                  )
                }
                disabled={mediaBusy}
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#0B5D27] active:scale-95"
              >
                <Share2 className="h-4 w-4 shrink-0" />
                <span>Compartilhar</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onForwardMessage
                    ? handleOpenForward(lightboxMsg)
                    : setLightboxMsg(null)
                }
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/25 active:scale-95"
              >
                <Forward className="h-4 w-4 shrink-0" />
                <span>Encaminhar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp-Style Message Action Sheet (Responder, Encaminhar, Salvar, Compartilhar, Copiar) */}
      {actionSheetMsg && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center"
          onClick={() => setActionSheetMsg(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl pb-safe sm:pb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900">Opções da mensagem</p>
                <p className="truncate text-[11px] text-slate-500">
                  {getReplySnippet(actionSheetMsg)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionSheetMsg(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              <button
                type="button"
                onClick={() => handleStartReply(actionSheetMsg)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                <Reply className="h-4 w-4 text-[#0E7A34]" />
                <span>Responder</span>
              </button>

              {onForwardMessage &&
                (actionSheetMsg.type === 'text' ||
                  ((actionSheetMsg.type === 'image' ||
                    actionSheetMsg.type === 'audio' ||
                    actionSheetMsg.type === 'video') &&
                    Boolean(getResolvedMediaUrl(actionSheetMsg)))) && (
                  <button
                    type="button"
                    onClick={() => handleOpenForward(actionSheetMsg)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Forward className="h-4 w-4 text-[#0D2B3E]" />
                    <span>Encaminhar para contato</span>
                  </button>
                )}

              {actionSheetMsg.type === 'image' && getResolvedMediaUrl(actionSheetMsg) && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const url = getResolvedMediaUrl(actionSheetMsg);
                      setActionSheetMsg(null);
                      void handleSaveMedia(url, 'image');
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4 text-[#0E7A34]" />
                    <span>Salvar foto no aparelho</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = getResolvedMediaUrl(actionSheetMsg);
                      const cap = actionSheetMsg.text;
                      setActionSheetMsg(null);
                      void handleShareMedia(url, 'image', cap);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Share2 className="h-4 w-4 text-[#0E7A34]" />
                    <span>Compartilhar foto</span>
                  </button>
                </>
              )}

              {actionSheetMsg.type === 'video' && getResolvedMediaUrl(actionSheetMsg) && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const url = getResolvedMediaUrl(actionSheetMsg);
                      setActionSheetMsg(null);
                      void handleSaveMedia(url, 'video');
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4 text-[#0E7A34]" />
                    <span>Salvar vídeo no aparelho</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = getResolvedMediaUrl(actionSheetMsg);
                      const cap = actionSheetMsg.text;
                      setActionSheetMsg(null);
                      void handleShareMedia(url, 'video', cap);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Share2 className="h-4 w-4 text-[#0E7A34]" />
                    <span>Compartilhar vídeo</span>
                  </button>
                </>
              )}

              {actionSheetMsg.type === 'audio' && getResolvedMediaUrl(actionSheetMsg) && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const url = getResolvedMediaUrl(actionSheetMsg);
                      setActionSheetMsg(null);
                      void handleSaveMedia(url, 'audio');
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4 text-[#0E7A34]" />
                    <span>Salvar áudio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = getResolvedMediaUrl(actionSheetMsg);
                      setActionSheetMsg(null);
                      void handleShareMedia(url, 'audio');
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Share2 className="h-4 w-4 text-[#0E7A34]" />
                    <span>Compartilhar áudio</span>
                  </button>
                </>
              )}

              {actionSheetMsg.type === 'text' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const txt = actionSheetMsg.text;
                      setActionSheetMsg(null);
                      void handleCopyText(txt);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Copy className="h-4 w-4 text-slate-600" />
                    <span>Copiar mensagem</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const txt = actionSheetMsg.text;
                      setActionSheetMsg(null);
                      void handleShareText(txt);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Share2 className="h-4 w-4 text-[#0E7A34]" />
                    <span>Compartilhar texto</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp-Style Forward Picker Modal */}
      {forwardMsg && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onClick={() => setForwardMsg(null)}
        >
          <div
            className="flex max-h-[82dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3.5">
              <div>
                <h3 className="text-base font-bold text-slate-900">Encaminhar para...</h3>
                <p className="text-xs text-slate-500">{getReplySnippet(forwardMsg)}</p>
              </div>
              <button
                type="button"
                onClick={() => setForwardMsg(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="shrink-0 border-b border-slate-100 px-4 py-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  inputMode="search"
                  autoComplete="off"
                  value={forwardSearch}
                  onChange={(e) => setForwardSearch(e.target.value)}
                  placeholder="Buscar pessoa no ChatFi..."
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-[#0E7A34] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto pb-safe">
              {filteredForwardTargets.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Nenhum contato encontrado no ChatFi.
                </div>
              ) : (
                filteredForwardTargets.map((target) => (
                  <button
                    key={target.uid}
                    type="button"
                    disabled={Boolean(forwardingUid)}
                    onClick={() => void handleConfirmForward(target)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-emerald-50/50 disabled:opacity-50"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {target.avatarUrl ? (
                        <img
                          src={target.avatarUrl}
                          alt={target.name}
                          className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                          style={{ backgroundColor: target.avatarBg || '#0E7A34' }}
                        >
                          {target.initials}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">
                          {target.name}
                        </p>
                        {target.subtitle && (
                          <p className="truncate text-xs text-slate-500">
                            {target.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-lg bg-[#0E7A34] px-2.5 py-1.5 text-xs font-semibold text-white">
                      {forwardingUid === target.uid ? 'Enviando...' : 'Enviar'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
