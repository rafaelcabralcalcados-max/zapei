import type { User } from 'firebase/auth';
import type { ChatMessage } from '../types/zapei';
import { getDeterministicChatId } from './firebase';
import { sendRelayChatMessage } from './realtimeClient';

/**
 * ZAPEI MODULAR MESSAGE TRANSPORT LAYER (Phase 1: Smart Offline Outbox + Mesh Bridge Ready)
 * -----------------------------------------------------------------------------------------
 * Centralizes message packet creation, offline queueing (IndexedDB with localStorage fallback),
 * automatic chronological flush on network recovery, and defines the pluggable Mesh Bridge
 * contract so a native Bluetooth / Wi-Fi Direct plugin (Capacitor + Google Nearby Connections /
 * Apple MultipeerConnectivity) can be attached in Phase 2 without changing any chat UI code.
 */

export type TransportDeliveryStatus = 'pending' | 'sending' | 'sent' | 'delivered';

/**
 * Canonical routable message envelope prepared for both Cloud (Firebase) and local Mesh relay.
 */
export interface ZapeiMessagePacket {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  type: ChatMessage['type'];
  text: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  audioDuration?: string;
  videoDuration?: string;
  pushPreviewText?: string;
  pushMessageType?: 'text' | 'audio' | 'image' | 'video';
  timestamp: number; // Epoch ms — guarantees deterministic chronological ordering
  viaMesh: boolean; // false = Firebase/Internet; true = delivered/relayed via local Mesh
  hops: number; // 0 = direct cloud/peer; incremented on each future Mesh relay hop
  maxHops: number; // TTL loop-prevention ceiling for future multi-hop Mesh routing
  deliveryStatus: TransportDeliveryStatus;
}

/**
 * Pluggable transport channel interface.
 * - Default active adapter: CloudFirebaseTransportAdapter (Firestore + Web Push)
 * - Future Phase 2 adapter: NativeMeshBridgeAdapter (Capacitor Bluetooth LE / Wi-Fi Direct /
 *   Google Nearby Connections / Apple MultipeerConnectivity)
 */
export interface MessageTransportAdapter {
  readonly channelName: 'cloud_firebase' | 'local_mesh_bridge';
  isAvailable: () => boolean;
  sendPacket: (
    packet: ZapeiMessagePacket,
    authUser: User | null
  ) => Promise<{ ok: boolean; viaMesh: boolean; hops: number }>;
  /**
   * Optional hook for Phase 2 Mesh Bridge: subscribes to packets received over local radio
   * (Bluetooth / Wi-Fi Direct) from nearby Zapei devices, including packets meant for this user
   * or packets to relay (store-and-forward) if hops < maxHops.
   */
  subscribeIncomingPackets?: (
    onPacket: (packet: ZapeiMessagePacket) => void
  ) => () => void;
}

// --- LOCAL OUTBOX PERSISTENCE (IndexedDB primary + localStorage fallback) ---

const OUTBOX_DB_NAME = 'zapei_offline_transport_db';
const OUTBOX_STORE_NAME = 'outbox_packets';
const OUTBOX_LS_KEY = 'zapei_offline_outbox_v1';

let outboxCache: ZapeiMessagePacket[] = [];
let outboxLoaded = false;
let isFlushingOutbox = false;

type OutboxListener = (packets: ZapeiMessagePacket[]) => void;
const outboxListeners = new Set<OutboxListener>();

type IncomingMeshListener = (packet: ZapeiMessagePacket) => void;
const incomingMeshListeners = new Set<IncomingMeshListener>();
const seenMeshPacketIds = new Set<string>();

function notifyOutboxListeners(): void {
  const snapshot = [...outboxCache].sort((a, b) => a.timestamp - b.timestamp);
  outboxListeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {
      // Ignore subscriber errors
    }
  });
}

function openOutboxDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(OUTBOX_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
          db.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readLocalStorageOutbox(): ZapeiMessagePacket[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ZapeiMessagePacket[]) : [];
  } catch {
    return [];
  }
}

function writeLocalStorageOutbox(packets: ZapeiMessagePacket[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OUTBOX_LS_KEY, JSON.stringify(packets));
  } catch {
    // Quota exceeded (e.g., large offline audio/photo) — IndexedDB handles larger payloads
  }
}

