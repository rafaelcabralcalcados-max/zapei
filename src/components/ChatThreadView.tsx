import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  Film,
  Forward,
  Image as ImageIcon,
  Loader2,
  Mic,
  Pause,
  Phone,
  Play,
  Printer,
  Radio,
  Receipt,
  Reply,
  Search,
  Send,
  Share2,
  Smile,
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
  MAX_IMAGE_WIDTH,
  MAX_MEDIA_BYTES,
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
import { unlockCallAudio } from '../lib/webrtcService';
import { BACK_PRIORITY, useSystemBackHandler } from '../lib/backNavigation';
import type { AvatarPreviewTarget } from './AvatarLightboxModal';
import { PdfViewerCanvas, renderPdfToPrintHtml } from './PdfViewerCanvas';
import { StarRatingBadge } from './StarRatingBadge';

const PT_BR_WEEKDAYS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
] as const;

function getLocalDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function formatMessageShortDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatChatDaySeparatorLabel(ms: number, nowMs: number): string {
  const msgDate = new Date(ms);
  const nowDate = new Date(nowMs);
  const msgMidnight = new Date(
    msgDate.getFullYear(),
    msgDate.getMonth(),
    msgDate.getDate()
  ).getTime();
  const todayMidnight = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  ).getTime();
  const diffDays = Math.round((todayMidnight - msgMidnight) / 86_400_000);

  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  if (diffDays >= 2 && diffDays < 7) {
    return PT_BR_WEEKDAYS[msgDate.getDay()];
  }
  return formatMessageShortDate(ms);
}

