import type { ChatMessage, ChatThreadSummary } from '../types/zapei';
import type { PublicDirectoryUser } from './firebase';

const CHAT_DB_NAME = 'chatfi_local_chats_v1';
const CHAT_DB_VERSION = 1;
const STORE_MESSAGES = 'messages';
const STORE_THREADS = 'threads';
const STORE_PROFILES = 'profiles';
const STORE_META = 'meta';

export interface StoredLocalMessage extends ChatMessage {
  storageKey: string; // `${ownerUid}::${id}`
  ownerUid: string;
  createdAtMs: number;
}

export interface StoredLocalThread extends ChatThreadSummary {
  storageKey: string; // `${ownerUid}::${id}`
  ownerUid: string;
}

export interface CachedDirectoryProfile extends PublicDirectoryUser {
  storageKey: string; // `${ownerUid}::${uid}`
  ownerUid: string;
  cachedAtMs: number;
}

type ThreadsListener = (threads: ChatThreadSummary[]) => void;
type MessagesListener = (messages: ChatMessage[]) => void;
type ProfilesListener = (profiles: PublicDirectoryUser[]) => void;

const threadListenersByOwner = new Map<string, Set<ThreadsListener>>();
const messageListenersByKey = new Map<string, Set<MessagesListener>>();
const profileListenersByOwner = new Map<string, Set<ProfilesListener>>();

