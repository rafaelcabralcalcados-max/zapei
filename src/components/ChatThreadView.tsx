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
import type { AvatarPreviewTarget } from './AvatarLightboxModal';
import { PdfViewerCanvas, renderPdfToPrintHtml } from './PdfViewerCanvas';
import { StarRatingBadge } from './StarRatingBadge';

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
  if (isPdfMessage(msg)) {
    return `📄 ${msg.text || 'Documento.pdf'}`.slice(0, 72);
  }
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
  messageId: string;
  mediaUrl?: string;
  duration?: string;
  isMine: boolean;
  isListened?: boolean;
  onMarkListened?: () => void;
}> = ({ messageId, mediaUrl, duration, isMine, isListened = false, onMarkListened }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const playingRef = useRef(false);
  const stallTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryCleanupRef = useRef<(() => void) | null>(null);
  const playTokenRef = useRef(0);
  const retriedOnceRef = useRef(false);
  const pendingSrcRef = useRef<string | undefined>(undefined);
  const bubbleKeyRef = useRef(
    `voice_${messageId}_${Math.random().toString(36).slice(2, 8)}`
  );

  // Stabilize activeSrc so an async data: -> blob: upgrade never aborts active first-click playback
  const [activeSrc, setActiveSrc] = useState<string | undefined>(mediaUrl);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(() => parseAudioDurationLabel(duration));
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);

  const fallbackSec = useMemo(() => parseAudioDurationLabel(duration), [duration]);
  const effectiveDuration =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec : fallbackSec;
  const progressRatio =
    effectiveDuration > 0
      ? Math.max(0, Math.min(1, currentSec / effectiveDuration))
      : 0;
  const progressPct = progressRatio * 100;

  const clearPendingTimers = () => {
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (retryCleanupRef.current) {
      retryCleanupRef.current();
      retryCleanupRef.current = null;
    }
  };

  const forceStopLocal = () => {
    clearPendingTimers();
    playTokenRef.current = 0;
    playingRef.current = false;
    setPlaying(false);
    const el = audioRef.current;
    if (el && !el.paused) {
      try {
        el.pause();
      } catch {
        // Ignore
      }
    }
  };

  // Register this bubble in the exclusive audio playback coordinator
  useEffect(() => {
    const key = bubbleKeyRef.current;
    registeredAudioStoppers.set(key, forceStopLocal);
    return () => {
      registeredAudioStoppers.delete(key);
      clearPendingTimers();
      const el = audioRef.current;
      if (el) {
        if (activeChatAudioElement === el) {
          activeChatAudioElement = null;
        }
        try {
          el.pause();
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  // Reset player state ONLY when messageId changes
  useEffect(() => {
    forceStopLocal();
    retriedOnceRef.current = false;
    pendingSrcRef.current = undefined;
    setActiveSrc(mediaUrl);
    setCurrentSec(0);
    setDurationSec(parseAudioDurationLabel(duration));
  }, [messageId]);

  // Keep fallback duration synced without interrupting playback
  useEffect(() => {
    const parsed = parseAudioDurationLabel(duration);
    if (parsed > 0) {
      setDurationSec((prev) => (Number.isFinite(prev) && prev > 0 ? prev : parsed));
    }
  }, [duration]);

  // Upgrade mediaUrl safely: apply immediately if not currently playing; defer until pause/end if playing
  useEffect(() => {
    if (!mediaUrl || mediaUrl === activeSrc) return;
    if (playingRef.current) {
      pendingSrcRef.current = mediaUrl;
    } else {
      pendingSrcRef.current = undefined;
      setActiveSrc(mediaUrl);
    }
  }, [mediaUrl, activeSrc]);

  // Eagerly warm up local blob/data audio element on mount/src change so first tap has readyState >= 2
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !activeSrc) return;
    el.muted = false;
    el.volume = 1;
    if (el.readyState === 0) {
      try {
        el.load();
      } catch {
        // Ignore load errors on detached elements
      }
    }
  }, [activeSrc]);

  useEffect(() => {
    if (!playing) return undefined;
    let rafId = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el && !draggingRef.current) {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          setDurationSec(el.duration);
        }
        setCurrentSec(el.currentTime);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [playing]);

  const reloadAndPlayOnce = (el: HTMLAudioElement, resumeSec: number, token: number) => {
    if (retriedOnceRef.current) return;
    if (token !== activeChatAudioToken || activeChatAudioElement !== el) return;
    retriedOnceRef.current = true;
    clearPendingTimers();

    const attemptResume = () => {
      cleanupListeners();
      // Abort immediately if the user paused or started another audio while reloading
      if (
        token !== activeChatAudioToken ||
        playTokenRef.current !== token ||
        activeChatAudioElement !== el
      ) {
        return;
      }
      try {
        el.muted = false;
        el.volume = 1;
        el.playbackRate = speed;
        if (resumeSec > 0.05 && Number.isFinite(el.duration) && resumeSec < el.duration) {
          el.currentTime = resumeSec;
        } else {
          el.currentTime = 0;
        }
      } catch {
        // Ignore seek errors before seekable range is ready
      }
      void el.play().catch(() => {
        if (playTokenRef.current === token) {
          playingRef.current = false;
          setPlaying(false);
        }
      });
    };

    const cleanupListeners = () => {
      el.removeEventListener('canplay', attemptResume);
      el.removeEventListener('loadeddata', attemptResume);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryCleanupRef.current = null;
    };

    retryCleanupRef.current = cleanupListeners;
    el.addEventListener('canplay', attemptResume, { once: true });
    el.addEventListener('loadeddata', attemptResume, { once: true });
    try {
      el.load();
    } catch {
      // Ignore
    }
    // Safety fallback if browser already fired loadeddata synchronously
    retryTimerRef.current = window.setTimeout(() => {
      if (
        el.readyState >= 2 &&
        el.paused &&
        token === activeChatAudioToken &&
        playTokenRef.current === token &&
        activeChatAudioElement === el
      ) {
        attemptResume();
      }
    }, 250);
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el || !activeSrc) return;

    // Wake mobile/desktop audio hardware synchronously inside the user tap gesture
    unlockCallAudio();

    if (playing || !el.paused) {
      activeChatAudioToken += 1;
      forceStopLocal();
      if (activeChatAudioElement === el) {
        activeChatAudioElement = null;
      }
      return;
    }

    // Exclusively stop ALL other chat audios and videos so only one plays at a time
    const myToken = stopAllChatMediaExcept(el, bubbleKeyRef.current);
    playTokenRef.current = myToken;
    retriedOnceRef.current = false;

    el.muted = false;
    el.volume = 1;
    el.playbackRate = speed;

    const knownDuration =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration : effectiveDuration;
    if (el.ended || (knownDuration > 0 && el.currentTime >= knownDuration - 0.08)) {
      try {
        el.currentTime = 0;
      } catch {
        // Ignore if not seekable yet
      }
      setCurrentSec(0);
    }

    if (el.error || el.readyState === 0) {
      try {
        el.load();
      } catch {
        // Ignore
      }
    }

    const startSec = el.currentTime || 0;
    const playPromise = el.play();

    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          // If user already tapped another audio while this play() promise was resolving, immediately pause!
          if (myToken !== activeChatAudioToken || activeChatAudioElement !== el) {
            try {
              el.pause();
            } catch {
              // Ignore
            }
            return;
          }
          playingRef.current = true;
          setPlaying(true);
          // First-play silent stall watchdog: if Chrome/mobile reports playing but readyState < 2
          // or currentTime doesn't advance within 450ms, automatically reload & replay once
          if (stallTimerRef.current !== null) {
            window.clearTimeout(stallTimerRef.current);
          }
          stallTimerRef.current = window.setTimeout(() => {
            if (myToken !== activeChatAudioToken || activeChatAudioElement !== el) return;
            if (!audioRef.current || audioRef.current !== el) return;
            if (el.paused || el.ended) return;
            const progressed = Math.abs(el.currentTime - startSec) > 0.02;
            if (!progressed || el.readyState < 2) {
              reloadAndPlayOnce(el, startSec, myToken);
            }
          }, 450);
        })
        .catch(() => {
          if (myToken !== activeChatAudioToken || activeChatAudioElement !== el) return;
          // First play() rejected (common on cold first tap while decoding blob) -> reload & auto-retry once
          reloadAndPlayOnce(el, startSec, myToken);
        });
    }
  };

  const cycleSpeed = () => {
    const next: 1 | 1.5 | 2 = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  };

  const seekToClientX = (clientX: number) => {
    const el = audioRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const maxSec =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration : effectiveDuration;
    if (maxSec <= 0) return;
    const nextSec = ratio * maxSec;
    setCurrentSec(nextSec);
    try {
      el.currentTime = nextSec;
    } catch {
      // Ignore if media isn't seekable yet
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeSrc) return;
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore unsupported capture
    }
    seekToClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekToClientX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekToClientX(e.clientX);
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
    const el = audioRef.current;
    if (!el || effectiveDuration <= 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 3 : -3;
      const next = Math.max(0, Math.min(effectiveDuration, el.currentTime + delta));
      el.currentTime = next;
      setCurrentSec(next);
    }
  };

  const displayTimeLabel =
    playing || currentSec > 0 || dragging
      ? `${formatAudioSeconds(currentSec)} / ${
          effectiveDuration > 0 ? formatAudioSeconds(effectiveDuration) : duration || '0:00'
        }`
      : effectiveDuration > 0
        ? formatAudioSeconds(effectiveDuration)
        : duration || '0:00';

  return (
    <div className="flex min-w-[236px] sm:min-w-[260px] items-center gap-2.5 py-0.5 select-none">
      {activeSrc && (
        <audio
          ref={audioRef}
          data-chatfi-voice="1"
          src={activeSrc}
          preload="auto"
          playsInline
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDurationSec(d);
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDurationSec(d);
          }}
          onPlay={(e) => {
            const el = e.currentTarget;
            if (activeChatAudioElement !== el) {
              const tok = stopAllChatMediaExcept(el, bubbleKeyRef.current);
              playTokenRef.current = tok;
            }
            playingRef.current = true;
            setPlaying(true);
            onMarkListened?.();
          }}
          onPause={() => {
            if (stallTimerRef.current !== null) {
              window.clearTimeout(stallTimerRef.current);
              stallTimerRef.current = null;
            }
            playingRef.current = false;
            setPlaying(false);
            if (pendingSrcRef.current && pendingSrcRef.current !== activeSrc) {
              const nextSrc = pendingSrcRef.current;
              pendingSrcRef.current = undefined;
              setActiveSrc(nextSrc);
            }
          }}
          onEnded={() => {
            clearPendingTimers();
            playTokenRef.current = 0;
            playingRef.current = false;
            setPlaying(false);
            setCurrentSec(0);
            onMarkListened?.();
            if (audioRef.current) {
              if (activeChatAudioElement === audioRef.current) {
                activeChatAudioElement = null;
              }
              try {
                audioRef.current.currentTime = 0;
              } catch {
                // Ignore
              }
            }
            if (pendingSrcRef.current && pendingSrcRef.current !== activeSrc) {
              const nextSrc = pendingSrcRef.current;
              pendingSrcRef.current = undefined;
              setActiveSrc(nextSrc);
            }
          }}
          onTimeUpdate={(e) => {
            if (draggingRef.current) return;
            const el = e.currentTarget;
            if (Number.isFinite(el.duration) && el.duration > 0) {
              setDurationSec(el.duration);
            }
            if (el.currentTime > 0.02 && stallTimerRef.current !== null) {
              window.clearTimeout(stallTimerRef.current);
              stallTimerRef.current = null;
            }
            if (el.currentTime > 0.15) {
              onMarkListened?.();
            }
            setCurrentSec(el.currentTime);
          }}
          onError={() => {
            const el = audioRef.current;
            const tok = playTokenRef.current;
            if (
              el &&
              tok > 0 &&
              tok === activeChatAudioToken &&
              activeChatAudioElement === el &&
              !retriedOnceRef.current
            ) {
              reloadAndPlayOnce(el, currentSec, tok);
            } else {
              clearPendingTimers();
              playingRef.current = false;
              setPlaying(false);
            }
          }}
          className="sr-only"
        />
      )}
      <button
        type="button"
        onClick={togglePlay}
        disabled={!activeSrc}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-xs transition active:scale-95 disabled:opacity-40 ${
          isMine
            ? isListened
              ? 'bg-sky-400/30 text-sky-100 ring-1 ring-sky-200/60 hover:bg-sky-400/40'
              : 'bg-white/20 text-white ring-1 ring-white/25 hover:bg-white/30'
            : isListened
              ? 'bg-[#0284C7] text-white shadow-sky-900/15 hover:bg-[#0369A1]'
              : 'bg-[#0E7A34] text-white shadow-emerald-900/15 hover:bg-[#0B5D27]'
        }`}
        aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
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
            onClick={cycleSpeed}
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
      text: `Mensagem de voz (${durationLabel})`,
      mediaUrl: previewUrl,
      audioDuration: durationLabel,
      mediaSizeBytes: blob.size,
      mediaMimeType: blob.type || 'audio/mp4',
      mediaDelivered: false,
      deliveryStatus: 'sending',
      timestamp: timeStr,
    };
    setOptimisticAudios((prev) => [...prev, optimisticMsg]);
    setSending(true);
    try {
      await onSendAudio(blob, durationLabel);
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
    if (onSendPdf) {
      await onSendPdf(pdfBlob, fileName);
    } else {
      await onSendImage(pdfBlob, fileName);
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
          renderedMessages.map((msg) => {
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

            const isAudioListened = msg.type === 'audio' && listenedAudioIds.has(msg.id);

            return (
              <div
                key={msg.id}
                className={`group flex ${isMine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`relative max-w-[86%] min-w-0 overflow-hidden break-words rounded-2xl transition-colors sm:max-w-[70%] ${
                    msg.type === 'image' || msg.type === 'video' ? 'p-1.5' : 'px-3.5 py-2.5'
                  } ${
                    isMine
                      ? 'rounded-br-sm bg-gradient-to-br from-[#0F8238] to-[#0B632A] text-white shadow-[0_2px_8px_rgba(11,99,42,0.22)]'
                      : isAudioListened
                        ? 'rounded-bl-sm border border-sky-200/95 bg-sky-50/95 text-slate-800 shadow-[0_1px_4px_rgba(2,132,199,0.10)]'
                        : 'rounded-bl-sm border border-slate-200/80 bg-white text-slate-800 shadow-[0_1px_4px_rgba(15,23,42,0.07)]'
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

                  {msg.type === 'audio' ? (
                    <div className="pr-6">
                      {resolvedUrl ? (
                        <RealAudioBubble
                          messageId={msg.id}
                          mediaUrl={resolvedUrl}
                          duration={msg.audioDuration}
                          isMine={isMine}
                          isListened={isAudioListened}
                          onMarkListened={() => handleMarkAudioListened(msg.id)}
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
                        <CheckCheck className="h-3.5 w-3.5 text-sky-300" />
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
    </div>
  );
};
