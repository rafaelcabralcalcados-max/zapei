/**
 * ZAPEI LOCAL MEDIA CACHE (Permanent On-Device IndexedDB Media Storage)
 * ---------------------------------------------------------------------
 * Stores sent and received photos, audios, and videos permanently inside the
 * user's own device browser (IndexedDB), enabling instant zero-network playback
 * when opening any conversation and letting the user manually manage & clean
 * storage per conversation in Settings -> Armazenamento e Dados.
 *
 * IMPORTANT: Never automatically deletes user media without explicit manual action.
 */

export type CachedMediaType = 'image' | 'audio' | 'video';

export interface LocalMediaRecord {
  messageId: string;
  chatId: string;
  peerUid: string;
  peerName: string;
  senderId: string;
  mediaType: CachedMediaType;
  mimeType: string;
  blob: Blob;
  sizeBytes: number;
  durationLabel?: string;
  caption?: string;
  fileName?: string;
  savedAtMs: number;
}

export interface ChatStorageUsage {
  chatId: string;
  peerUid: string;
  peerName: string;
  totalBytes: number;
  itemCount: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  imageBytes: number;
  videoBytes: number;
  audioBytes: number;
  lastSavedAtMs: number;
}

export interface LocalStorageSummary {
  totalBytes: number;
  totalCount: number;
  imageBytes: number;
  imageCount: number;
  videoBytes: number;
  videoCount: number;
  audioBytes: number;
  audioCount: number;
  chats: ChatStorageUsage[];
}

const DB_NAME = 'zapei_local_media_v1';
const DB_VERSION = 1;
const STORE_NAME = 'media_items';
const MANUALLY_DELETED_LS_KEY = 'zapei_manually_deleted_media_v1';
const MAX_DELETED_TRACKED = 2000;

const objectUrlMap = new Map<string, string>();
const changeListeners = new Set<() => void>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openMediaDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'messageId' });
          store.createIndex('by_chatId', 'chatId', { unique: false });
          store.createIndex('by_mediaType', 'mediaType', { unique: false });
          store.createIndex('by_savedAtMs', 'savedAtMs', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

function notifyMediaChange(): void {
  changeListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Ignore listener errors
    }
  });
}

export function subscribeLocalMediaChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function readManuallyDeletedSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(MANUALLY_DELETED_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set<string>(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function writeManuallyDeletedSet(set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const arr = Array.from(set);
    const trimmed = arr.length > MAX_DELETED_TRACKED ? arr.slice(arr.length - MAX_DELETED_TRACKED) : arr;
    window.localStorage.setItem(MANUALLY_DELETED_LS_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore localStorage quota issues
  }
}

export function isMediaManuallyDeletedLocally(messageId: string): boolean {
  return readManuallyDeletedSet().has(messageId);
}

/**
 * Returns a cached Object URL for instant zero-network rendering in <img>, <audio>, or <video>.
 */
export function getOrCreateMediaObjectUrl(
  messageId: string,
  blob: Blob,
  preferredMimeType?: string
): string {
  const existing = objectUrlMap.get(messageId);
  if (existing) return existing;
  const effectiveType =
    blob.type && blob.type !== 'application/octet-stream'
      ? blob.type
      : preferredMimeType && preferredMimeType !== 'application/octet-stream'
        ? preferredMimeType
        : '';
  const typedBlob =
    effectiveType && blob.type !== effectiveType
      ? new Blob([blob], { type: effectiveType })
      : blob;
  const created = URL.createObjectURL(typedBlob);
  objectUrlMap.set(messageId, created);
  return created;
}

/**
 * Persists a sent or received media file permanently in the device's IndexedDB.
 */
export async function saveLocalMedia(record: LocalMediaRecord): Promise<string> {
  const fallbackMime =
    record.mediaType === 'audio'
      ? 'audio/webm'
      : record.mediaType === 'video'
        ? 'video/mp4'
        : 'image/jpeg';
  const resolvedMime =
    (record.mimeType && record.mimeType !== 'application/octet-stream' ? record.mimeType : '') ||
    (record.blob.type && record.blob.type !== 'application/octet-stream' ? record.blob.type : '') ||
    fallbackMime;
  const typedBlob =
    record.blob.type === resolvedMime ? record.blob : new Blob([record.blob], { type: resolvedMime });

  const normalizedRecord: LocalMediaRecord = {
    ...record,
    blob: typedBlob,
    sizeBytes: record.sizeBytes || typedBlob.size || 0,
    mimeType: resolvedMime,
    savedAtMs: record.savedAtMs || Date.now(),
  };

  // Create object URL immediately for instant UI display
  const objectUrl = getOrCreateMediaObjectUrl(
    normalizedRecord.messageId,
    normalizedRecord.blob,
    normalizedRecord.mimeType
  );

  // If previously marked deleted (e.g. re-saved), unmark
  const deletedSet = readManuallyDeletedSet();
  if (deletedSet.has(normalizedRecord.messageId)) {
    deletedSet.delete(normalizedRecord.messageId);
    writeManuallyDeletedSet(deletedSet);
  }

  const db = await openMediaDb();
  if (db) {
    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(normalizedRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Erro ao salvar mídia no aparelho.'));
      } catch (err) {
        reject(err);
      }
    });
  }

  notifyMediaChange();
  return objectUrl;
}

/**
 * Fetches a single media item from local IndexedDB by messageId.
 */
