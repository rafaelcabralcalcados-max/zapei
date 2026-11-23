/**
 * ZAPEI WEB SHARE TARGET INBOX (WhatsApp -> Zapei)
 * ------------------------------------------------
 * Reads and manages media/text payloads received by the Service Worker
 * from Android/mobile Share Sheet (e.g. sharing photos, voice notes .opus/.ogg,
 * audio files .mp3/.m4a, videos, or text directly from WhatsApp into Zapei).
 */

export const SHARE_INBOX_DB_NAME = 'zapei_share_inbox_v1';
export const SHARE_INBOX_DB_VERSION = 1;
export const SHARE_INBOX_STORE_NAME = 'pending_shares';

export type SharedMediaKind = 'image' | 'audio' | 'video' | 'unsupported';

export interface StoredSharedFile {
  name: string;
  type: string;
  size: number;
  blob: Blob;
}

export interface StoredSharedPayload {
  id: string;
  createdAtMs: number;
  title: string;
  text: string;
  url: string;
  files: StoredSharedFile[];
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif', '.avif'];
const AUDIO_EXTS = [
  '.opus',
  '.ogg',
  '.oga',
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.amr',
  '.3gp',
  '.flac',
  '.wma',
  '.weba',
];
const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'];

/**
 * Classifies files shared from WhatsApp or Android apps, handling WhatsApp's
 * `.opus`/`.ogg` voice notes (e.g. PTT-2026xxxx-WA0001.opus) even when Android
 * reports an empty or generic `application/octet-stream` MIME type.
 */
export function classifySharedFile(file: { name?: string; type?: string }): SharedMediaKind {
  const mime = (file.type || '').toLowerCase();
  const lowerName = (file.name || '').toLowerCase();

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) {
    // Some Android devices label .3gp or .ogg voice notes under video/3gpp or video/ogg
    if (lowerName.includes('ptt-') || lowerName.endsWith('.opus') || lowerName.endsWith('.oga')) {
      return 'audio';
    }
    return 'video';
  }

  if (IMAGE_EXTS.some((ext) => lowerName.endsWith(ext))) return 'image';
  if (AUDIO_EXTS.some((ext) => lowerName.endsWith(ext))) return 'audio';
  if (VIDEO_EXTS.some((ext) => lowerName.endsWith(ext))) return 'video';
  return 'unsupported';
}

export function normalizeSharedAudioMimeType(file: { name?: string; type?: string }): string {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('audio/')) return file.type || 'audio/ogg';
  const lowerName = (file.name || '').toLowerCase();
  if (lowerName.endsWith('.opus') || lowerName.endsWith('.ogg') || lowerName.endsWith('.oga')) {
    return 'audio/ogg';
  }
  if (lowerName.endsWith('.mp3')) return 'audio/mpeg';
  if (lowerName.endsWith('.m4a') || lowerName.endsWith('.aac')) return 'audio/mp4';
  if (lowerName.endsWith('.wav')) return 'audio/wav';
  if (lowerName.endsWith('.webm') || lowerName.endsWith('.weba')) return 'audio/webm';
  return 'audio/ogg';
}

/**
 * Extracts duration label (e.g. "0:18", "1:04") from any audio Blob/File
 * (including WhatsApp `.opus`/`.ogg`, `.mp3`, `.m4a`, `.wav`).
 */
export async function extractAudioDurationLabel(blob: Blob): Promise<string> {
  if (typeof window === 'undefined') return '0:00';
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    let settled = false;

    const finish = (label: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      audio.load();
      resolve(label);
    };

    const timer = window.setTimeout(() => finish('0:00'), 3500);

    audio.onloadedmetadata = () => {
      const secs = Number.isFinite(audio.duration) ? Math.max(0, Math.round(audio.duration)) : 0;
      if (secs <= 0) {
        finish('0:00');
        return;
      }
      const mins = Math.floor(secs / 60);
      const rem = secs % 60;
      finish(`${mins}:${rem.toString().padStart(2, '0')}`);
    };
    audio.onerror = () => finish('0:00');
    audio.src = url;
  });
}

function openShareInboxDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB indisponível.'));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(SHARE_INBOX_DB_NAME, SHARE_INBOX_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_INBOX_STORE_NAME)) {
        db.createObjectStore(SHARE_INBOX_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir fila de compartilhamento.'));
  });
}

export async function getPendingSharedPayloads(): Promise<StoredSharedPayload[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openShareInboxDb();
    const list = await new Promise<StoredSharedPayload[]>((resolve, reject) => {
      const tx = db.transaction(SHARE_INBOX_STORE_NAME, 'readonly');
      const req = tx.objectStore(SHARE_INBOX_STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as StoredSharedPayload[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.sort((a, b) => a.createdAtMs - b.createdAtMs);
  } catch {
    return [];
  }
}

export async function clearPendingSharedPayloads(ids?: string[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openShareInboxDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SHARE_INBOX_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SHARE_INBOX_STORE_NAME);
      if (ids && ids.length > 0) {
        ids.forEach((id) => store.delete(id));
      } else {
        store.clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-fatal
  }
}