export interface ActiveChatPeer {
  uid: string;
  name: string;
  initials: string;
  avatarBg: string;
  avatarUrl?: string;
  phone?: string;
  virtualLine?: string;
  role: 'normal' | 'reseller' | 'manufacturer';
  hasStorefront: boolean;
  storefrontName?: string;
  deliveryPolicyLabel?: string;
  ratingAverage?: number;
  ratingCount?: number;
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
  myAvatarUrl?: string;
  myInitials?: string;
  myAvatarBg?: string;
  peer: ActiveChatPeer;
  peerPresence?: PresenceSnapshot | null;
  messages: ChatMessage[];
  forwardTargets?: ForwardTarget[];
  isOffline?: boolean;
  pendingCount?: number;
  onBack?: () => void;
  onSendText: (text: string) => Promise<void>;
  onSendAudio: (blob: Blob, durationLabel: string, caption?: string) => Promise<void>;
  onSendImage: (blob: Blob, caption: string) => Promise<void>;
  onSendVideo: (blob: Blob, durationLabel: string, caption: string) => Promise<void>;
  onSendPdf?: (blob: Blob, fileName: string) => Promise<void>;
  onForwardMessage?: (target: ForwardTarget, msg: ChatMessage) => Promise<void>;
  onNotify?: (message: string) => void;
  onStartCall: (type: 'audio' | 'video') => void;
  onOpenStorefront: () => void;
  onInspectOrder: (orderId?: string) => void;
  onPreviewAvatar?: (target: AvatarPreviewTarget) => void;
  prefilledDraft?: { id: string; text: string } | null;
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

function isPdfMessage(
  msg: Pick<ChatMessage, 'type' | 'mediaMimeType' | 'mediaUrl' | 'text'>,
  resolvedMimeType?: string
): boolean {
  const mime = (resolvedMimeType || msg.mediaMimeType || '').toLowerCase();
  if (mime === 'application/pdf' || mime.endsWith('/pdf')) return true;
  const url = (msg.mediaUrl || '').toLowerCase();
  if (url.startsWith('data:application/pdf') || /\.pdf(\?|$)/i.test(url)) return true;
  if (msg.type === 'image' && /\.pdf$/i.test((msg.text || '').trim())) return true;
  return false;
}

function getExtensionFromMime(mime: string, fallback: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('pdf')) return 'pdf';
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
  const defaultMime =
    fallbackExt === 'pdf'
      ? 'application/pdf'
      : fallbackExt === 'jpg'
        ? 'image/jpeg'
        : fallbackExt === 'mp4'
          ? 'video/mp4'
          : 'audio/webm';
  let blob: Blob;
  if (mediaUrl.startsWith('data:')) {
    const commaIdx = mediaUrl.indexOf(',');
    const header = mediaUrl.slice(0, commaIdx);
    const dataPart = mediaUrl.slice(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : defaultMime;
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
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32) || 'chatfi-midia';
  const filename = `${safeBase}-${Date.now().toString().slice(-5)}.${ext}`;
  const file = new File([blob], filename, {
    type: blob.type || defaultMime,
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
  const parsed = parseQuotedMessage(msg.text || '');
  const cleanBody = (parsed ? parsed.body : msg.text || '').trim();
  if (isPdfMessage(msg)) {
    return `📄 ${cleanBody || 'Documento.pdf'}`.slice(0, 72);
  }
  if (msg.type === 'image') {
    const cleanCaption = cleanBody && cleanBody !== 'Foto' ? ` — ${cleanBody}` : '';
    return `📷 Foto${cleanCaption}`.slice(0, 72);
  }
  if (msg.type === 'video') {
    const cleanCaption =
      cleanBody && cleanBody !== 'Vídeo' && !cleanBody.startsWith('Vídeo (')
        ? ` — ${cleanBody}`
        : '';
    return `🎬 Vídeo${cleanCaption}`.slice(0, 72);
  }
  if (msg.type === 'audio') {
    return `🎤 Mensagem de voz (${msg.audioDuration || '0:00'})`;
  }
  if (msg.type === 'order_card') {
    return `📦 Pedido ${msg.orderCode || ''}`.trim();
  }
  return cleanBody.replace(/\s+/g, ' ').trim().slice(0, 72);
}

function formatAudioSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseAudioDurationLabel(label?: string): number {
  if (!label) return 0;
  const parts = label.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

const WAVEFORM_BARS = [
  28, 46, 62, 42, 74, 58, 36, 68, 84, 52, 40, 76, 90, 64,
  44, 72, 56, 82, 48, 66, 38, 70, 54, 60, 42, 50, 34, 44,
];

let activeChatAudioElement: HTMLMediaElement | null = null;
let activeChatAudioToken = 0;
const registeredAudioStoppers = new Map<string, () => void>();

function stopAllChatMediaExcept(
  keepEl: HTMLMediaElement | null,
  keepBubbleKey?: string
): number {
  activeChatAudioToken += 1;
  activeChatAudioElement = keepEl;

  registeredAudioStoppers.forEach((stopFn, key) => {
    if (key !== keepBubbleKey) {
      try {
        stopFn();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  if (typeof document !== 'undefined') {
    const mediaEls = document.querySelectorAll<HTMLMediaElement>(
      'audio[data-chatfi-voice="1"], video[data-chatfi-media="1"]'
    );
    mediaEls.forEach((mediaEl) => {
      if (mediaEl !== keepEl && !mediaEl.paused) {
        try {
          mediaEl.pause();
        } catch {
          // Ignore pause errors
        }
      }
    });
  }

  return activeChatAudioToken;
}

const LISTENED_AUDIO_STORAGE_PREFIX = 'chatfi_listened_audios_v1_';
const MAX_LISTENED_AUDIO_RECORDS = 1500;

function readListenedAudioIds(uid: string): Set<string> {
  if (!uid || typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(`${LISTENED_AUDIO_STORAGE_PREFIX}${uid}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
    }
  } catch {
    // Ignore storage read errors
  }
  return new Set();
}

function persistListenedAudioIds(uid: string, ids: Set<string>): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    const arr = Array.from(ids);
    const trimmed =
      arr.length > MAX_LISTENED_AUDIO_RECORDS
        ? arr.slice(arr.length - MAX_LISTENED_AUDIO_RECORDS)
        : arr;
    window.localStorage.setItem(
      `${LISTENED_AUDIO_STORAGE_PREFIX}${uid}`,
      JSON.stringify(trimmed)
    );
  } catch {
    // Ignore quota / storage errors
  }
}

const RealAudioBubble: React.FC<{
  mediaUrl?: string;
  duration?: string;
  isMine: boolean;
  isListened?: boolean;
  isPlaying: boolean;
  currentSec: number;
  measuredDurationSec?: number;
  speed: 1 | 1.5 | 2;
  senderName: string;
  senderAvatarUrl?: string;
  senderInitials?: string;
  senderAvatarBg?: string;
  onTogglePlay: () => void;
  onSeek: (nextSec: number, isDraggingNow: boolean) => void;
  onCycleSpeed: () => void;
}> = ({
  mediaUrl,
  duration,
  isMine,
  isListened = false,
  isPlaying,
  currentSec,
  measuredDurationSec,
  speed,
  senderName,
  senderAvatarUrl,
  senderInitials,
  senderAvatarBg,
  onTogglePlay,
  onSeek,
  onCycleSpeed,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const fallbackSec = useMemo(() => parseAudioDurationLabel(duration), [duration]);
  const effectiveDuration =
    measuredDurationSec && Number.isFinite(measuredDurationSec) && measuredDurationSec > 0
      ? measuredDurationSec
      : fallbackSec;
  const progressRatio =
    effectiveDuration > 0
      ? Math.max(0, Math.min(1, currentSec / effectiveDuration))
      : 0;
  const progressPct = progressRatio * 100;

  const seekToClientX = (clientX: number, isDraggingNow: boolean) => {
    const track = trackRef.current;
    if (!track || effectiveDuration <= 0) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const nextSec = ratio * effectiveDuration;
    onSeek(nextSec, isDraggingNow);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!mediaUrl) return;
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore unsupported capture
    }
    seekToClientX(e.clientX, true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekToClientX(e.clientX, true);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekToClientX(e.clientX, false);
    draggingRef.current = false;
    setDragging(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!mediaUrl || effectiveDuration <= 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 3 : -3;
      const next = Math.max(0, Math.min(effectiveDuration, currentSec + delta));
      onSeek(next, false);
    }
  };

  const displayTimeLabel =
    isPlaying || currentSec > 0 || dragging
      ? `${formatAudioSeconds(currentSec)} / ${
          effectiveDuration > 0 ? formatAudioSeconds(effectiveDuration) : duration || '0:00'
        }`
      : effectiveDuration > 0
        ? formatAudioSeconds(effectiveDuration)
        : duration || '0:00';

  return (
    <div className="flex min-w-[236px] sm:min-w-[260px] items-center gap-2.5 py-0.5 select-none">
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={!mediaUrl}
        className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-xs transition active:scale-95 disabled:opacity-40 ${
          isMine
            ? isListened
              ? 'ring-2 ring-sky-200/85'
              : 'ring-2 ring-white/45'
            : isListened
              ? 'ring-2 ring-[#0284C7]'
              : 'ring-2 ring-[#0E7A34]'
        }`}
        aria-label={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
      >
        {senderAvatarUrl ? (
          <img
            src={senderAvatarUrl}
            alt={senderName}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center rounded-full text-xs font-bold text-white"
            style={{
              backgroundColor:
                senderAvatarBg || (isListened ? '#0284C7' : '#0E7A34'),
            }}
          >
            {senderInitials || senderName.slice(0, 2).toUpperCase()}
          </span>
        )}

        {/* Show crisp Pause overlay while actively playing so pausing is effortless */}
        {isPlaying && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[1px]">
            <Pause className="h-4 w-4 fill-white/95" />
          </span>
        )}

        {/* Small corner play/voice badge indicating tap-to-play & listened state */}
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full text-white shadow-xs ring-2 ${
            isMine
              ? isListened
                ? 'bg-[#0284C7] ring-[#0B632A]'
                : 'bg-[#16A34A] ring-[#0B632A]'
              : isListened
                ? 'bg-[#0284C7] ring-sky-50'
                : 'bg-[#0E7A34] ring-white'
          }`}
        >
          {isPlaying ? (
            <Mic className="h-2.5 w-2.5" />
          ) : (
            <Play className="h-2.5 w-2.5 fill-white ml-[1px]" />
          )}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <div
          ref={trackRef}
          role="slider"
          aria-label="Progresso do áudio"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPct)}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          className="relative flex h-8 cursor-pointer touch-none items-center"
        >
          {/* Smooth waveform bars synced directly to playback ratio */}
          <div className="flex h-6 w-full items-center justify-between gap-[2px]">
            {WAVEFORM_BARS.map((heightPct, idx) => {
              const barThreshold = (idx + 0.5) / WAVEFORM_BARS.length;
              const isFilled = progressRatio >= barThreshold;
              return (
                <span
                  key={idx}
                  className={`block flex-1 rounded-full transition-colors ${
                    isFilled
                      ? isMine
                        ? isListened
                          ? 'bg-sky-200'
                          : 'bg-white'
                        : isListened
                          ? 'bg-[#0284C7]'
                          : 'bg-[#0E7A34]'
                      : isMine
                        ? isListened
                          ? 'bg-sky-200/35'
                          : 'bg-white/30'
                        : isListened
                          ? 'bg-sky-200'
                          : 'bg-slate-300/90'
                  }`}
                  style={{ height: `${heightPct}%` }}
                />
              );
            })}
          </div>
          {/* Draggable scrubber thumb */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-xs transition-colors ${
              dragging ? 'scale-110' : ''
            } ${
              isMine
                ? isListened
                  ? 'bg-sky-300 ring-2 ring-[#0B632A]'
                  : 'bg-white ring-2 ring-[#0E7A34]'
                : isListened
                  ? 'bg-[#0284C7] ring-2 ring-white'
                  : 'bg-[#0E7A34] ring-2 ring-white'
            }`}
            style={{ left: `${progressPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] opacity-95">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={`font-mono tabular-nums ${
                !isMine && isListened ? 'text-sky-900 font-semibold' : ''
              }`}
            >
              {displayTimeLabel}
            </span>
            {isListened ? (
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${
                  isMine ? 'text-sky-200' : 'text-[#0284C7]'
                }`}
              >
                <CheckCheck className="h-3 w-3 shrink-0" />
                <span>Ouvido</span>
              </span>
            ) : !isMine ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0E7A34]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#0E7A34]" aria-hidden="true" />
                <span>Novo</span>
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCycleSpeed}
            className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold transition ${
              isMine
                ? 'bg-white/20 text-white hover:bg-white/30'
                : isListened
                  ? 'bg-sky-100 text-sky-800 hover:bg-sky-200'
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
  myAvatarUrl,
  myInitials,
  myAvatarBg,
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
  onSendPdf,
  onForwardMessage,
  onNotify,
  onStartCall,
  onOpenStorefront,
  onInspectOrder,
  onPreviewAvatar,
  prefilledDraft,
}) => {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [mediaError, setMediaError] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [presenceNowMs, setPresenceNowMs] = useState<number>(() => Date.now());
  const appliedPrefillIdRef = useRef<string | null>(null);
  const [listenedAudioIds, setListenedAudioIds] = useState<Set<string>>(() =>
    readListenedAudioIds(myUid)
  );

  useEffect(() => {
    setListenedAudioIds(readListenedAudioIds(myUid));
  }, [myUid]);

  const handleMarkAudioListened = useCallback(
    (messageId: string) => {
      setListenedAudioIds((prev) => {
        if (prev.has(messageId)) return prev;
        const next = new Set(prev);
        next.add(messageId);
        persistListenedAudioIds(myUid, next);
        return next;
      });
    },
    [myUid]
  );

  useEffect(() => {
    if (!prefilledDraft || !prefilledDraft.text.trim()) return;
    if (appliedPrefillIdRef.current === prefilledDraft.id) return;
    appliedPrefillIdRef.current = prefilledDraft.id;
    setDraft(prefilledDraft.text);
  }, [prefilledDraft]);

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
  const [pdfViewerMsg, setPdfViewerMsg] = useState<ChatMessage | null>(null);
  const [printingMsgId, setPrintingMsgId] = useState<string | null>(null);
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
    messageId: string;
    senderName: string;
    snippet: string;
  } | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const swipeStateRef = useRef<{
    msgId: string;
    startX: number;
    startY: number;
    dragging: boolean;
    cancelled: boolean;
    offsetX: number;
  } | null>(null);
  const [swipingMsg, setSwipingMsg] = useState<{ msgId: string; offsetX: number } | null>(null);
  const [actionSheetMsg, setActionSheetMsg] = useState<ChatMessage | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardingUid, setForwardingUid] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartMsRef = useRef<number>(0);
  const isStoppingRecordingRef = useRef<boolean>(false);
  const selectedMimeTypeRef = useRef<string>('audio/webm');
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const activePrintCleanupRef = useRef<(() => void) | null>(null);

  const activeChatId = useMemo(
    () => getDeterministicChatId(myUid, peer.uid),
    [myUid, peer.uid]
  );

  const [optimisticAudios, setOptimisticAudios] = useState<ChatMessage[]>([]);

  const renderedMessages = useMemo(() => {
    if (optimisticAudios.length === 0) return messages;
    return [...messages, ...optimisticAudios];
  }, [messages, optimisticAudios]);

  const notify = (text: string) => {
    if (onNotify) {
      onNotify(text);
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [renderedMessages.length, peer.uid]);

  useEffect(() => {
    setReplyingTo(null);
    setShowEmojiPicker(false);
    setActionSheetMsg(null);
    setOptimisticAudios([]);
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
      activePrintCleanupRef.current?.();
      activePrintCleanupRef.current = null;
    };
  }, []);

  const getResolvedMediaUrl = (msg: ChatMessage): string | undefined => {
    const resolved = resolvedMedia[msg.id];
    if (resolved?.status === 'ready' && resolved.url) return resolved.url;
    if (resolved?.status === 'deleted_locally' || resolved?.status === 'expired') {
      return undefined;
    }
    if (
      msg.mediaUrl &&
      (msg.mediaUrl.startsWith('data:') || msg.mediaUrl.startsWith('blob:'))
    ) {
      return msg.mediaUrl;
    }
    return undefined;
  };

  // --- SHARED BLESSED VOICE AUDIO ENGINE + SEAMLESS SEQUENTIAL PLAYBACK ---
  // Reusing a single DOM-mounted <audio> element ensures iOS Safari PWA keeps autoplay permission
  // alive when automatically advancing to the next voice message (including newly arrived ones).
  const sharedVoiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceEngineKeyRef = useRef(
    `chat_voice_engine_${Math.random().toString(36).slice(2, 8)}`
  );
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);
  const [activeVoiceTimeSec, setActiveVoiceTimeSec] = useState(0);
  const [voiceSpeed, setVoiceSpeed] = useState<1 | 1.5 | 2>(1);
  const [voiceDurationsById, setVoiceDurationsById] = useState<Record<string, number>>({});
  const [voiceSavedPositions, setVoiceSavedPositions] = useState<Record<string, number>>({});

  const activeVoiceIdRef = useRef<string | null>(null);
  const voiceSpeedRef = useRef<1 | 1.5 | 2>(1);
  const voiceLoadedMsgIdRef = useRef<string | null>(null);
  const voicePositionsRef = useRef<Map<string, number>>(new Map());
  const voiceDraggingRef = useRef(false);
  const voicePlayTokenRef = useRef(0);
  const voiceRetriedOnceRef = useRef(false);
  const voiceStallTimerRef = useRef<number | null>(null);
  const voiceRetryTimerRef = useRef<number | null>(null);
  const voiceRetryCleanupRef = useRef<(() => void) | null>(null);
  const voicePendingSeekRef = useRef<number | null>(null);
  const pendingAutoPlayRef = useRef<{ messageId: string; expiresAt: number } | null>(null);

  const renderedMessagesRef = useRef<ChatMessage[]>(renderedMessages);
  renderedMessagesRef.current = renderedMessages;
  const resolvedMediaRef = useRef<Record<string, MediaResolveResult>>(resolvedMedia);
  resolvedMediaRef.current = resolvedMedia;
  const handleMarkAudioListenedRef = useRef(handleMarkAudioListened);
  handleMarkAudioListenedRef.current = handleMarkAudioListened;

  const resolveMediaUrlFromSnapshot = (
    msg: ChatMessage,
    mediaMap: Record<string, MediaResolveResult>
  ): string | undefined => {
    const resolved = mediaMap[msg.id];
    if (resolved?.status === 'ready' && resolved.url) return resolved.url;
    if (resolved?.status === 'deleted_locally' || resolved?.status === 'expired') {
      return undefined;
    }
    if (
      msg.mediaUrl &&
      (msg.mediaUrl.startsWith('data:') || msg.mediaUrl.startsWith('blob:'))
    ) {
      return msg.mediaUrl;
    }
    return undefined;
  };

  const clearVoiceTimers = useCallback(() => {
    if (voiceStallTimerRef.current !== null) {
      window.clearTimeout(voiceStallTimerRef.current);
      voiceStallTimerRef.current = null;
    }
    if (voiceRetryTimerRef.current !== null) {
      window.clearTimeout(voiceRetryTimerRef.current);
      voiceRetryTimerRef.current = null;
    }
    if (voiceRetryCleanupRef.current) {
      voiceRetryCleanupRef.current();
      voiceRetryCleanupRef.current = null;
    }
  }, []);

  const stopSharedVoicePlayback = useCallback(
    (resetActive = false) => {
      clearVoiceTimers();
      pendingAutoPlayRef.current = null;
      voicePendingSeekRef.current = null;
      voicePlayTokenRef.current = 0;
      const el = sharedVoiceAudioRef.current;
      const currentId = activeVoiceIdRef.current;
      if (el) {
        if (currentId && !resetActive && Number.isFinite(el.currentTime) && el.currentTime > 0) {
          voicePositionsRef.current.set(currentId, el.currentTime);
          setVoiceSavedPositions((prev) => ({ ...prev, [currentId]: el.currentTime }));
        }
        if (!el.paused) {
          try {
            el.pause();
          } catch {
            // Ignore
          }
        }
        if (resetActive) {
          try {
            el.removeAttribute('src');
            el.load();
          } catch {
            // Ignore
          }
        }
      }
      setIsVoicePlaying(false);
      if (resetActive) {
        activeVoiceIdRef.current = null;
        voiceLoadedMsgIdRef.current = null;
        setActiveVoiceId(null);
        setActiveVoiceTimeSec(0);
      }
    },
    [clearVoiceTimers]
  );

  // Register shared voice engine in global exclusive media coordinator
  useEffect(() => {
    const key = voiceEngineKeyRef.current;
    registeredAudioStoppers.set(key, () => stopSharedVoicePlayback(false));
    return () => {
      registeredAudioStoppers.delete(key);
      const el = sharedVoiceAudioRef.current;
      stopSharedVoicePlayback(true);
      if (el && activeChatAudioElement === el) {
        activeChatAudioElement = null;
      }
    };
  }, [stopSharedVoicePlayback]);

  // Reset voice engine when switching chats
  useEffect(() => {
    stopSharedVoicePlayback(true);
    voicePositionsRef.current.clear();
    setVoiceSavedPositions({});
    setVoiceDurationsById({});
  }, [activeChatId, stopSharedVoicePlayback]);

  // Smooth 60fps progress loop while voice message is playing
  useEffect(() => {
    if (!isVoicePlaying) return undefined;
    let rafId = 0;
    const tick = () => {
      const el = sharedVoiceAudioRef.current;
      const id = activeVoiceIdRef.current;
      if (el && id && !voiceDraggingRef.current) {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          setVoiceDurationsById((prev) =>
            prev[id] === el.duration ? prev : { ...prev, [id]: el.duration }
          );
        }
        setActiveVoiceTimeSec(el.currentTime);
        voicePositionsRef.current.set(id, el.currentTime);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [isVoicePlaying]);

  const reloadAndPlayVoiceOnce = useCallback(
    (el: HTMLAudioElement, resumeSec: number, token: number) => {
      if (voiceRetriedOnceRef.current) return;
      if (token !== activeChatAudioToken || activeChatAudioElement !== el) return;
      voiceRetriedOnceRef.current = true;
      clearVoiceTimers();

      const attemptResume = () => {
        cleanupListeners();
        if (
          token !== activeChatAudioToken ||
          voicePlayTokenRef.current !== token ||
          activeChatAudioElement !== el
        ) {
          return;
        }
        try {
          el.muted = false;
          el.volume = 1;
          el.playbackRate = voiceSpeedRef.current;
          if (resumeSec > 0.05 && Number.isFinite(el.duration) && resumeSec < el.duration) {
            el.currentTime = resumeSec;
          } else {
            el.currentTime = 0;
          }
        } catch {
          // Ignore seek errors before seekable range is ready
        }
        void el.play().catch(() => {
          if (voicePlayTokenRef.current === token) {
            setIsVoicePlaying(false);
          }
        });
      };

      const cleanupListeners = () => {
        el.removeEventListener('canplay', attemptResume);
        el.removeEventListener('loadeddata', attemptResume);
        if (voiceRetryTimerRef.current !== null) {
          window.clearTimeout(voiceRetryTimerRef.current);
          voiceRetryTimerRef.current = null;
        }
        voiceRetryCleanupRef.current = null;
      };

      voiceRetryCleanupRef.current = cleanupListeners;
      el.addEventListener('canplay', attemptResume, { once: true });
      el.addEventListener('loadeddata', attemptResume, { once: true });
      try {
        el.load();
      } catch {
        // Ignore
      }
      voiceRetryTimerRef.current = window.setTimeout(() => {
        if (
          el.readyState >= 2 &&
          el.paused &&
          token === activeChatAudioToken &&
          voicePlayTokenRef.current === token &&
          activeChatAudioElement === el
        ) {
          attemptResume();
        }
      }, 250);
    },
    [clearVoiceTimers]
  );

  const startVoiceMessagePlayback = useCallback(
    (
      messageId: string,
      srcUrl: string,
      options?: { fromStart?: boolean; autoScroll?: boolean }
    ) => {
      const el = sharedVoiceAudioRef.current;
      if (!el || !srcUrl) return;

      clearVoiceTimers();
      pendingAutoPlayRef.current = null;

      // Save previous message's pause timestamp when switching tracks
      const prevId = activeVoiceIdRef.current;
      if (prevId && prevId !== messageId && !el.ended && Number.isFinite(el.currentTime)) {
        const saved = el.currentTime;
        voicePositionsRef.current.set(prevId, saved);
        setVoiceSavedPositions((prev) => ({ ...prev, [prevId]: saved }));
      }

      const myToken = stopAllChatMediaExcept(el, voiceEngineKeyRef.current);
      voicePlayTokenRef.current = myToken;
      voiceRetriedOnceRef.current = false;

      const switchingTrack = voiceLoadedMsgIdRef.current !== messageId || !el.src;
      activeVoiceIdRef.current = messageId;
      setActiveVoiceId(messageId);

      let startSec = options?.fromStart ? 0 : voicePositionsRef.current.get(messageId) || 0;
      const knownDur = voiceDurationsById[messageId] || 0;
      if (knownDur > 0 && startSec >= knownDur - 0.1) {
        startSec = 0;
      }

      if (switchingTrack) {
        voiceLoadedMsgIdRef.current = messageId;
        voicePendingSeekRef.current = startSec > 0.05 ? startSec : null;
        el.src = srcUrl;
      } else if (options?.fromStart || el.ended || (Number.isFinite(el.duration) && el.duration > 0 && el.currentTime >= el.duration - 0.08)) {
        startSec = 0;
        voicePendingSeekRef.current = null;
        try {
          el.currentTime = 0;
        } catch {
          // Ignore
        }
      } else if (Math.abs(el.currentTime - startSec) > 0.25) {
        try {
          el.currentTime = startSec;
        } catch {
          voicePendingSeekRef.current = startSec;
        }
      }

      el.muted = false;
      el.volume = 1;
      el.playbackRate = voiceSpeedRef.current;
      setActiveVoiceTimeSec(startSec);
      voicePositionsRef.current.set(messageId, startSec);

      if (options?.autoScroll && typeof document !== 'undefined') {
        const bubbleEl = document.querySelector(`[data-chat-msg-id="${CSS.escape(messageId)}"]`);
        bubbleEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (myToken !== activeChatAudioToken || activeChatAudioElement !== el) {
              try {
                el.pause();
              } catch {
                // Ignore
              }
              return;
            }
            setIsVoicePlaying(true);
            handleMarkAudioListenedRef.current(messageId);

            if (voiceStallTimerRef.current !== null) {
              window.clearTimeout(voiceStallTimerRef.current);
            }
            voiceStallTimerRef.current = window.setTimeout(() => {
              if (myToken !== activeChatAudioToken || activeChatAudioElement !== el) return;
              if (!sharedVoiceAudioRef.current || sharedVoiceAudioRef.current !== el) return;
              if (el.paused || el.ended) return;
              const progressed = Math.abs(el.currentTime - startSec) > 0.02;
              if (!progressed || el.readyState < 2) {
                reloadAndPlayVoiceOnce(el, startSec, myToken);
              }
            }, 450);
          })
          .catch(() => {
            if (myToken !== activeChatAudioToken || activeChatAudioElement !== el) return;
            reloadAndPlayVoiceOnce(el, startSec, myToken);
          });
      }
    },
    [clearVoiceTimers, reloadAndPlayVoiceOnce, voiceDurationsById]
  );

  const handleToggleVoiceMessage = useCallback(
    (messageId: string, srcUrl?: string) => {
      if (!srcUrl) return;
      unlockCallAudio();
      const el = sharedVoiceAudioRef.current;
      if (activeVoiceIdRef.current === messageId && el && !el.paused) {
        activeChatAudioToken += 1;
        stopSharedVoicePlayback(false);
        if (activeChatAudioElement === el) {
          activeChatAudioElement = null;
        }
        return;
      }
      startVoiceMessagePlayback(messageId, srcUrl, { fromStart: false });
    },
    [startVoiceMessagePlayback, stopSharedVoicePlayback]
  );

  const handleSeekVoiceMessage = useCallback(
    (messageId: string, nextSec: number, isDraggingNow: boolean) => {
      voiceDraggingRef.current = isDraggingNow;
      voicePositionsRef.current.set(messageId, nextSec);
      if (activeVoiceIdRef.current === messageId) {
        setActiveVoiceTimeSec(nextSec);
        const el = sharedVoiceAudioRef.current;
        if (el) {
          try {
            el.currentTime = nextSec;
          } catch {
            voicePendingSeekRef.current = nextSec;
          }
        }
      } else {
        setVoiceSavedPositions((prev) => ({ ...prev, [messageId]: nextSec }));
      }
    },
    []
  );

  const handleCycleVoiceSpeed = useCallback(() => {
    const next: 1 | 1.5 | 2 =
      voiceSpeedRef.current === 1 ? 1.5 : voiceSpeedRef.current === 1.5 ? 2 : 1;
    voiceSpeedRef.current = next;
    setVoiceSpeed(next);
    if (sharedVoiceAudioRef.current) {
      sharedVoiceAudioRef.current.playbackRate = next;
    }
  }, []);

  // If the next sequential voice message just arrived and was still resolving locally when the previous audio ended,
  // auto-start it immediately once its URL becomes ready.
  useEffect(() => {
    const pending = pendingAutoPlayRef.current;
    if (!pending) return;
    if (Date.now() > pending.expiresAt) {
      pendingAutoPlayRef.current = null;
      return;
    }
    const targetMsg = renderedMessages.find((m) => m.id === pending.messageId);
    if (!targetMsg) return;
    const readyUrl = resolveMediaUrlFromSnapshot(targetMsg, resolvedMedia);
    if (readyUrl) {
      pendingAutoPlayRef.current = null;
      startVoiceMessagePlayback(targetMsg.id, readyUrl, { fromStart: true, autoScroll: true });
    }
  }, [resolvedMedia, renderedMessages, startVoiceMessagePlayback]);

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
    kind: 'image' | 'audio' | 'video' | 'pdf',
    preferredName?: string
  ) => {
    if (!mediaUrl || mediaBusy) return;
    setMediaBusy(true);
    try {
      const baseName =
        kind === 'pdf'
          ? preferredName || 'chatfi-documento'
          : kind === 'image'
            ? 'chatfi-foto'
            : kind === 'video'
              ? 'chatfi-video'
              : 'chatfi-audio';
      const fallbackExt =
        kind === 'pdf'
          ? 'pdf'
          : kind === 'image'
            ? 'jpg'
            : kind === 'video'
              ? 'mp4'
              : 'webm';
      const { blob, filename } = await mediaUrlToBlobAndFile(mediaUrl, baseName, fallbackExt);
      triggerBlobDownload(blob, filename);
      if (kind === 'image' && isIOSDevice()) {
        notify('Foto baixada! No iPhone, use "Compartilhar → Salvar Imagem" para guardar direto no rolo da câmera.');
      } else {
        notify(
          kind === 'pdf'
            ? 'PDF salvo no aparelho!'
            : kind === 'image'
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

  const handlePrintPdf = async (
    mediaUrl: string | undefined,
    fileName?: string,
    msgId?: string
  ) => {
    if (!mediaUrl || printingMsgId) return;
    setPrintingMsgId(msgId || 'pdf');
    try {
      activePrintCleanupRef.current?.();
      activePrintCleanupRef.current = null;

      const resolvedName = fileName || 'chatfi-documento.pdf';
      const printHtml = await renderPdfToPrintHtml(mediaUrl, resolvedName);

      const iframe = document.createElement('iframe');
      iframe.title = `Imprimir ${resolvedName}`;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '1px';
      iframe.style.height = '1px';
      iframe.style.border = '0';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';

      let cleanedUp = false;
      let printed = false;
      let fallbackTimer: number | null = null;
      let maxLifeTimer: number | null = null;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        if (maxLifeTimer !== null) window.clearTimeout(maxLifeTimer);
        window.removeEventListener('afterprint', cleanup);
        try {
          iframe.contentWindow?.removeEventListener('afterprint', cleanup);
        } catch {
          // ignore cross-context cleanup errors
        }
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
        if (activePrintCleanupRef.current === cleanup) {
          activePrintCleanupRef.current = null;
        }
      };

      activePrintCleanupRef.current = cleanup;
      window.addEventListener('afterprint', cleanup);
      maxLifeTimer = window.setTimeout(cleanup, 90_000);

      const triggerIframePrint = async () => {
        if (printed || cleanedUp) return;
        printed = true;
        if (fallbackTimer !== null) {
          window.clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        try {
          const frameWin = iframe.contentWindow;
          if (!frameWin) {
            throw new Error('Print window unavailable');
          }
          try {
            frameWin.addEventListener('afterprint', cleanup);
          } catch {
            // ignore
          }
          frameWin.focus();
          frameWin.print();
          setPrintingMsgId(null);
        } catch {
          cleanup();
          setPrintingMsgId(null);
          try {
            const { blob, filename } = await mediaUrlToBlobAndFile(
              mediaUrl,
              resolvedName,
              'pdf'
            );
            triggerBlobDownload(blob, filename);
            notify('PDF baixado — abra o arquivo no aparelho para imprimir.');
          } catch {
            notify('Não foi possível abrir a impressão do PDF agora.');
          }
        }
      };

      iframe.onload = () => {
        window.setTimeout(() => void triggerIframePrint(), 120);
      };
      iframe.onerror = async () => {
        cleanup();
        setPrintingMsgId(null);
        try {
          const { blob, filename } = await mediaUrlToBlobAndFile(
            mediaUrl,
            resolvedName,
            'pdf'
          );
          triggerBlobDownload(blob, filename);
          notify('PDF baixado — abra o arquivo no aparelho para imprimir.');
        } catch {
          notify('Não foi possível preparar a impressão do PDF agora.');
        }
      };

      document.body.appendChild(iframe);
      iframe.srcdoc = printHtml;

      fallbackTimer = window.setTimeout(() => void triggerIframePrint(), 1200);
    } catch {
      setPrintingMsgId(null);
      try {
        const { blob, filename } = await mediaUrlToBlobAndFile(
          mediaUrl,
          fileName || 'chatfi-documento',
          'pdf'
        );
        triggerBlobDownload(blob, filename);
        notify('PDF baixado — abra o arquivo no aparelho para imprimir.');
      } catch {
        notify('Não foi possível preparar a impressão do PDF agora.');
      }
    }
  };

  const handleShareMedia = async (
    mediaUrl: string | undefined,
    kind: 'image' | 'audio' | 'video' | 'pdf',
    caption?: string
  ) => {
    if (!mediaUrl || mediaBusy) return;
    setMediaBusy(true);
    try {
      const baseName =
        kind === 'pdf'
          ? caption || 'chatfi-documento'
          : kind === 'image'
            ? 'chatfi-foto'
            : kind === 'video'
              ? 'chatfi-video'
              : 'chatfi-audio';
      const fallbackExt =
        kind === 'pdf'
          ? 'pdf'
          : kind === 'image'
            ? 'jpg'
            : kind === 'video'
              ? 'mp4'
              : 'webm';
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
        kind === 'pdf'
          ? 'PDF baixado para você compartilhar.'
          : kind === 'image'
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
    const senderName = msg.senderId === myUid ? myName : peer.name;
    setReplyingTo({
      messageId: msg.id,
      senderName,
      snippet: getReplySnippet(msg),
    });
    setActionSheetMsg(null);
    window.setTimeout(() => composerInputRef.current?.focus(), 60);
  };

  const formatQuotePrefix = (body: string): string => {
    if (!replyingTo) return body;
    return `» ${replyingTo.senderName}: ${replyingTo.snippet}\n${body}`;
  };

  const handleJumpToQuotedMessage = (currentIdx: number, quote: ParsedQuotedText) => {
    const targetSnippet = quote.quoteSnippet.trim();
    let matchedMsg: ChatMessage | null = null;
    for (let i = currentIdx - 1; i >= 0; i -= 1) {
      const candidate = renderedMessages[i];
      const candSnippet = getReplySnippet(candidate).trim();
      const candBody = (parseQuotedMessage(candidate.text || '')?.body || candidate.text || '').trim();
      if (
        candSnippet === targetSnippet ||
        candBody === targetSnippet ||
        (targetSnippet.length >= 6 &&
          (candSnippet.startsWith(targetSnippet) || candBody.startsWith(targetSnippet)))
      ) {
        matchedMsg = candidate;
        break;
      }
    }
    if (!matchedMsg) return;
    if (typeof document !== 'undefined') {
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(matchedMsg.id)
          : matchedMsg.id.replace(/"/g, '\\"');
      const el = document.querySelector(`[data-chat-msg-id="${escaped}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setHighlightedMsgId(matchedMsg.id);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMsgId(null);
      highlightTimerRef.current = null;
    }, 1800);
  };

  const handleRowTouchStart = (msg: ChatMessage, e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[role="slider"], input, textarea')) return;
    const touch = e.touches[0];
    swipeStateRef.current = {
      msgId: msg.id,
      startX: touch.clientX,
      startY: touch.clientY,
      dragging: false,
      cancelled: false,
      offsetX: 0,
    };
  };

  const handleRowTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const st = swipeStateRef.current;
    if (!st || st.cancelled || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - st.startX;
    const dy = touch.clientY - st.startY;
    if (!st.dragging) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        st.cancelled = true;
        return;
      }
      if (dx > 14 && dx > Math.abs(dy) * 1.35) {
        st.dragging = true;
      } else {
        return;
      }
    }
    const clamped = Math.max(0, Math.min(64, (dx - 10) * 0.7));
    st.offsetX = clamped;
    setSwipingMsg({ msgId: st.msgId, offsetX: clamped });
  };

  const handleRowTouchEnd = (msg: ChatMessage) => {
    const st = swipeStateRef.current;
    swipeStateRef.current = null;
    setSwipingMsg(null);
    if (st && st.dragging && st.offsetX >= 38) {
      try {
        navigator.vibrate?.(12);
      } catch {
        // Ignore unsupported vibration
      }
      handleStartReply(msg);
    }
  };

  const handleOpenForward = (msg: ChatMessage) => {
    setActionSheetMsg(null);
    setLightboxMsg(null);
    setPdfViewerMsg(null);
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
    if (recording || sending) return;
    stopAllChatMediaExcept(null);
    setMediaError('');
    setShowEmojiPicker(false);
    isStoppingRecordingRef.current = false;
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const isIOSDevice =
        /iPad|iPhone|iPod/i.test(ua) ||
        (typeof navigator !== 'undefined' &&
          navigator.platform === 'MacIntel' &&
          navigator.maxTouchPoints > 1);

      // Avoid echoCancellation during solo voice-note recording: on iOS Safari it forces
      // telephony VoiceProcessingIO mode (narrowband muffled audio + earpiece speaker routing).
      const preferredConstraints: MediaTrackConstraints = isIOSDevice
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000,
          }
        : {
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000,
          };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: preferredConstraints });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      }

      recordStreamRef.current = stream;
      audioChunksRef.current = [];

      const candidateMimeTypes = isIOSDevice
        ? [
            'audio/mp4;codecs=mp4a.40.2',
            'audio/mp4',
            'audio/aac',
            'audio/webm;codecs=opus',
            'audio/webm',
          ]
        : [
            'audio/webm;codecs=opus',
            'audio/ogg;codecs=opus',
            'audio/webm',
            'audio/mp4;codecs=mp4a.40.2',
            'audio/mp4',
            'audio/aac',
          ];
      const mimeType =
        typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
          ? candidateMimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
          : '';

      // AAC-LC (iOS MP4) needs 128 kbps to sound crisp; Opus sounds broadcast-clear at 64 kbps
      const isAacOrMp4 = /mp4|aac/i.test(mimeType);
      const targetBitrate = isAacOrMp4 ? 128000 : 64000;

      let recorder: MediaRecorder;
      if (mimeType) {
        try {
          recorder = new MediaRecorder(stream, {
            mimeType,
            audioBitsPerSecond: targetBitrate,
          });
        } catch {
          try {
            recorder = new MediaRecorder(stream, { mimeType });
          } catch {
            recorder = new MediaRecorder(stream);
          }
        }
      } else {
        try {
          recorder = new MediaRecorder(stream, { audioBitsPerSecond: targetBitrate });
        } catch {
          recorder = new MediaRecorder(stream);
        }
      }

      selectedMimeTypeRef.current =
        recorder.mimeType || mimeType || (isIOSDevice ? 'audio/mp4' : 'audio/webm');

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onerror = () => {
        if (recordTimerRef.current) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        recordStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        mediaRecorderRef.current = null;
        isStoppingRecordingRef.current = false;
        setRecording(false);
        setRecordSeconds(0);
        setMediaError('Erro durante a gravação de áudio. Tente novamente.');
      };

      mediaRecorderRef.current = recorder;
      // Record as a single clean container without timeslice: avoids fragmented MP4/AAC
      // clicks, pops, stuttering, and broken duration metadata on iOS Safari.
      recorder.start();
      recordStartMsRef.current = Date.now();
      setRecording(true);
      setRecordSeconds(0);

      recordTimerRef.current = window.setInterval(() => {
        const elapsed = Math.max(0, Math.floor((Date.now() - recordStartMsRef.current) / 1000));
        setRecordSeconds(elapsed);
      }, 500);
    } catch {
      setMediaError('Microfone indisponível. Autorize o acesso em Configurações > Privacidade e Permissões.');
    }
  };

  const cancelRecording = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    isStoppingRecordingRef.current = false;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // Ignore already stopped recorder
      }
    }
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
    audioChunksRef.current = [];
    setRecording(false);
    setRecordSeconds(0);
    unlockCallAudio();
  };

  const sendCapturedAudioBlob = async (blob: Blob, durationLabel: string) => {
    if (blob.size === 0) {
      setMediaError('Não foi possível capturar o áudio. Verifique o microfone e grave por pelo menos 1 segundo.');
      return;
    }

    const activeReply = replyingTo;
    const baseAudioText = `Mensagem de voz (${durationLabel})`;
    const audioTextWithQuote = activeReply
      ? `» ${activeReply.senderName}: ${activeReply.snippet}\n${baseAudioText}`
      : baseAudioText;
    if (activeReply) setReplyingTo(null);

    // Show the voice message bubble immediately (0ms perceived latency)
    const tempId = `opt_audio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const previewUrl = URL.createObjectURL(blob);
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      chatId: activeChatId,
      senderId: myUid,
      senderName: myName,
      type: 'audio',
      text: audioTextWithQuote,
      mediaUrl: previewUrl,
      audioDuration: durationLabel,
      mediaSizeBytes: blob.size,
      mediaMimeType: blob.type || 'audio/mp4',
      mediaDelivered: false,
      deliveryStatus: 'sending',
      timestamp: timeStr,
      createdAtMs: now.getTime(),
    };
    setOptimisticAudios((prev) => [...prev, optimisticMsg]);
    setSending(true);
    try {
      await onSendAudio(blob, durationLabel, activeReply ? audioTextWithQuote : undefined);
    } catch (err) {
      setMediaError(
        err instanceof Error ? err.message : 'Erro ao enviar mensagem de voz.'
      );
    } finally {
      setOptimisticAudios((prev) => prev.filter((m) => m.id !== tempId));
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(previewUrl);
        } catch {
          // Ignore revoke error
        }
      }, 2000);
      setSending(false);
    }
  };

  const stopAndSendRecording = async () => {
    if (isStoppingRecordingRef.current) return;
    const recorder = mediaRecorderRef.current;

    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    const elapsedFromClock = recordStartMsRef.current
      ? Math.round((Date.now() - recordStartMsRef.current) / 1000)
      : 0;
    const finalSeconds = Math.max(1, recordSeconds, elapsedFromClock);
    const durationLabel = `${Math.floor(finalSeconds / 60)}:${(finalSeconds % 60)
      .toString()
      .padStart(2, '0')}`;

    if (!recorder) {
      setRecording(false);
      setRecordSeconds(0);
      setMediaError('Gravação não encontrada. Tente gravar novamente.');
      return;
    }

    if (recorder.state === 'inactive') {
      mediaRecorderRef.current = null;
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordStreamRef.current = null;
      setRecording(false);
      setRecordSeconds(0);
      unlockCallAudio();
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      const fallbackBlob = new Blob(chunks, {
        type: recorder.mimeType || selectedMimeTypeRef.current || 'audio/webm',
      });
      await sendCapturedAudioBlob(fallbackBlob, durationLabel);
      return;
    }

    isStoppingRecordingRef.current = true;
    recorder.onstop = async () => {
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      mediaRecorderRef.current = null;
      isStoppingRecordingRef.current = false;
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordStreamRef.current = null;
      setRecording(false);
      setRecordSeconds(0);
      unlockCallAudio();

      const resolvedType =
        chunks[0]?.type || recorder.mimeType || selectedMimeTypeRef.current || 'audio/webm';
      const blob =
        chunks.length === 1 && chunks[0].type
          ? chunks[0]
          : new Blob(chunks, { type: resolvedType });
      await sendCapturedAudioBlob(blob, durationLabel);
    };

    try {
      // Do NOT call recorder.requestData() before stop(): stop() automatically flushes
      // the complete, cleanly muxed audio file without corrupting trailing MP4/AAC frames.
      recorder.stop();
    } catch {
      mediaRecorderRef.current = null;
      isStoppingRecordingRef.current = false;
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordStreamRef.current = null;
      setRecording(false);
      setRecordSeconds(0);
      unlockCallAudio();
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      const fallbackBlob = new Blob(chunks, {
        type: recorder.mimeType || selectedMimeTypeRef.current || 'audio/webm',
      });
      await sendCapturedAudioBlob(fallbackBlob, durationLabel);
    }
  };

  const preparePendingVideo = async (file: File) => {
    if (file.size > MAX_VIDEO_BYTES) {
      setMediaError(
        `Vídeo muito grande (${formatBytesPtBr(file.size)}). O limite máximo é de 25 MB.`
      );
      return;
    }
    // Open the preview modal immediately (0ms) without blocking on iOS off-DOM metadata probes
    const previewUrl = URL.createObjectURL(file);
    setPendingVideo({
      blob: file,
      previewUrl,
      durationLabel: '',
      sizeBytes: file.size,
      caption: '',
    });
    void extractVideoDurationLabel(file).then((label) => {
      if (!label) return;
      setPendingVideo((prev) =>
        prev && prev.previewUrl === previewUrl && !prev.durationLabel
          ? { ...prev, durationLabel: label }
          : prev
      );
    });
  };

  const sendSelectedPdfFile = async (file: File) => {
    if (file.size > MAX_MEDIA_BYTES) {
      setMediaError(
        `PDF muito grande (${formatBytesPtBr(file.size)}). O limite máximo é de 25 MB.`
      );
      return;
    }
    const pdfBlob =
      file.type === 'application/pdf'
        ? file
        : new Blob([await file.arrayBuffer()], { type: 'application/pdf' });
    const fileName = (file.name || 'Documento.pdf').trim().slice(0, 120);
    const tempId = `opt_pdf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tempUrl = URL.createObjectURL(pdfBlob);
    const nowTime = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const optimisticPdf: ChatMessage = {
      id: tempId,
      chatId: activeChatId,
      senderId: myUid,
      senderName: myName,
      type: 'image',
      text: fileName,
      mediaUrl: tempUrl,
      mediaSizeBytes: pdfBlob.size,
      mediaMimeType: 'application/pdf',
      mediaDelivered: false,
      deliveryStatus: 'sending',
      timestamp: nowTime,
      createdAtMs: Date.now(),
    };
    setOptimisticAudios((prev) => [...prev, optimisticPdf]);
    try {
      if (onSendPdf) {
        await onSendPdf(pdfBlob, fileName);
      } else {
        await onSendImage(pdfBlob, fileName);
      }
    } finally {
      window.setTimeout(() => {
        setOptimisticAudios((prev) => prev.filter((m) => m.id !== tempId));
        URL.revokeObjectURL(tempUrl);
      }, 220);
    }
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
      if (detectedKind === 'pdf') {
        await sendSelectedPdfFile(file);
        return;
      }
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
        IMAGE_JPEG_QUALITY,
        325 * 1024
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

  const handlePdfPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMediaError('');
    setShowEmojiPicker(false);
    setSending(true);
    try {
      await sendSelectedPdfFile(file);
    } catch (err) {
      setMediaError(
        err instanceof Error ? err.message : 'Não foi possível enviar o arquivo PDF.'
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

  // Android system Back arrow (◀) & browser Back for all in-chat overlays/viewers
  useSystemBackHandler(
    showEmojiPicker,
    () => setShowEmojiPicker(false),
    BACK_PRIORITY.DRAWER
  );
  useSystemBackHandler(
    Boolean(pendingPhoto),
    closePendingPhoto,
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(pendingVideo),
    closePendingVideo,
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(actionSheetMsg),
    () => setActionSheetMsg(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(forwardMsg),
    () => setForwardMsg(null),
    BACK_PRIORITY.MODAL + 1
  );
  useSystemBackHandler(
    Boolean(lightboxMsg),
    () => setLightboxMsg(null),
    BACK_PRIORITY.LIGHTBOX
  );
  useSystemBackHandler(
    Boolean(pdfViewerMsg),
    () => setPdfViewerMsg(null),
    BACK_PRIORITY.LIGHTBOX
  );

  const handleConfirmSendPendingPhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPhoto) return;
    const { blob, previewUrl, caption } = pendingPhoto;
    const baseCaption = caption.trim() || 'Foto';
    const finalCaption = formatQuotePrefix(baseCaption);
    setPendingPhoto(null);
    if (replyingTo) setReplyingTo(null);

    // Render photo immediately (0ms) in the chat thread while sending in background
    const tempId = `opt_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowTime = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const optimisticImg: ChatMessage = {
      id: tempId,
      chatId: activeChatId,
      senderId: myUid,
      senderName: myName,
      type: 'image',
      text: finalCaption,
      mediaUrl: previewUrl,
      mediaSizeBytes: blob.size,
      mediaMimeType: blob.type || 'image/jpeg',
      mediaDelivered: false,
      deliveryStatus: 'sending',
      timestamp: nowTime,
      createdAtMs: Date.now(),
    };
    setOptimisticAudios((prev) => [...prev, optimisticImg]);

    try {
      await onSendImage(blob, finalCaption);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Erro ao enviar foto.');
    } finally {
      window.setTimeout(() => {
        setOptimisticAudios((prev) => prev.filter((m) => m.id !== tempId));
        URL.revokeObjectURL(previewUrl);
      }, 220);
    }
  };

  const handleConfirmSendPendingVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingVideo) return;
    const { blob, previewUrl, durationLabel, caption } = pendingVideo;
    const baseCaption = caption.trim() || (durationLabel ? `Vídeo (${durationLabel})` : 'Vídeo');
    const finalCaption = formatQuotePrefix(baseCaption);
    setPendingVideo(null);
    if (replyingTo) setReplyingTo(null);

    // Render video immediately (0ms) in the chat thread while uploading in parallel in background
    const tempId = `opt_vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowTime = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const optimisticVid: ChatMessage = {
      id: tempId,
      chatId: activeChatId,
      senderId: myUid,
      senderName: myName,
      type: 'video',
      text: finalCaption,
      mediaUrl: previewUrl,
      videoDuration: durationLabel || undefined,
      mediaSizeBytes: blob.size,
      mediaMimeType: blob.type || 'video/mp4',
      mediaDelivered: false,
      deliveryStatus: 'sending',
      timestamp: nowTime,
      createdAtMs: Date.now(),
    };
    setOptimisticAudios((prev) => [...prev, optimisticVid]);

    try {
      await onSendVideo(blob, durationLabel, finalCaption);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Erro ao enviar vídeo.');
    } finally {
      window.setTimeout(() => {
        setOptimisticAudios((prev) => prev.filter((m) => m.id !== tempId));
        URL.revokeObjectURL(previewUrl);
      }, 260);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-[#EDF3EF]">
      <div className="safe-top-strip w-full shrink-0 md:hidden" aria-hidden="true" />
      {/* Top Chat Header — ChatFi Deep Emerald Wave */}
      <header className="chatfi-header-wave flex shrink-0 items-center justify-between gap-2 border-b border-emerald-950/30 px-2.5 py-2.5 text-white shadow-sm sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 md:hidden"
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
                phone: peer.phone || peer.virtualLine,
                virtualLine: peer.virtualLine,
                subtitle: peerPresenceDisplay.isPresence
                  ? peerPresenceDisplay.label
                  : peer.storefrontName,
                ratingAverage: peer.ratingAverage,
                ratingCount: peer.ratingCount,
              })
            }
            title="Ver foto de perfil"
            aria-label={`Ampliar foto de ${peer.name}`}
            className="relative shrink-0 rounded-full cursor-pointer transition hover:opacity-95 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            {peer.avatarUrl ? (
              <img
                src={peer.avatarUrl}
                alt={peer.name}
                className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full object-cover ring-2 ring-white/35"
              />
            ) : (
              <div
                className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white/30"
                style={{ backgroundColor: peer.avatarBg || '#0E7A34' }}
              >
                {peer.initials}
              </div>
            )}
            {peerPresenceDisplay.isOnline && (
              <span
                className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-[#22C55E] ring-2 ring-[#064A21]"
                aria-label="Online"
              />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-bold text-white sm:text-base">
                {peer.name}
              </h2>
              <StarRatingBadge
                average={peer.ratingAverage}
                count={peer.ratingCount}
                variant="inline"
                tone="dark"
              />
            </div>
            <p
              className={`truncate text-xs ${
                peerPresenceDisplay.isOnline
                  ? 'font-semibold text-emerald-200'
                  : 'text-emerald-100/80'
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

        <div className="flex shrink-0 items-center gap-1.5">
          {peer.hasStorefront && (
            <button
              type="button"
              onClick={onOpenStorefront}
              title="Abrir vitrine"
              className="flex h-9 items-center gap-1.5 rounded-full bg-[#16A34A] px-3 text-xs font-semibold text-white shadow-sm ring-1 ring-white/25 transition hover:bg-[#15803D] sm:h-10 sm:px-3.5"
            >
              <Store className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Vitrine</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onStartCall('audio')}
            title="Ligação de voz"
            className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-xs transition hover:bg-white/20"
          >
            <Phone className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onStartCall('video')}
            title="Chamada de vídeo"
            className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-xs transition hover:bg-white/20"
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

      {/* Messages Stream with Bespoke ChatFi Messenger Wallpaper */}
      <div className="chatfi-chat-wallpaper flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2.5 py-3.5 sm:px-5 space-y-2.5">
        {renderedMessages.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-emerald-900/10 bg-white/92 p-5 text-center shadow-sm backdrop-blur-xs">
            <p className="text-sm font-semibold text-slate-800">
              Conversa iniciada com {peer.name}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Envie texto, áudio, fotos da câmera ou galeria, ou inicie uma ligação de voz ou vídeo em tela cheia.
            </p>
          </div>
        ) : (
          renderedMessages.map((msg, msgIdx) => {
            const isMine = msg.senderId === myUid;
            const parsedQuote = parseQuotedMessage(msg.text || '');
            const cleanBodyText = parsedQuote ? parsedQuote.body : msg.text;
            const resolvedState = resolvedMedia[msg.id];
            const resolvedUrl = getResolvedMediaUrl(msg);
            const hasRealCaption =
              (msg.type === 'image' || msg.type === 'video') &&
              Boolean(cleanBodyText) &&
              cleanBodyText.trim() !== 'Foto' &&
              cleanBodyText.trim() !== 'Vídeo' &&
              !cleanBodyText.trim().startsWith('Vídeo (') &&
              !/^[\w-]+\.(jpe?g|png|webp|heic|gif|mp4|mov|webm)$/i.test(cleanBodyText.trim());

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

            const isAudioListened = msg.type === 'audio' && listenedAudioIds.has(msg.id);
            const isActiveReplyTarget = replyingTo?.messageId === msg.id;
            const isJumpHighlighted = highlightedMsgId === msg.id;
            const swipeOffset = swipingMsg?.msgId === msg.id ? swipingMsg.offsetX : 0;
            const quoteDisplaySender = parsedQuote
              ? parsedQuote.quoteSender === myName || parsedQuote.quoteSender === 'Você'
                ? 'Você'
                : parsedQuote.quoteSender
              : '';

            const msgMs =
              typeof msg.createdAtMs === 'number' && Number.isFinite(msg.createdAtMs)
                ? msg.createdAtMs
                : presenceNowMs;
            const prevMsg = msgIdx > 0 ? renderedMessages[msgIdx - 1] : null;
            const prevMs =
              prevMsg &&
              typeof prevMsg.createdAtMs === 'number' &&
              Number.isFinite(prevMsg.createdAtMs)
                ? prevMsg.createdAtMs
                : prevMsg
                  ? presenceNowMs
                  : null;
            const showDayDivider =
              prevMs === null || getLocalDayKey(msgMs) !== getLocalDayKey(prevMs);
            const dayDividerLabel = showDayDivider
              ? formatChatDaySeparatorLabel(msgMs, presenceNowMs)
              : '';
            const msgDateLabel = formatMessageShortDate(msgMs);

            return (
              <React.Fragment key={msg.id}>
                {showDayDivider && (
                  <div className="my-2 flex justify-center">
                    <span className="rounded-lg border border-slate-200/80 bg-white/90 px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-600 shadow-[0_1px_3px_rgba(15,23,42,0.08)] backdrop-blur-xs dark:border-slate-700/80 dark:bg-[#182229]/90 dark:text-slate-300">
                      {dayDividerLabel}
                    </span>
                  </div>
                )}
                <div
                  data-chat-msg-id={msg.id}
                  onTouchStart={(e) => handleRowTouchStart(msg, e)}
                  onTouchMove={handleRowTouchMove}
                  onTouchEnd={() => handleRowTouchEnd(msg)}
                  onTouchCancel={() => {
                    swipeStateRef.current = null;
                    setSwipingMsg(null);
                  }}
                  className={`group relative flex items-center ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                {/* Swipe-right Reply indicator (WhatsApp mobile feel) */}
                {swipeOffset > 4 && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[#0E7A34] text-white shadow-md transition-transform"
                    style={{
                      opacity: Math.min(1, swipeOffset / 36),
                      transform: `scale(${swipeOffset >= 38 ? 1.08 : 0.85})`,
                    }}
                  >
                    <Reply className="h-4 w-4" />
                  </div>
                )}

                <div
                  style={
                    swipeOffset > 0
                      ? { transform: `translateX(${swipeOffset}px)`, transition: 'none' }
                      : { transition: 'transform 180ms ease-out' }
                  }
                  className={`relative max-w-[86%] min-w-0 overflow-hidden break-words rounded-2xl transition-all sm:max-w-[70%] ${
                    msg.type === 'image' || msg.type === 'video' ? 'p-1.5' : 'px-3.5 py-2.5'
                  } ${
                    isMine
                      ? 'rounded-br-sm bg-gradient-to-br from-[#0F8238] to-[#0B632A] text-white shadow-[0_2px_8px_rgba(11,99,42,0.22)]'
                      : isAudioListened
                        ? 'rounded-bl-sm border border-sky-200/95 bg-sky-50/95 text-slate-800 shadow-[0_1px_4px_rgba(2,132,199,0.10)]'
                        : 'rounded-bl-sm border border-slate-200/80 bg-white text-slate-800 shadow-[0_1px_4px_rgba(15,23,42,0.07)]'
                  } ${
                    isJumpHighlighted
                      ? 'ring-2 ring-[#0E7A34] ring-offset-2 ring-offset-transparent shadow-lg'
                      : isActiveReplyTarget
                        ? 'ring-2 ring-[#0E7A34]/75 ring-offset-1 ring-offset-transparent'
                        : ''
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
                          ? 'bg-[#0B632A]/75 text-emerald-100 hover:bg-white/20 hover:text-white'
                          : isAudioListened
                            ? 'bg-sky-50/90 text-sky-600/80 hover:bg-sky-100 hover:text-sky-800'
                            : 'bg-white/90 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                    }`}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>

                  {/* Universal WhatsApp-style Quoted Message Card (works for Text, Audio, Photo, Video & PDF) */}
                  {parsedQuote && (
                    <button
                      type="button"
                      onClick={() => handleJumpToQuotedMessage(msgIdx, parsedQuote)}
                      className={`mb-2 block w-full min-w-[155px] rounded-xl border-l-[3.5px] py-1.5 pl-2.5 pr-8 text-left transition active:scale-[0.99] ${
                        isMine
                          ? 'border-emerald-200 bg-black/22 text-white hover:bg-black/30'
                          : 'border-[#0E7A34] bg-[#0E7A34]/[0.08] text-slate-700 hover:bg-[#0E7A34]/[0.13]'
                      }`}
                    >
                      <p
                        className={`truncate text-[12px] font-bold leading-tight ${
                          isMine ? 'text-emerald-200' : 'text-[#0E7A34]'
                        }`}
                      >
                        {quoteDisplaySender}
                      </p>
                      <p
                        className={`mt-0.5 line-clamp-2 text-[12px] leading-snug ${
                          isMine ? 'text-white/90' : 'text-slate-600'
                        }`}
                      >
                        {parsedQuote.quoteSnippet}
                      </p>
                    </button>
                  )}

                  {msg.type === 'audio' ? (
                    <div className="pr-6">
                      {resolvedUrl ? (
                        <RealAudioBubble
                          mediaUrl={resolvedUrl}
                          duration={msg.audioDuration}
                          isMine={isMine}
                          isListened={isAudioListened}
                          isPlaying={isVoicePlaying && activeVoiceId === msg.id}
                          currentSec={
                            activeVoiceId === msg.id
                              ? activeVoiceTimeSec
                              : voiceSavedPositions[msg.id] || 0
                          }
                          measuredDurationSec={voiceDurationsById[msg.id]}
                          speed={voiceSpeed}
                          senderName={isMine ? myName : peer.name}
                          senderAvatarUrl={isMine ? myAvatarUrl : peer.avatarUrl}
                          senderInitials={
                            isMine
                              ? myInitials || myName.slice(0, 2).toUpperCase()
                              : peer.initials
                          }
                          senderAvatarBg={isMine ? myAvatarBg : peer.avatarBg}
                          onTogglePlay={() => handleToggleVoiceMessage(msg.id, resolvedUrl)}
                          onSeek={(nextSec, draggingNow) =>
                            handleSeekVoiceMessage(msg.id, nextSec, draggingNow)
                          }
                          onCycleSpeed={handleCycleVoiceSpeed}
                        />
                      ) : (
                        mediaStatusPlaceholder('Áudio')
                      )}
                    </div>
                  ) : msg.type === 'image' && isPdfMessage(msg, resolvedState?.mimeType) ? (
                    <div className="space-y-2 pr-6">
                      {resolvedUrl ? (
                        <button
                          type="button"
                          onClick={() => setPdfViewerMsg(msg)}
                          className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                            isMine
                              ? 'border-white/20 bg-white/10 hover:bg-white/15'
                              : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                          }`}
                        >
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                              isMine ? 'bg-white/20 text-white' : 'bg-rose-50 text-rose-600'
                            }`}
                          >
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold leading-snug">
                              {msg.text && msg.text !== 'Foto' ? msg.text : 'Documento.pdf'}
                            </p>
                            <p
                              className={`mt-0.5 text-[10px] font-medium ${
                                isMine ? 'text-emerald-100/80' : 'text-slate-500'
                              }`}
                            >
                              PDF{msg.mediaSizeBytes ? ` · ${formatBytesPtBr(msg.mediaSizeBytes)}` : ''}
                            </p>
                          </div>
                        </button>
                      ) : (
                        <div>{mediaStatusPlaceholder('PDF')}</div>
                      )}

                      {resolvedUrl && (
                        <div
                          className={`flex flex-wrap items-center gap-1 pt-0.5 ${
                            isMine ? 'border-t border-white/15' : 'border-t border-slate-100'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              void handlePrintPdf(
                                resolvedUrl,
                                msg.text && msg.text !== 'Foto' ? msg.text : 'Documento.pdf',
                                msg.id
                              )
                            }
                            disabled={printingMsgId === msg.id}
                            className={`flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                              isMine
                                ? 'bg-white text-[#0E7A34] hover:bg-emerald-50'
                                : 'bg-[#0D2B3E] text-white hover:bg-[#143d57]'
                            }`}
                          >
                            {printingMsgId === msg.id ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                            ) : (
                              <Printer className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <span>Imprimir</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPdfViewerMsg(msg)}
                            className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                              isMine
                                ? 'text-emerald-50 hover:bg-white/15'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Eye className="h-3.5 w-3.5 shrink-0" />
                            <span>Visualizar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleSaveMedia(
                                resolvedUrl,
                                'pdf',
                                msg.text && msg.text !== 'Foto' ? msg.text : 'Documento.pdf'
                              )
                            }
                            disabled={mediaBusy}
                            className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                              isMine
                                ? 'text-emerald-50 hover:bg-white/15'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Download className="h-3.5 w-3.5 shrink-0" />
                            <span>Salvar</span>
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
                              title="Encaminhar PDF"
                            >
                              <Forward className="h-3.5 w-3.5 shrink-0" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : msg.type === 'image' ? (
                    <div className="space-y-1.5">
                      {resolvedUrl ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (isPdfMessage(msg, resolvedState?.mimeType)) {
                              setPdfViewerMsg(msg);
                            } else {
                              setLightboxMsg(msg);
                            }
                          }}
                          className="relative block w-full overflow-hidden rounded-xl bg-black/10"
                        >
                          <img
                            src={resolvedUrl}
                            alt={hasRealCaption ? cleanBodyText : 'Foto enviada'}
                            className="max-h-72 w-full rounded-xl object-cover"
                          />
                          {msg.deliveryStatus === 'sending' && (
                            <div className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-xs">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Enviando...</span>
                            </div>
                          )}
                        </button>
                      ) : (
                        <div className="pr-7">{mediaStatusPlaceholder('Foto')}</div>
                      )}
                      {hasRealCaption && (
                        <p className="px-1.5 text-sm leading-snug">{cleanBodyText}</p>
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
                            data-chatfi-media="1"
                            src={resolvedUrl}
                            controls
                            playsInline
                            preload="metadata"
                            onPlay={(e) => stopAllChatMediaExcept(e.currentTarget)}
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
                          {msg.deliveryStatus === 'sending' && (
                            <div className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-xs">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Enviando vídeo...</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="pr-7">{mediaStatusPlaceholder('Vídeo')}</div>
                      )}
                      {hasRealCaption && (
                        <p className="px-1.5 text-sm leading-snug">{cleanBodyText}</p>
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
                  ) : (
                    <p className="whitespace-pre-wrap pr-6 text-sm leading-relaxed">
                      {cleanBodyText}
                    </p>
                  )}

                  <div
                    className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                      msg.type === 'image' || msg.type === 'video' ? 'px-1.5 pb-0.5' : ''
                    } ${
                      isMine
                        ? 'text-emerald-100/85'
                        : isAudioListened
                          ? 'text-sky-700/80'
                          : 'text-slate-400'
                    }`}
                  >
                    {msg.viaMesh && (
                      <span
                        title="Entregue via rede local Mesh"
                        className="inline-flex items-center gap-0.5 opacity-90"
                      >
                        <Radio className="h-3 w-3" />
                      </span>
                    )}
                    <span className="font-mono tabular-nums whitespace-nowrap">
                      {msgDateLabel} {msg.timestamp}
                    </span>
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
                        <CheckCheck className="h-3.5 w-3.5 text-sky-300" />
                      ))}
                  </div>
                </div>
                </div>
              </React.Fragment>
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
          <div className="min-w-0 flex-1 rounded-r-lg border-l-[3.5px] border-[#0E7A34] bg-[#0E7A34]/[0.06] py-1 pl-2.5 pr-2">
            <p className="truncate text-xs font-bold text-[#0E7A34]">
              {replyingTo.senderName === myName ? 'Você' : replyingTo.senderName}
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

      {/* Composer — Floating Pill Bar */}
      <footer className="shrink-0 border-t border-emerald-950/10 bg-white/95 px-2 pt-2 pb-safe backdrop-blur-md shadow-[0_-4px_16px_rgba(4,61,27,0.05)] sm:px-4">
        {/* Gallery photo, video, PDF & phone audio picker */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,.pdf,.opus,.ogg,.mp3,.m4a,.aac,.wav,.amr,.3gp"
          onChange={handleImagePicked}
          className="hidden"
        />
        {/* Direct PDF picker (up to 25 MB) */}
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handlePdfPicked}
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
          <div className="chatfi-record-capsule flex w-full items-center justify-between gap-2.5 rounded-full py-1.5 pl-1.5 pr-1.5 sm:gap-3">
            {/* Discard recording button on the left (ergonomic thumb reach) */}
            <button
              type="button"
              onClick={cancelRecording}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-500 shadow-xs transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 active:scale-95"
              title="Descartar gravação"
              aria-label="Descartar gravação"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            {/* Glowing live emerald mic badge + crisp timer */}
            <div className="flex shrink-0 items-center gap-2">
              <div className="relative flex h-7 w-7 items-center justify-center">
                <span className="chatfi-mic-ripple absolute inset-0 rounded-full bg-[#16A34A]/30" />
                <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-[#0E7A34] text-white shadow-xs">
                  <Mic className="h-3.5 w-3.5" />
                </span>
              </div>
              <span className="font-mono text-sm font-extrabold tracking-tight text-[#0D3B22] tabular-nums dark:text-emerald-200">
                {Math.floor(recordSeconds / 60)}:
                {(recordSeconds % 60).toString().padStart(2, '0')}
              </span>
            </div>

            {/* Organic animated live emerald voice waveform bars */}
            <div
              aria-hidden="true"
              className="flex h-7 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden px-1"
            >
              {[
                36, 62, 84, 48, 95, 70, 42, 88, 100, 64, 82, 46, 92, 68, 52, 78, 44, 58,
              ].map((heightPct, idx) => (
                <span
                  key={idx}
                  className="chatfi-voice-bar w-[3px] shrink-0 rounded-full bg-gradient-to-t from-[#0E7A34] to-[#4ADE80]"
                  style={{
                    height: `${Math.max(8, Math.round((heightPct / 100) * 24))}px`,
                    animationDelay: `${(idx * 75) % 900}ms`,
                    animationDuration: `${850 + (idx % 5) * 140}ms`,
                  }}
                />
              ))}
            </div>

            {/* Tactile ChatFi emerald send button */}
            <button
              type="button"
              onClick={() => void stopAndSendRecording()}
              title="Enviar áudio"
              aria-label="Enviar áudio"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#16A34A] to-[#0B662B] text-white shadow-md shadow-emerald-600/25 transition hover:brightness-110 active:scale-95 sm:h-11 sm:w-11"
            >
              <Send className="h-4 w-4 translate-x-[0.5px]" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmitText} className="flex w-full min-w-0 items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              title="Emojis"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition sm:h-11 sm:w-11 ${
                showEmojiPicker
                  ? 'bg-emerald-50 text-[#0E7A34] ring-1 ring-[#0E7A34]/30'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-[#0E7A34]'
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
              className="h-10 min-w-0 flex-1 rounded-full border border-slate-200/90 bg-[#F3F7F4] px-4 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#0E7A34] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/15 sm:h-11"
            />

            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              disabled={sending}
              title="Enviar foto, vídeo ou áudio do aparelho"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-emerald-50 hover:text-[#0E7A34] sm:h-10 sm:w-10"
              aria-label="Galeria de fotos e áudios"
            >
              <ImageIcon className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => pdfInputRef.current?.click()}
              disabled={sending}
              title="Enviar arquivo PDF (até 25 MB)"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-emerald-50 hover:text-[#0E7A34] sm:h-10 sm:w-10"
              aria-label="Enviar PDF"
            >
              <FileText className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={sending}
              title="Enviar vídeo (até 25 MB)"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-emerald-50 hover:text-[#0E7A34] sm:h-10 sm:w-10"
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
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-emerald-50 hover:text-[#0E7A34] sm:h-10 sm:w-10"
                aria-label="Câmera"
              >
                <Camera className="h-5 w-5" />
              </button>
            )}

            {draft.trim() ? (
              <button
                type="submit"
                disabled={sending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#16A34A] to-[#0E7A34] text-white shadow-md shadow-emerald-900/20 transition hover:brightness-105 active:scale-95 disabled:opacity-50 sm:h-11 sm:w-11"
                aria-label="Enviar mensagem"
              >
                <Send className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startRealRecording()}
                disabled={sending}
                title={sending ? 'Enviando...' : 'Gravar mensagem de voz'}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#16A34A] to-[#0E7A34] text-white shadow-md shadow-emerald-900/20 transition hover:brightness-105 active:scale-95 disabled:opacity-70 sm:h-11 sm:w-11"
                aria-label={sending ? 'Enviando áudio' : 'Gravar áudio'}
              >
                {sending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
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
              data-chatfi-media="1"
              src={pendingVideo.previewUrl}
              controls
              playsInline
              onLoadedMetadata={(e) => {
                const secs = Number.isFinite(e.currentTarget.duration)
                  ? Math.max(0, Math.round(e.currentTarget.duration))
                  : 0;
                if (secs > 0) {
                  const mins = Math.floor(secs / 60);
                  const rem = secs % 60;
                  const label = `${mins}:${rem.toString().padStart(2, '0')}`;
                  setPendingVideo((prev) =>
                    prev && !prev.durationLabel ? { ...prev, durationLabel: label } : prev
                  );
                }
              }}
              onPlay={(e) => stopAllChatMediaExcept(e.currentTarget)}
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
      {lightboxMsg &&
        !isPdfMessage(lightboxMsg, resolvedMedia[lightboxMsg.id]?.mimeType) &&
        getResolvedMediaUrl(lightboxMsg) && (
        <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-black text-white">
          {/* Viewer Top Bar */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black px-3 pb-3 header-pt-safe sm:px-5">
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
                <p className="text-[11px] text-white/70">
                  {typeof lightboxMsg.createdAtMs === 'number'
                    ? `${formatMessageShortDate(lightboxMsg.createdAtMs)} ${lightboxMsg.timestamp}`
                    : lightboxMsg.timestamp}
                </p>
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
          <div className="shrink-0 border-t border-white/10 bg-black px-4 pt-3 pb-safe">
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

      {/* Full-Screen PDF Attachment Viewer (Visualizar + Imprimir + Salvar + Compartilhar) */}
      {pdfViewerMsg && getResolvedMediaUrl(pdfViewerMsg) && (
        <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-slate-900 text-white">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0D2B3E] px-3 pb-2.5 header-pt-safe sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setPdfViewerMsg(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Fechar PDF"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">
                  {pdfViewerMsg.text && pdfViewerMsg.text !== 'Foto'
                    ? pdfViewerMsg.text
                    : 'Documento.pdf'}
                </p>
                <p className="text-[11px] text-slate-300">
                  {pdfViewerMsg.senderId === myUid ? myName || 'Você' : peer.name} ·{' '}
                  {pdfViewerMsg.timestamp}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void handlePrintPdf(
                    getResolvedMediaUrl(pdfViewerMsg),
                    pdfViewerMsg.text && pdfViewerMsg.text !== 'Foto'
                      ? pdfViewerMsg.text
                      : 'Documento.pdf',
                    pdfViewerMsg.id
                  )
                }
                disabled={printingMsgId === pdfViewerMsg.id}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0E7A34] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-60"
              >
                {printingMsgId === pdfViewerMsg.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                <span>Imprimir</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleSaveMedia(
                    getResolvedMediaUrl(pdfViewerMsg),
                    'pdf',
                    pdfViewerMsg.text && pdfViewerMsg.text !== 'Foto'
                      ? pdfViewerMsg.text
                      : 'Documento.pdf'
                  )
                }
                disabled={mediaBusy}
                title="Salvar PDF"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleShareMedia(
                    getResolvedMediaUrl(pdfViewerMsg),
                    'pdf',
                    pdfViewerMsg.text && pdfViewerMsg.text !== 'Foto'
                      ? pdfViewerMsg.text
                      : 'Documento.pdf'
                  )
                }
                disabled={mediaBusy}
                title="Compartilhar PDF"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <PdfViewerCanvas
              mediaUrl={getResolvedMediaUrl(pdfViewerMsg)!}
              fileName={
                pdfViewerMsg.text && pdfViewerMsg.text !== 'Foto'
                  ? pdfViewerMsg.text
                  : 'Documento.pdf'
              }
              onDownload={() =>
                void handleSaveMedia(
                  getResolvedMediaUrl(pdfViewerMsg),
                  'pdf',
                  pdfViewerMsg.text && pdfViewerMsg.text !== 'Foto'
                    ? pdfViewerMsg.text
                    : 'Documento.pdf'
                )
              }
            />
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

              {actionSheetMsg.type === 'image' &&
                isPdfMessage(actionSheetMsg, resolvedMedia[actionSheetMsg.id]?.mimeType) &&
                getResolvedMediaUrl(actionSheetMsg) && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const url = getResolvedMediaUrl(actionSheetMsg);
                        const name =
                          actionSheetMsg.text && actionSheetMsg.text !== 'Foto'
                            ? actionSheetMsg.text
                            : 'Documento.pdf';
                        const id = actionSheetMsg.id;
                        setActionSheetMsg(null);
                        void handlePrintPdf(url, name, id);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      <Printer className="h-4 w-4 text-[#0D2B3E]" />
                      <span>Imprimir PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targetMsg = actionSheetMsg;
                        setActionSheetMsg(null);
                        setPdfViewerMsg(targetMsg);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      <Eye className="h-4 w-4 text-[#0E7A34]" />
                      <span>Visualizar PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const url = getResolvedMediaUrl(actionSheetMsg);
                        const name =
                          actionSheetMsg.text && actionSheetMsg.text !== 'Foto'
                            ? actionSheetMsg.text
                            : 'Documento.pdf';
                        setActionSheetMsg(null);
                        void handleSaveMedia(url, 'pdf', name);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      <Download className="h-4 w-4 text-[#0E7A34]" />
                      <span>Salvar PDF no aparelho</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const url = getResolvedMediaUrl(actionSheetMsg);
                        const cap = actionSheetMsg.text;
                        setActionSheetMsg(null);
                        void handleShareMedia(url, 'pdf', cap);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      <Share2 className="h-4 w-4 text-[#0E7A34]" />
                      <span>Compartilhar PDF</span>
                    </button>
                  </>
                )}

              {actionSheetMsg.type === 'image' &&
                !isPdfMessage(actionSheetMsg, resolvedMedia[actionSheetMsg.id]?.mimeType) &&
                getResolvedMediaUrl(actionSheetMsg) && (
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

      {/* Single shared blessed voice audio element for guaranteed sequential playback on iOS PWA & Android */}
      <audio
        ref={sharedVoiceAudioRef}
        data-chatfi-voice="1"
        preload="auto"
        playsInline
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          const id = activeVoiceIdRef.current;
          if (id && Number.isFinite(el.duration) && el.duration > 0) {
            setVoiceDurationsById((prev) =>
              prev[id] === el.duration ? prev : { ...prev, [id]: el.duration }
            );
          }
          if (voicePendingSeekRef.current !== null) {
            const target = voicePendingSeekRef.current;
            voicePendingSeekRef.current = null;
            if (Number.isFinite(el.duration) && target < el.duration) {
              try {
                el.currentTime = target;
              } catch {
                // Ignore
              }
            }
          }
        }}
        onDurationChange={(e) => {
          const el = e.currentTarget;
          const id = activeVoiceIdRef.current;
          if (id && Number.isFinite(el.duration) && el.duration > 0) {
            setVoiceDurationsById((prev) =>
              prev[id] === el.duration ? prev : { ...prev, [id]: el.duration }
            );
          }
        }}
        onPlay={(e) => {
          const el = e.currentTarget;
          if (activeChatAudioElement !== el) {
            const tok = stopAllChatMediaExcept(el, voiceEngineKeyRef.current);
            voicePlayTokenRef.current = tok;
          }
          setIsVoicePlaying(true);
          if (activeVoiceIdRef.current) {
            handleMarkAudioListenedRef.current(activeVoiceIdRef.current);
          }
        }}
        onPause={() => {
          if (voiceStallTimerRef.current !== null) {
            window.clearTimeout(voiceStallTimerRef.current);
            voiceStallTimerRef.current = null;
          }
          setIsVoicePlaying(false);
        }}
        onEnded={() => {
          clearVoiceTimers();
          const endedId = activeVoiceIdRef.current;
          voicePlayTokenRef.current = 0;

          if (endedId) {
            handleMarkAudioListenedRef.current(endedId);
            voicePositionsRef.current.set(endedId, 0);
            setVoiceSavedPositions((prev) => ({ ...prev, [endedId]: 0 }));
          }

          // Check for the next sequential voice message from the same sender
          const currentMsgs = renderedMessagesRef.current;
          const endedIdx = endedId ? currentMsgs.findIndex((m) => m.id === endedId) : -1;
          let nextAudioMsg: ChatMessage | null = null;
          if (endedIdx !== -1) {
            const endedMsg = currentMsgs[endedIdx];
            for (let i = endedIdx + 1; i < currentMsgs.length; i += 1) {
              const candidate = currentMsgs[i];
              if (candidate.senderId !== endedMsg.senderId) break;
              if (candidate.type === 'audio') {
                nextAudioMsg = candidate;
                break;
              }
            }
          }

          if (nextAudioMsg) {
            const nextUrl = resolveMediaUrlFromSnapshot(nextAudioMsg, resolvedMediaRef.current);
            if (nextUrl) {
              // Immediately advance on the exact same blessed <audio> element (works natively on iOS Safari PWA)
              startVoiceMessagePlayback(nextAudioMsg.id, nextUrl, {
                fromStart: true,
                autoScroll: true,
              });
              return;
            }
            // Audio just arrived and is still finishing local download: queue auto-play as soon as ready
            pendingAutoPlayRef.current = {
              messageId: nextAudioMsg.id,
              expiresAt: Date.now() + 10_000,
            };
          }

          setIsVoicePlaying(false);
          setActiveVoiceTimeSec(0);
          if (sharedVoiceAudioRef.current) {
            if (activeChatAudioElement === sharedVoiceAudioRef.current) {
              activeChatAudioElement = null;
            }
            try {
              sharedVoiceAudioRef.current.currentTime = 0;
            } catch {
              // Ignore
            }
          }
        }}
        onTimeUpdate={(e) => {
          if (voiceDraggingRef.current) return;
          const el = e.currentTarget;
          const id = activeVoiceIdRef.current;
          if (id && Number.isFinite(el.duration) && el.duration > 0) {
            setVoiceDurationsById((prev) =>
              prev[id] === el.duration ? prev : { ...prev, [id]: el.duration }
            );
          }
          if (el.currentTime > 0.02 && voiceStallTimerRef.current !== null) {
            window.clearTimeout(voiceStallTimerRef.current);
            voiceStallTimerRef.current = null;
          }
          if (id && el.currentTime > 0.15) {
            handleMarkAudioListenedRef.current(id);
          }
          setActiveVoiceTimeSec(el.currentTime);
        }}
        onError={() => {
          const el = sharedVoiceAudioRef.current;
          const tok = voicePlayTokenRef.current;
          if (
            el &&
            tok > 0 &&
            tok === activeChatAudioToken &&
            activeChatAudioElement === el &&
            !voiceRetriedOnceRef.current
          ) {
            const resumeSec =
              activeVoiceIdRef.current
                ? voicePositionsRef.current.get(activeVoiceIdRef.current) || 0
                : 0;
            reloadAndPlayVoiceOnce(el, resumeSec, tok);
          } else {
            clearVoiceTimers();
            setIsVoicePlaying(false);
          }
        }}
        className="sr-only"
      />
    </div>
  );
};