export async function getLocalMedia(messageId: string): Promise<LocalMediaRecord | null> {
  const db = await openMediaDb();
  if (!db) return null;

  return new Promise<LocalMediaRecord | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(messageId);
      req.onsuccess = () => resolve((req.result as LocalMediaRecord | undefined) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Returns all locally stored media items for a specific chatId (newest first).
 */
export async function getLocalMediaByChat(chatId: string): Promise<LocalMediaRecord[]> {
  const db = await openMediaDb();
  if (!db) return [];

  return new Promise<LocalMediaRecord[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const index = tx.objectStore(STORE_NAME).index('by_chatId');
      const req = index.getAll(chatId);
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? (req.result as LocalMediaRecord[]) : [];
        rows.sort((a, b) => b.savedAtMs - a.savedAtMs);
        resolve(rows);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Returns a map of messageId -> ObjectURL for every locally stored media file in a conversation,
 * enabling instant zero-network rendering as soon as the user opens the chat.
 */
export async function getLocalMediaObjectUrlsForChat(
  chatId: string
): Promise<Map<string, { url: string; record: LocalMediaRecord }>> {
  const items = await getLocalMediaByChat(chatId);
  const result = new Map<string, { url: string; record: LocalMediaRecord }>();
  for (const item of items) {
    if (item.blob) {
      const fallbackMime =
        item.mediaType === 'audio'
          ? 'audio/webm'
          : item.mediaType === 'video'
            ? 'video/mp4'
            : 'image/jpeg';
      result.set(item.messageId, {
        url: getOrCreateMediaObjectUrl(item.messageId, item.blob, item.mimeType || fallbackMime),
        record: item,
      });
    }
  }
  return result;
}

/**
 * Computes total on-device storage occupied by Zapei media in IndexedDB,
 * broken down by media type and by conversation (sorted largest first).
 */
export async function getLocalStorageSummaryByChat(): Promise<LocalStorageSummary> {
  const empty: LocalStorageSummary = {
    totalBytes: 0,
    totalCount: 0,
    imageBytes: 0,
    imageCount: 0,
    videoBytes: 0,
    videoCount: 0,
    audioBytes: 0,
    audioCount: 0,
    chats: [],
  };

  const db = await openMediaDb();
  if (!db) return empty;

  const allItems = await new Promise<LocalMediaRecord[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () =>
        resolve(Array.isArray(req.result) ? (req.result as LocalMediaRecord[]) : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

  const byChat = new Map<string, ChatStorageUsage>();

  for (const item of allItems) {
    const bytes = item.sizeBytes || item.blob?.size || 0;
    empty.totalBytes += bytes;
    empty.totalCount += 1;

    if (item.mediaType === 'image') {
      empty.imageBytes += bytes;
      empty.imageCount += 1;
    } else if (item.mediaType === 'video') {
      empty.videoBytes += bytes;
      empty.videoCount += 1;
    } else if (item.mediaType === 'audio') {
      empty.audioBytes += bytes;
      empty.audioCount += 1;
    }

    const existing = byChat.get(item.chatId) || {
      chatId: item.chatId,
      peerUid: item.peerUid || '',
      peerName: item.peerName || 'Conversa',
      totalBytes: 0,
      itemCount: 0,
      imageCount: 0,
      videoCount: 0,
      audioCount: 0,
      imageBytes: 0,
      videoBytes: 0,
      audioBytes: 0,
      lastSavedAtMs: 0,
    };

    existing.totalBytes += bytes;
    existing.itemCount += 1;
    if (item.peerName && existing.peerName === 'Conversa') {
      existing.peerName = item.peerName;
    }
    if (item.savedAtMs > existing.lastSavedAtMs) {
      existing.lastSavedAtMs = item.savedAtMs;
      if (item.peerName) existing.peerName = item.peerName;
    }

    if (item.mediaType === 'image') {
      existing.imageCount += 1;
      existing.imageBytes += bytes;
    } else if (item.mediaType === 'video') {
      existing.videoCount += 1;
      existing.videoBytes += bytes;
    } else if (item.mediaType === 'audio') {
      existing.audioCount += 1;
      existing.audioBytes += bytes;
    }

    byChat.set(item.chatId, existing);
  }

  empty.chats = Array.from(byChat.values()).sort((a, b) => b.totalBytes - a.totalBytes);
  return empty;
}

/**
 * Manually deletes ONLY the user-selected media items from this device's IndexedDB.
 * Revokes cached Object URLs and records the IDs so deleted items show a clean placeholder.
 */
export async function deleteLocalMediaItems(messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;

  const deletedSet = readManuallyDeletedSet();
  for (const id of messageIds) {
    deletedSet.add(id);
    const url = objectUrlMap.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlMap.delete(id);
    }
  }
  writeManuallyDeletedSet(deletedSet);

  const db = await openMediaDb();
  if (!db) {
    notifyMediaChange();
    return messageIds.length;
  }

  let deletedCount = 0;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of messageIds) {
        store.delete(id);
        deletedCount += 1;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  notifyMediaChange();
  return deletedCount;
}

/**
 * Formats byte counts in Brazilian Portuguese (e.g. "0 B", "320 KB", "12,4 MB", "1,1 GB").
 */
export function formatBytesPtBr(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1).replace('.', ',')} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb >= 100 ? 0 : 1).replace('.', ',')} MB`;
  }
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2).replace('.', ',')} GB`;
}
