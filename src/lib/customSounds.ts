/**
 * ZAPEI CUSTOM DEVICE SOUNDS STORE (IndexedDB)
 * --------------------------------------------
 * Persists audio files chosen directly from the user's phone/device storage
 * for 3 independent alert slots:
 *   - 'call'          -> Incoming voice & video call ringtone
 *   - 'text_message'  -> Incoming text, photo & video messages
 *   - 'audio_message' -> Incoming voice / audio messages
 *
 * Stored 100% locally on-device (IndexedDB) with zero cloud cost and
 * immediate synchronous Blob URL lookup after startup hydration.
 */

export type CustomSoundSlot = 'call' | 'text_message' | 'audio_message';

export interface CustomSoundRecord {
  slot: CustomSoundSlot;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
  updatedAtMs: number;
}

export interface CustomSoundMeta {
  slot: CustomSoundSlot;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  updatedAtMs: number;
}

export type CustomSoundMetaMap = Record<CustomSoundSlot, CustomSoundMeta | null>;

const DB_NAME = 'zapei_custom_sounds_v1';
const DB_VERSION = 1;
const STORE_NAME = 'sounds';
const MAX_CUSTOM_SOUND_BYTES = 15 * 1024 * 1024; // 15 MB max per phone audio file

const AUDIO_EXTENSIONS = [
  '.mp3',
  '.m4a',
  '.ogg',
  '.opus',
  '.wav',
  '.aac',
  '.flac',
  '.webm',
  '.amr',
  '.3gp',
  '.oga',
  '.wma',
];

const cachedUrls: Record<CustomSoundSlot, string | null> = {
  call: null,
  text_message: null,
  audio_message: null,
};

const cachedMeta: CustomSoundMetaMap = {
  call: null,
  text_message: null,
  audio_message: null,
};

let dbPromise: Promise<IDBDatabase> | null = null;
let hydrated = false;
let hydratePromise: Promise<CustomSoundMetaMap> | null = null;
const listeners = new Set<(meta: CustomSoundMetaMap) => void>();

function notifyListeners(): void {
  const snapshot: CustomSoundMetaMap = {
    call: cachedMeta.call,
    text_message: cachedMeta.text_message,
    audio_message: cachedMeta.audio_message,
  };
  listeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {
      // ignore subscriber errors
    }
  });
}

function openSoundsDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB indisponível neste navegador.'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Falha ao abrir banco local de sons.'));
    };
  });

  return dbPromise;
}

export function isSupportedCustomAudioFile(file: File): boolean {
  if (file.type && file.type.toLowerCase().startsWith('audio/')) {
    return true;
  }
  const lowerName = (file.name || '').toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

function inferAudioMimeType(file: File): string {
  if (file.type && file.type.startsWith('audio/')) {
    return file.type;
  }
  const lower = (file.name || '').toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 'audio/mp4';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga') || lower.endsWith('.opus')) {
    return 'audio/ogg';
  }
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.webm')) return 'audio/webm';
  return 'audio/mpeg';
}

function setSlotCache(slot: CustomSoundSlot, record: CustomSoundRecord | null): void {
  const prevUrl = cachedUrls[slot];
  if (prevUrl) {
    try {
      URL.revokeObjectURL(prevUrl);
    } catch {
      // ignore
    }
    cachedUrls[slot] = null;
  }
  if (record && record.blob) {
    cachedUrls[slot] = URL.createObjectURL(record.blob);
    cachedMeta[slot] = {
      slot: record.slot,
      fileName: record.fileName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      updatedAtMs: record.updatedAtMs,
    };
  } else {
    cachedMeta[slot] = null;
  }
}

/**
 * Loads all saved custom phone sounds from IndexedDB into in-memory Blob URLs
 * so incoming calls and messages play instantaneously without async delay.
 */
export async function hydrateCustomSounds(): Promise<CustomSoundMetaMap> {
  if (typeof window === 'undefined') {
    return { call: null, text_message: null, audio_message: null };
  }
  if (hydrated) {
    return {
      call: cachedMeta.call,
      text_message: cachedMeta.text_message,
      audio_message: cachedMeta.audio_message,
    };
  }
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      const db = await openSoundsDb();
      const records = await new Promise<CustomSoundRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as CustomSoundRecord[]) || []);
        req.onerror = () => reject(req.error || new Error('Erro ao ler sons salvos.'));
      });

      const slots: CustomSoundSlot[] = ['call', 'text_message', 'audio_message'];
      for (const slot of slots) {
        const found = records.find((r) => r.slot === slot) || null;
        setSlotCache(slot, found);
      }
      hydrated = true;
      notifyListeners();
    } catch {
      hydrated = true;
    } finally {
      hydratePromise = null;
    }

    return {
      call: cachedMeta.call,
      text_message: cachedMeta.text_message,
      audio_message: cachedMeta.audio_message,
    };
  })();

  return hydratePromise;
}

export function getCustomSoundObjectUrl(slot: CustomSoundSlot): string | null {
  return cachedUrls[slot];
}

export function getAllCustomSoundMeta(): CustomSoundMetaMap {
  return {
    call: cachedMeta.call,
    text_message: cachedMeta.text_message,
    audio_message: cachedMeta.audio_message,
  };
}

export function subscribeCustomSounds(
  listener: (meta: CustomSoundMetaMap) => void
): () => void {
  listeners.add(listener);
  listener(getAllCustomSoundMeta());
  return () => {
    listeners.delete(listener);
  };
}

export async function saveCustomSoundFromFile(
  slot: CustomSoundSlot,
  file: File
): Promise<CustomSoundMeta> {
  if (!isSupportedCustomAudioFile(file)) {
    throw new Error(
      'Formato não suportado. Escolha um arquivo de áudio do celular (MP3, M4A, OGG, OPUS, WAV ou AAC).'
    );
  }
  if (file.size > MAX_CUSTOM_SOUND_BYTES) {
    throw new Error('O arquivo de som ultrapassa 15 MB. Escolha um áudio mais curto.');
  }

  const mimeType = inferAudioMimeType(file);
  const blob = new Blob([await file.arrayBuffer()], { type: mimeType });
  const record: CustomSoundRecord = {
    slot,
    fileName: (file.name || 'Som_do_celular.mp3').slice(0, 120),
    mimeType,
    sizeBytes: blob.size,
    blob,
    updatedAtMs: Date.now(),
  };

  const db = await openSoundsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Não foi possível salvar o som neste aparelho.'));
  });

  hydrated = true;
  setSlotCache(slot, record);
  notifyListeners();

  return {
    slot: record.slot,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    updatedAtMs: record.updatedAtMs,
  };
}

export async function removeCustomSound(slot: CustomSoundSlot): Promise<void> {
  try {
    const db = await openSoundsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Falha ao remover som salvo.'));
    });
  } catch {
    // Still clear memory cache
  }
  setSlotCache(slot, null);
  notifyListeners();
}