async function loadPersistedOutbox(): Promise<ZapeiMessagePacket[]> {
  if (outboxLoaded) return outboxCache;

  const idb = await openOutboxDb();
  if (idb) {
    const fromIdb = await new Promise<ZapeiMessagePacket[]>((resolve) => {
      try {
        const tx = idb.transaction(OUTBOX_STORE_NAME, 'readonly');
        const store = tx.objectStore(OUTBOX_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () =>
          resolve(Array.isArray(req.result) ? (req.result as ZapeiMessagePacket[]) : []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    idb.close();

    // Merge with any localStorage fallback entries (deduplicated by packet id)
    const map = new Map<string, ZapeiMessagePacket>();
    for (const p of readLocalStorageOutbox()) map.set(p.id, p);
    for (const p of fromIdb) map.set(p.id, p);
    outboxCache = Array.from(map.values())
      .map((p) => ({
        ...p,
        // Any packet stuck in 'sending' across a reload returns cleanly to 'pending'
        deliveryStatus: p.deliveryStatus === 'sending' ? ('pending' as const) : p.deliveryStatus,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  } else {
    outboxCache = readLocalStorageOutbox()
      .map((p) => ({
        ...p,
        deliveryStatus: p.deliveryStatus === 'sending' ? ('pending' as const) : p.deliveryStatus,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  outboxLoaded = true;
  notifyOutboxListeners();
  return outboxCache;
}

async function persistOutboxPacket(packet: ZapeiMessagePacket): Promise<void> {
  const idx = outboxCache.findIndex((item) => item.id === packet.id);
  if (idx >= 0) {
    outboxCache[idx] = packet;
  } else {
    outboxCache.push(packet);
  }
  outboxCache.sort((a, b) => a.timestamp - b.timestamp);
  writeLocalStorageOutbox(outboxCache);

  const idb = await openOutboxDb();
  if (idb) {
    await new Promise<void>((resolve) => {
      try {
        const tx = idb.transaction(OUTBOX_STORE_NAME, 'readwrite');
        tx.objectStore(OUTBOX_STORE_NAME).put(packet);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    idb.close();
  }
  notifyOutboxListeners();
}

async function removeOutboxPacket(packetId: string): Promise<void> {
  outboxCache = outboxCache.filter((item) => item.id !== packetId);
  writeLocalStorageOutbox(outboxCache);

  const idb = await openOutboxDb();
  if (idb) {
    await new Promise<void>((resolve) => {
      try {
        const tx = idb.transaction(OUTBOX_STORE_NAME, 'readwrite');
        tx.objectStore(OUTBOX_STORE_NAME).delete(packetId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    idb.close();
  }
  notifyOutboxListeners();
}

// --- ACTIVE TRANSPORT ADAPTERS ---

const cloudFirebaseAdapter: MessageTransportAdapter = {
  channelName: 'cloud_firebase',
  isAvailable: () => typeof navigator === 'undefined' || navigator.onLine,
  sendPacket: async (packet, authUser) => {
    await sendRelayChatMessage({
      myUid: packet.senderId,
      myName: packet.senderName,
      otherUid: packet.recipientId,
      otherName: packet.recipientName,
      type: packet.type,
      text: packet.text,
      mediaUrl: packet.mediaUrl,
      mediaMimeType: packet.mediaMimeType,
      audioDuration: packet.audioDuration,
      videoDuration: packet.videoDuration,
      customMessageId: packet.id,
      pushPreviewText: packet.pushPreviewText || packet.text,
      pushMessageType:
        packet.pushMessageType ||
        (packet.type === 'audio' || packet.type === 'image' || packet.type === 'video'
          ? packet.type
          : 'text'),
      authUser,
    });

    return { ok: true, viaMesh: false, hops: 0 };
  },
};

/**
 * Phase 2 Extension Point: Native Mesh Bridge Adapter slot.
 * When Zapei is packaged with Capacitor (Android/iOS), register a native plugin wrapping
 * Google Nearby Connections / Apple MultipeerConnectivity / BLE Mesh here via
 * `registerMeshBridgeAdapter(nativeAdapter)`.
 */
let meshBridgeAdapter: MessageTransportAdapter | null = null;
let unsubscribeMeshIncoming: (() => void) | null = null;

export function registerMeshBridgeAdapter(adapter: MessageTransportAdapter | null): void {
  if (unsubscribeMeshIncoming) {
    unsubscribeMeshIncoming();
    unsubscribeMeshIncoming = null;
  }
  meshBridgeAdapter = adapter;

  if (adapter?.subscribeIncomingPackets) {
    unsubscribeMeshIncoming = adapter.subscribeIncomingPackets((incomingPacket) => {
      // Deduplicate looped packets by ID before delivering or relaying
      if (seenMeshPacketIds.has(incomingPacket.id)) return;
      seenMeshPacketIds.add(incomingPacket.id);
      if (seenMeshPacketIds.size > 1000) {
        const first = seenMeshPacketIds.values().next().value;
        if (first) seenMeshPacketIds.delete(first);
      }
      incomingMeshListeners.forEach((listener) => {
        try {
          listener(incomingPacket);
        } catch {
          // Ignore listener failure
        }
      });
    });
  }
}

export function subscribeIncomingMeshPackets(listener: IncomingMeshListener): () => void {
  incomingMeshListeners.add(listener);
  return () => {
    incomingMeshListeners.delete(listener);
  };
}

export function isDeviceOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function formatPacketTimeLabel(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

/**
 * Converts a locally queued ZapeiMessagePacket into a standard ChatMessage object
 * so ChatThreadView renders it identically to online messages, with the pending clock status.
 */
export function packetToChatMessage(packet: ZapeiMessagePacket): ChatMessage {
  return {
    id: packet.id,
    chatId: packet.chatId,
    senderId: packet.senderId,
    senderName: packet.senderName,
    type: packet.type,
    text: packet.text,
    timestamp: formatPacketTimeLabel(packet.timestamp),
    createdAtMs: packet.timestamp,
    mediaUrl: packet.mediaUrl,
    mediaMimeType: packet.mediaMimeType,
    audioDuration: packet.audioDuration,
    videoDuration: packet.videoDuration,
    deliveryStatus: packet.deliveryStatus,
    viaMesh: packet.viaMesh,
    hops: packet.hops,
  };
}

export function subscribeOutbox(listener: OutboxListener): () => void {
  outboxListeners.add(listener);
  void loadPersistedOutbox().then((packets) => {
    listener([...packets]);
  });
  return () => {
    outboxListeners.delete(listener);
  };
}

export interface SendTransportMessageInput {
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  type: ChatMessage['type'];
  text: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  audioDuration?: string;
  videoDuration?: string;
  pushPreviewText?: string;
  pushMessageType?: 'text' | 'audio' | 'image' | 'video';
}

/**
 * Sends a message through the best available transport channel:
 * 1. Online -> Cloud Firebase Adapter (direct delivery + Web Push)
 * 2. Offline + Native Mesh Bridge available -> Local Bluetooth/Wi-Fi Direct Mesh (viaMesh: true)
 * 3. Offline -> Persisted immediately in local Outbox (IndexedDB/localStorage) with 'pending' status
 *    so it appears in the chat bubble with the clock icon and auto-sends when signal returns.
 */
export async function sendOrQueueMessage(
  input: SendTransportMessageInput,
  authUser: User | null
): Promise<{ packet: ZapeiMessagePacket; queuedOffline: boolean }> {
  await loadPersistedOutbox();

  const now = Date.now();
  const chatId = getDeterministicChatId(input.senderId, input.recipientId);
  const packet: ZapeiMessagePacket = {
    id: `m_${now}_${Math.random().toString(36).slice(2, 7)}`,
    chatId,
    senderId: input.senderId,
    senderName: input.senderName,
    recipientId: input.recipientId,
    recipientName: input.recipientName,
    type: input.type,
    text: input.text,
    mediaUrl: input.mediaUrl,
    mediaMimeType: input.mediaMimeType,
    audioDuration: input.audioDuration,
    videoDuration: input.videoDuration,
    pushPreviewText: input.pushPreviewText,
    pushMessageType: input.pushMessageType,
    timestamp: now,
    viaMesh: false,
    hops: 0,
    maxHops: 4,
    deliveryStatus: 'pending',
  };

  // Path A: Online via standard Firebase cloud transport
  if (cloudFirebaseAdapter.isAvailable()) {
    try {
      const res = await cloudFirebaseAdapter.sendPacket(packet, authUser);
      if (res.ok) {
        return {
          packet: {
            ...packet,
            viaMesh: res.viaMesh,
            hops: res.hops,
            deliveryStatus: 'sent',
          },
          queuedOffline: false,
        };
      }
    } catch {
      // Network dropped mid-flight: fall through to local offline outbox instead of losing message
    }
  }

  // Path B (Phase 2 ready): Local Mesh Bridge when offline and native plugin is registered
  if (meshBridgeAdapter && meshBridgeAdapter.isAvailable()) {
    try {
      const meshRes = await meshBridgeAdapter.sendPacket(
        { ...packet, viaMesh: true, hops: 1 },
        authUser
      );
      if (meshRes.ok) {
        return {
          packet: {
            ...packet,
            viaMesh: true,
            hops: meshRes.hops,
            deliveryStatus: 'sent',
          },
          queuedOffline: false,
        };
      }
    } catch {
      // Fall back to local outbox queue
    }
  }

  // Path C: Offline Outbox Queue — persist locally so UI shows clock status and auto-flushes online
  await persistOutboxPacket(packet);
  return { packet, queuedOffline: true };
}

/**
 * Flushes all locally queued messages for the signed-in user in strict chronological order
 * as soon as internet connectivity is available.
 */
export async function flushOfflineOutbox(
  authUser: User | null
): Promise<{ sentCount: number; remainingCount: number }> {
  await loadPersistedOutbox();

  if (isFlushingOutbox || !authUser || !isDeviceOnline()) {
    return {
      sentCount: 0,
      remainingCount: outboxCache.filter((p) => !authUser || p.senderId === authUser.uid).length,
    };
  }

  const minePending = outboxCache
    .filter((p) => p.senderId === authUser.uid)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (minePending.length === 0) {
    return { sentCount: 0, remainingCount: 0 };
  }

  isFlushingOutbox = true;
  let sentCount = 0;

  try {
    for (const pkt of minePending) {
      if (!isDeviceOnline()) break;

      await persistOutboxPacket({ ...pkt, deliveryStatus: 'sending' });
      try {
        await cloudFirebaseAdapter.sendPacket(pkt, authUser);
        await removeOutboxPacket(pkt.id);
        sentCount += 1;
      } catch {
        // Put back as 'pending' and stop flushing until network stabilizes
        await persistOutboxPacket({ ...pkt, deliveryStatus: 'pending' });
        break;
      }
    }
  } finally {
    isFlushingOutbox = false;
  }

  const remainingCount = outboxCache.filter((p) => p.senderId === authUser.uid).length;
  return { sentCount, remainingCount };
}

/**
 * Installs automatic browser 'online' / 'offline' listeners that update UI connectivity state
 * and drain the local Outbox automatically in chronological order when signal returns.
 */
export function installConnectivitySyncListeners(params: {
  getAuthUser: () => User | null;
  onOnlineStatusChange: (isOnline: boolean) => void;
  onOutboxFlushed?: (sentCount: number) => void;
}): () => void {
  if (typeof window === 'undefined') return () => {};

  const tryFlush = () => {
    const user = params.getAuthUser();
    if (!user || !isDeviceOnline()) return;
    void flushOfflineOutbox(user).then(({ sentCount }) => {
      if (sentCount > 0) {
        params.onOutboxFlushed?.(sentCount);
      }
    });
  };

  const handleOnline = () => {
    params.onOnlineStatusChange(true);
    tryFlush();
  };

  const handleOffline = () => {
    params.onOnlineStatusChange(false);
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      const nowOnline = isDeviceOnline();
      params.onOnlineStatusChange(nowOnline);
      if (nowOnline) tryFlush();
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibility);

  // Sync initial status and drain any leftover queued messages if already online
  const initiallyOnline = isDeviceOnline();
  params.onOnlineStatusChange(initiallyOnline);
  if (initiallyOnline) {
    tryFlush();
  }

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}