const threadsCacheByOwner = new Map<string, Map<string, StoredLocalThread>>();
const messagesCacheByKey = new Map<string, Map<string, StoredLocalMessage>>();
const profilesCacheByOwner = new Map<string, Map<string, CachedDirectoryProfile>>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openChatDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(CHAT_DB_NAME, CHAT_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          const msgStore = db.createObjectStore(STORE_MESSAGES, { keyPath: 'storageKey' });
          msgStore.createIndex('by_owner', 'ownerUid', { unique: false });
          msgStore.createIndex('by_owner_chat', ['ownerUid', 'chatId'], { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_THREADS)) {
          const thrStore = db.createObjectStore(STORE_THREADS, { keyPath: 'storageKey' });
          thrStore.createIndex('by_owner', 'ownerUid', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PROFILES)) {
          const profStore = db.createObjectStore(STORE_PROFILES, { keyPath: 'storageKey' });
          profStore.createIndex('by_owner', 'ownerUid', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
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

export function formatShortTimePt(ms: number): string {
  const d = new Date(ms || Date.now());
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function getThreadsMap(ownerUid: string): Map<string, StoredLocalThread> {
  let map = threadsCacheByOwner.get(ownerUid);
  if (!map) {
    map = new Map<string, StoredLocalThread>();
    threadsCacheByOwner.set(ownerUid, map);
  }
  return map;
}

function getMessagesMap(ownerUid: string, chatId: string): Map<string, StoredLocalMessage> {
  const key = `${ownerUid}::${chatId}`;
  let map = messagesCacheByKey.get(key);
  if (!map) {
    map = new Map<string, StoredLocalMessage>();
    messagesCacheByKey.set(key, map);
  }
  return map;
}

function getProfilesMap(ownerUid: string): Map<string, CachedDirectoryProfile> {
  let map = profilesCacheByOwner.get(ownerUid);
  if (!map) {
    map = new Map<string, CachedDirectoryProfile>();
    profilesCacheByOwner.set(ownerUid, map);
  }
  return map;
}

function emitThreads(ownerUid: string): void {
  const listeners = threadListenersByOwner.get(ownerUid);
  if (!listeners || listeners.size === 0) return;
  const sorted = Array.from(getThreadsMap(ownerUid).values())
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .map(({ storageKey: _sk, ownerUid: _ou, ...summary }) => summary);
  listeners.forEach((cb) => {
    try {
      cb(sorted);
    } catch {
      // ignore subscriber failure
    }
  });
}

function emitMessages(ownerUid: string, chatId: string): void {
  const key = `${ownerUid}::${chatId}`;
  const listeners = messageListenersByKey.get(key);
  if (!listeners || listeners.size === 0) return;
  const sorted = Array.from(getMessagesMap(ownerUid, chatId).values())
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))
    .map(({ storageKey: _sk, ownerUid: _ou, ...msg }) => msg);
  listeners.forEach((cb) => {
    try {
      cb(sorted);
    } catch {
      // ignore subscriber failure
    }
  });
}

function emitProfiles(ownerUid: string): void {
  const listeners = profileListenersByOwner.get(ownerUid);
  if (!listeners || listeners.size === 0) return;
  const sorted = Array.from(getProfilesMap(ownerUid).values())
    .map(({ storageKey: _sk, ownerUid: _ou, cachedAtMs: _ca, ...profile }) => profile)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  listeners.forEach((cb) => {
    try {
      cb(sorted);
    } catch {
      // ignore subscriber failure
    }
  });
}

export async function loadLocalThreads(ownerUid: string): Promise<ChatThreadSummary[]> {
  if (!ownerUid) return [];
  const map = getThreadsMap(ownerUid);
  const db = await openChatDb();
  if (db) {
    const records = await new Promise<StoredLocalThread[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_THREADS, 'readonly');
        const idx = tx.objectStore(STORE_THREADS).index('by_owner');
        const req = idx.getAll(ownerUid);
        req.onsuccess = () =>
          resolve(Array.isArray(req.result) ? (req.result as StoredLocalThread[]) : []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    for (const r of records) {
      const existing = map.get(r.id);
      if (!existing || r.updatedAtMs >= existing.updatedAtMs) {
        map.set(r.id, r);
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .map(({ storageKey: _sk, ownerUid: _ou, ...summary }) => summary);
}

export async function loadLocalChatMessages(
  ownerUid: string,
  chatId: string
): Promise<ChatMessage[]> {
  if (!ownerUid || !chatId) return [];
  const map = getMessagesMap(ownerUid, chatId);
  const db = await openChatDb();
  if (db) {
    const records = await new Promise<StoredLocalMessage[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_MESSAGES, 'readonly');
        const idx = tx.objectStore(STORE_MESSAGES).index('by_owner_chat');
        const req = idx.getAll([ownerUid, chatId]);
        req.onsuccess = () =>
          resolve(Array.isArray(req.result) ? (req.result as StoredLocalMessage[]) : []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    for (const r of records) {
      if (!map.has(r.id)) {
        map.set(r.id, r);
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))
    .map(({ storageKey: _sk, ownerUid: _ou, ...msg }) => msg);
}

export function subscribeLocalChatThreads(
  ownerUid: string,
  callback: ThreadsListener
): () => void {
  if (!ownerUid) return () => {};
  let set = threadListenersByOwner.get(ownerUid);
  if (!set) {
    set = new Set();
    threadListenersByOwner.set(ownerUid, set);
  }
  set.add(callback);

  void loadLocalThreads(ownerUid).then((threads) => {
    callback(threads);
  });

  return () => {
    set?.delete(callback);
  };
}

export function subscribeLocalChatMessages(
  ownerUid: string,
  chatId: string,
  callback: MessagesListener
): () => void {
  if (!ownerUid || !chatId) return () => {};
  const key = `${ownerUid}::${chatId}`;
  let set = messageListenersByKey.get(key);
  if (!set) {
    set = new Set();
    messageListenersByKey.set(key, set);
  }
  set.add(callback);

  void loadLocalChatMessages(ownerUid, chatId).then((msgs) => {
    callback(msgs);
  });

  return () => {
    set?.delete(callback);
  };
}

export interface UpsertLocalMessageInput {
  ownerUid: string;
  message: ChatMessage;
  createdAtMs: number;
  otherUid: string;
  otherName: string;
}

export async function upsertLocalChatMessagesBatch(
  ownerUid: string,
  items: UpsertLocalMessageInput[],
  extraThreads?: ChatThreadSummary[]
): Promise<void> {
  if (!ownerUid || (items.length === 0 && (!extraThreads || extraThreads.length === 0))) return;

  const threadsMap = getThreadsMap(ownerUid);
  const touchedChatIds = new Set<string>();
  const messagesToWrite: StoredLocalMessage[] = [];
  const threadsToWrite = new Map<string, StoredLocalThread>();

  if (extraThreads) {
    for (const t of extraThreads) {
      const existing = threadsMap.get(t.id);
      if (!existing || t.updatedAtMs >= existing.updatedAtMs) {
        const storedThread: StoredLocalThread = {
          ...t,
          storageKey: `${ownerUid}::${t.id}`,
          ownerUid,
        };
        threadsMap.set(t.id, storedThread);
        threadsToWrite.set(t.id, storedThread);
      }
    }
  }

  for (const item of items) {
    const { message, createdAtMs, otherUid, otherName } = item;
    const chatMap = getMessagesMap(ownerUid, message.chatId);
    const existingMsg = chatMap.get(message.id);

    const mergedMsg: StoredLocalMessage = {
      ...(existingMsg || {}),
      ...message,
      storageKey: `${ownerUid}::${message.id}`,
      ownerUid,
      createdAtMs: existingMsg?.createdAtMs || createdAtMs || Date.now(),
      timestamp: message.timestamp || existingMsg?.timestamp || formatShortTimePt(createdAtMs),
      // Keep mediaDelivered=true sticky once confirmed
      mediaDelivered: existingMsg?.mediaDelivered === true ? true : message.mediaDelivered,
      // Prefer highest deliveryStatus rank
      deliveryStatus: pickBestDeliveryStatus(
        existingMsg?.deliveryStatus,
        message.deliveryStatus
      ),
    };
    chatMap.set(message.id, mergedMsg);
    messagesToWrite.push(mergedMsg);
    touchedChatIds.add(message.chatId);

    const existingThread = threadsMap.get(message.chatId);
    const [userA, userB] = [ownerUid, otherUid].sort();
    const myName =
      message.senderId === ownerUid
        ? message.senderName || 'Você'
        : existingThread
          ? userA === ownerUid
            ? existingThread.userAName
            : existingThread.userBName
          : 'Você';
    const resolvedOtherName =
      otherName && otherName !== 'Contato'
        ? otherName
        : existingThread?.otherName || otherName || 'Contato';

    const shouldUpdateSummary =
      !existingThread || createdAtMs >= existingThread.updatedAtMs;
    const nextThread: StoredLocalThread = {
      id: message.chatId,
      userA,
      userB,
      userAName: userA === ownerUid ? myName : resolvedOtherName,
      userBName: userB === ownerUid ? myName : resolvedOtherName,
      otherUid,
      otherName: resolvedOtherName,
      lastMessage: shouldUpdateSummary
        ? message.text || existingThread?.lastMessage || 'Mensagem'
        : existingThread.lastMessage,
      lastSenderId: shouldUpdateSummary
        ? message.senderId
        : existingThread.lastSenderId,
      updatedAtLabel: shouldUpdateSummary
        ? mergedMsg.timestamp
        : existingThread.updatedAtLabel,
      updatedAtMs: shouldUpdateSummary
        ? Math.max(createdAtMs, existingThread?.updatedAtMs || 0)
        : existingThread.updatedAtMs,
      storageKey: `${ownerUid}::${message.chatId}`,
      ownerUid,
    };
    threadsMap.set(message.chatId, nextThread);
    threadsToWrite.set(message.chatId, nextThread);
  }

  const db = await openChatDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction([STORE_MESSAGES, STORE_THREADS], 'readwrite');
        const msgStore = tx.objectStore(STORE_MESSAGES);
        const thrStore = tx.objectStore(STORE_THREADS);
        for (const m of messagesToWrite) msgStore.put(m);
        for (const t of threadsToWrite.values()) thrStore.put(t);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  touchedChatIds.forEach((cid) => emitMessages(ownerUid, cid));
  emitThreads(ownerUid);
}

function pickBestDeliveryStatus(
  a?: ChatMessage['deliveryStatus'],
  b?: ChatMessage['deliveryStatus']
): ChatMessage['deliveryStatus'] {
  const rank: Record<string, number> = {
    pending: 1,
    sending: 2,
    sent: 3,
    delivered: 4,
  };
  const ra = a ? rank[a] || 0 : 0;
  const rb = b ? rank[b] || 0 : 0;
  return rb >= ra ? b : a;
}

export async function updateLocalMessagesStatus(
  ownerUid: string,
  chatId: string,
  messageIds: string[],
  patch: Partial<Pick<ChatMessage, 'deliveryStatus' | 'mediaDelivered' | 'mediaUrl'>>
): Promise<void> {
  if (!ownerUid || messageIds.length === 0) return;
  const db = await openChatDb();
  const updatedRecords: StoredLocalMessage[] = [];
  const touchedChatIds = new Set<string>();
  if (chatId) touchedChatIds.add(chatId);

  for (const msgId of messageIds) {
    // Check known maps first
    let found: StoredLocalMessage | undefined;
    if (chatId) {
      found = getMessagesMap(ownerUid, chatId).get(msgId);
    } else {
      for (const [key, map] of messagesCacheByKey.entries()) {
        if (key.startsWith(`${ownerUid}::`) && map.has(msgId)) {
          found = map.get(msgId);
          break;
        }
      }
    }

    if (!found && db) {
      found = await new Promise<StoredLocalMessage | undefined>((resolve) => {
        try {
          const tx = db.transaction(STORE_MESSAGES, 'readonly');
          const req = tx.objectStore(STORE_MESSAGES).get(`${ownerUid}::${msgId}`);
          req.onsuccess = () => resolve(req.result as StoredLocalMessage | undefined);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      });
    }

    if (found) {
      const next: StoredLocalMessage = {
        ...found,
        ...patch,
        deliveryStatus: pickBestDeliveryStatus(found.deliveryStatus, patch.deliveryStatus),
      };
      getMessagesMap(ownerUid, found.chatId).set(msgId, next);
      updatedRecords.push(next);
      touchedChatIds.add(found.chatId);
    }
  }

  if (updatedRecords.length > 0 && db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_MESSAGES, 'readwrite');
        const store = tx.objectStore(STORE_MESSAGES);
        for (const r of updatedRecords) store.put(r);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  touchedChatIds.forEach((cid) => emitMessages(ownerUid, cid));
}

export async function loadCachedDirectoryProfiles(
  ownerUid: string
): Promise<CachedDirectoryProfile[]> {
  if (!ownerUid) return [];
  const map = getProfilesMap(ownerUid);
  const db = await openChatDb();
  if (db) {
    const records = await new Promise<CachedDirectoryProfile[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_PROFILES, 'readonly');
        const idx = tx.objectStore(STORE_PROFILES).index('by_owner');
        const req = idx.getAll(ownerUid);
        req.onsuccess = () =>
          resolve(Array.isArray(req.result) ? (req.result as CachedDirectoryProfile[]) : []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    for (const r of records) {
      const prev = map.get(r.uid);
      if (!prev || r.cachedAtMs >= prev.cachedAtMs) {
        map.set(r.uid, r);
      }
    }
  }
  return Array.from(map.values());
}

export async function upsertCachedDirectoryProfiles(
  ownerUid: string,
  profiles: PublicDirectoryUser[]
): Promise<void> {
  if (!ownerUid || profiles.length === 0) return;
  const map = getProfilesMap(ownerUid);
  const now = Date.now();
  const toWrite: CachedDirectoryProfile[] = [];

  for (const p of profiles) {
    if (!p.uid || p.uid === ownerUid) continue;
    const prev = map.get(p.uid);
    const merged: CachedDirectoryProfile = {
      ...prev,
      ...p,
      // Keep live in-memory presence fields if prev has newer values
      isOnline: p.isOnline ?? prev?.isOnline,
      lastSeenAt: p.lastSeenAt ?? prev?.lastSeenAt,
      storageKey: `${ownerUid}::${p.uid}`,
      ownerUid,
      cachedAtMs: now,
    };
    map.set(p.uid, merged);
    toWrite.push(merged);
  }

  const db = await openChatDb();
  if (db && toWrite.length > 0) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_PROFILES, 'readwrite');
        const store = tx.objectStore(STORE_PROFILES);
        for (const r of toWrite) store.put(r);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  emitProfiles(ownerUid);
}

export function subscribeCachedDirectoryProfiles(
  ownerUid: string,
  callback: ProfilesListener
): () => void {
  if (!ownerUid) return () => {};
  let set = profileListenersByOwner.get(ownerUid);
  if (!set) {
    set = new Set();
    profileListenersByOwner.set(ownerUid, set);
  }
  set.add(callback);

  void loadCachedDirectoryProfiles(ownerUid).then((list) => {
    callback(
      list
        .map(({ storageKey: _sk, ownerUid: _ou, cachedAtMs: _ca, ...p }) => p)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'))
    );
  });

  return () => {
    set?.delete(callback);
  };
}

export async function getMetaFlag(key: string): Promise<string | null> {
  const db = await openChatDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(key);
      req.onsuccess = () => {
        const val = req.result as { value?: string } | undefined;
        resolve(val?.value ?? null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setMetaFlag(key: string, value: string): Promise<void> {
  const db = await openChatDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ key, value, updatedAtMs: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
