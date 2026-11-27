import type { User } from 'firebase/auth';
import type { ChatMessage } from '../types/zapei';
import { loadLocalChatPrefs } from './chatPreferences';
import { auth, getDeterministicChatId } from './firebase';
import {
  formatShortTimePt,
  updateLocalMessagesStatus,
  upsertLocalChatMessagesBatch,
} from './localChatStore';

export interface LivePresenceSnapshot {
  uid: string;
  isOnline: boolean;
  lastSeenAt: number;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
}

export interface RelayedChatEnvelope {
  id: string;
  chatId: string;
  userA: string;
  userB: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  type: ChatMessage['type'];
  text: string;
  createdAtMs: number;
  timestampLabel: string;
  mediaUrl?: string;
  audioDuration?: string;
  videoDuration?: string;
  mediaTransitPath?: string;
  mediaDelivered?: boolean;
  mediaSizeBytes?: number;
  mediaMimeType?: string;
  mediaExpiresAtMs?: number;
  orderId?: string;
  orderCode?: string;
  orderSummary?: string;
  orderTotal?: number;
  orderStatusLabel?: string;
  pushPreviewText?: string;
  pushMessageType?: 'text' | 'audio' | 'image' | 'video';
}

export type ChatActivityKind = 'idle' | 'typing' | 'recording_audio' | 'recording_video';

export interface PeerChatActivity {
  peerUid: string;
  chatId: string;
  activity: Exclude<ChatActivityKind, 'idle'>;
  updatedAt: number;
  expiresAt: number;
}

type PresenceListener = (presenceMap: Map<string, LivePresenceSnapshot>) => void;
type IncomingEnvelopeListener = (envelopes: RelayedChatEnvelope[]) => void;
type ActivityListener = (activityMap: Map<string, PeerChatActivity>) => void;
type HiddenPresenceListener = (hiddenUids: Set<string>) => void;

const presenceMap = new Map<string, LivePresenceSnapshot>();
const presenceListeners = new Set<PresenceListener>();
const incomingListeners = new Set<IncomingEnvelopeListener>();
const peerActivityMap = new Map<string, PeerChatActivity>();
const activityListeners = new Set<ActivityListener>();
const hiddenPresenceUids = new Set<string>();
const hiddenPresenceListeners = new Set<HiddenPresenceListener>();
const reachabilityCache = new Map<
  string,
  { reachable: boolean; hidePresence: boolean; fetchedAt: number }
>();
const blockedSenderUids = new Set<string>();
const outboundActivityByTarget = new Map<string, ChatActivityKind>();
const subscribedPeerUids = new Set<string>();
const pendingWsRequests = new Map<
  string,
  { resolve: () => void; reject: (err: Error) => void; timer: number }
>();

let ws: WebSocket | null = null;
let wsAuthenticated = false;
let currentAuthUser: User | null = null;
let currentPresenceState = {
  isOnline: true,
  showOnlineStatus: true,
  showLastSeen: true,
};
let currentActiveChatPeerId: string | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
let manualDisconnect = false;
let activitySweepTimer: number | null = null;

function notifyPresenceListeners(): void {
  const snapshot = new Map(presenceMap);
  presenceListeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {
      // ignore listener errors
    }
  });
}

const HIDDEN_PRESENCE_LS_PREFIX = 'chatfi_hidden_presence_v1_';

function loadHiddenPresenceCache(uid: string): string[] {
  if (typeof window === 'undefined' || !uid) return [];
  try {
    const raw = window.localStorage.getItem(`${HIDDEN_PRESENCE_LS_PREFIX}${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function saveHiddenPresenceCache(uid: string | undefined): void {
  if (typeof window === 'undefined' || !uid) return;
  try {
    window.localStorage.setItem(
      `${HIDDEN_PRESENCE_LS_PREFIX}${uid}`,
      JSON.stringify(Array.from(hiddenPresenceUids).slice(-500))
    );
  } catch {
    // ignore storage quota
  }
}

function notifyHiddenPresenceListeners(): void {
  const snapshot = new Set(hiddenPresenceUids);
  hiddenPresenceListeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {
      // ignore listener errors
    }
  });
}

export function markPeerHiddenPresence(peerUid: string, hidden: boolean): void {
  if (!peerUid) return;
  const changed = hidden
    ? !hiddenPresenceUids.has(peerUid) && Boolean(hiddenPresenceUids.add(peerUid))
    : hiddenPresenceUids.delete(peerUid);
  if (changed || hidden) {
    if (hidden) hiddenPresenceUids.add(peerUid);
    saveHiddenPresenceCache(currentAuthUser?.uid);
    notifyHiddenPresenceListeners();
  }
}

export function setRealtimeBlockedUids(uids: string[]): void {
  blockedSenderUids.clear();
  for (const raw of uids) {
    const clean = (raw || '').trim();
    if (clean) {
      blockedSenderUids.add(clean);
      peerActivityMap.delete(clean);
    }
  }
  notifyActivityListeners();
}

function notifyActivityListeners(): void {
  const snapshot = new Map(peerActivityMap);
  activityListeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {
      // ignore listener errors
    }
  });
}

function ensureActivitySweepTimer(): void {
  if (typeof window === 'undefined') return;
  if (peerActivityMap.size === 0) {
    if (activitySweepTimer !== null) {
      window.clearInterval(activitySweepTimer);
      activitySweepTimer = null;
    }
    return;
  }
  if (activitySweepTimer !== null) return;
  activitySweepTimer = window.setInterval(() => {
    const now = Date.now();
    let changed = false;
    peerActivityMap.forEach((entry, peerUid) => {
      if (entry.expiresAt <= now) {
        peerActivityMap.delete(peerUid);
        changed = true;
      }
    });
    if (changed) {
      notifyActivityListeners();
    }
    if (peerActivityMap.size === 0 && activitySweepTimer !== null) {
      window.clearInterval(activitySweepTimer);
      activitySweepTimer = null;
    }
  }, 1500);
}

function sendRaw(payload: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function scheduleReconnect(): void {
  if (manualDisconnect || !currentAuthUser) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (reconnectTimer !== null) return;
  const delay = Math.min(15000, 1000 * Math.pow(1.6, reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void openSocket();
  }, delay);
}

async function handleIncomingEnvelopes(envelopes: RelayedChatEnvelope[]): Promise<void> {
  const uid = currentAuthUser?.uid;
  if (!uid || envelopes.length === 0) return;

  // Never accept, persist, notify, or ACK messages from locally blocked senders
  const allowedEnvelopes = envelopes.filter(
    (env) => env.senderId === uid || !blockedSenderUids.has(env.senderId)
  );
  if (allowedEnvelopes.length === 0) return;

  const toStore = allowedEnvelopes.map((env) => {
    const isMine = env.senderId === uid;
    const otherUid = isMine ? env.recipientId : env.senderId;
    const otherName = isMine ? env.recipientName : env.senderName;
    const msg: ChatMessage = {
      id: env.id,
      chatId: env.chatId,
      senderId: env.senderId,
      senderName: env.senderName,
      type: env.type,
      text: env.text,
      timestamp: env.timestampLabel || formatShortTimePt(env.createdAtMs),
      mediaUrl: env.mediaUrl,
      audioDuration: env.audioDuration,
      videoDuration: env.videoDuration,
      mediaTransitPath: env.mediaTransitPath,
      mediaDelivered: env.mediaDelivered,
      mediaSizeBytes: env.mediaSizeBytes,
      mediaMimeType: env.mediaMimeType,
      mediaExpiresAtMs: env.mediaExpiresAtMs,
      orderId: env.orderId,
      orderCode: env.orderCode,
      orderSummary: env.orderSummary,
      orderTotal: env.orderTotal,
      orderStatusLabel: env.orderStatusLabel,
      deliveryStatus: isMine ? 'sent' : 'delivered',
    };
    return {
      ownerUid: uid,
      message: msg,
      createdAtMs: env.createdAtMs,
      otherUid,
      otherName,
    };
  });

  // 1) Persist permanently to IndexedDB on this device FIRST
  await upsertLocalChatMessagesBatch(uid, toStore);

  // 2) Acknowledge to server ONLY after device persistence succeeds -> server deletes relayed copy
  const ackIds = allowedEnvelopes
    .filter((e) => e.recipientId === uid)
    .map((e) => e.id);
  if (ackIds.length > 0) {
    const sentOverWs = sendRaw({ type: 'chat:ack', messageIds: ackIds });
    if (!sentOverWs && currentAuthUser) {
      void currentAuthUser
        .getIdToken()
        .then((token) =>
          fetch('/api/chat/relay/ack', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ messageIds: ackIds }),
          })
        )
        .catch(() => {});
    }
  }

  // 3) Notify listeners (triggers incoming message chime / floating banner for new peer msgs)
  const peerIncoming = allowedEnvelopes.filter((e) => e.senderId !== uid);
  if (peerIncoming.length > 0) {
    incomingListeners.forEach((cb) => {
      try {
        cb(peerIncoming);
      } catch {
        // ignore
      }
    });
  }
}

async function openSocket(): Promise<void> {
  if (typeof window === 'undefined' || !currentAuthUser) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  let token = '';
  try {
    token = await currentAuthUser.getIdToken();
  } catch {
    scheduleReconnect();
    return;
  }
  if (!token || manualDisconnect || !currentAuthUser) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/chatfi`;

  try {
    const socket = new WebSocket(url);
    ws = socket;
    wsAuthenticated = false;

    socket.onopen = () => {
      reconnectAttempt = 0;
      sendRaw({
        type: 'auth',
        token,
        isOnline: currentPresenceState.isOnline,
        showOnlineStatus: currentPresenceState.showOnlineStatus,
        showLastSeen: currentPresenceState.showLastSeen,
        activePeerId: currentActiveChatPeerId,
      });
    };

    socket.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data || '{}')) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');
      if (type === 'auth:ok') {
        wsAuthenticated = true;
        if (subscribedPeerUids.size > 0) {
          sendRaw({
            type: 'presence:subscribe',
            uids: Array.from(subscribedPeerUids).slice(0, 500),
          });
        }
        outboundActivityByTarget.forEach((act, targetUid) => {
          if (act !== 'idle') {
            sendRaw({ type: 'chat:activity', targetUid, activity: act });
          }
        });
        return;
      }

      if (type === 'chat:activity') {
        const peerUid = typeof msg.peerUid === 'string' ? msg.peerUid.trim() : '';
        const chatId = typeof msg.chatId === 'string' ? msg.chatId.trim() : '';
        const activity = String(msg.activity || 'idle') as ChatActivityKind;
        if (!peerUid || blockedSenderUids.has(peerUid)) return;
        if (activity === 'idle') {
          if (peerActivityMap.delete(peerUid)) {
            notifyActivityListeners();
            ensureActivitySweepTimer();
          }
        } else if (
          activity === 'typing' ||
          activity === 'recording_audio' ||
          activity === 'recording_video'
        ) {
          const now = Date.now();
          const ttlMs = activity === 'typing' ? 6_500 : 125_000;
          peerActivityMap.set(peerUid, {
            peerUid,
            chatId,
            activity,
            updatedAt: typeof msg.updatedAt === 'number' ? msg.updatedAt : now,
            expiresAt: now + ttlMs,
          });
          notifyActivityListeners();
          ensureActivitySweepTimer();
        }
        return;
      }

      if (type === 'presence:snapshot' || type === 'presence:update') {
        const entries = Array.isArray(msg.entries)
          ? (msg.entries as LivePresenceSnapshot[])
          : [];
        if (entries.length > 0) {
          for (const entry of entries) {
            if (entry && entry.uid) {
              presenceMap.set(entry.uid, entry);
              reachabilityCache.delete(entry.uid);
              if (
                entry.showOnlineStatus === false &&
                entry.showLastSeen === false &&
                !entry.isOnline &&
                !entry.lastSeenAt
              ) {
                hiddenPresenceUids.add(entry.uid);
                peerActivityMap.delete(entry.uid);
              } else if (
                entry.isOnline ||
                entry.lastSeenAt > 0 ||
                entry.showOnlineStatus ||
                entry.showLastSeen
              ) {
                hiddenPresenceUids.delete(entry.uid);
              }
            }
          }
          saveHiddenPresenceCache(currentAuthUser?.uid);
          notifyPresenceListeners();
          notifyHiddenPresenceListeners();
          notifyActivityListeners();
        }
        return;
      }

      if (type === 'chat:sent') {
        const reqId = typeof msg.clientReqId === 'string' ? msg.clientReqId : '';
        const pending = reqId ? pendingWsRequests.get(reqId) : undefined;
        if (pending) {
          window.clearTimeout(pending.timer);
          pendingWsRequests.delete(reqId);
          pending.resolve();
        }
        const msgId = typeof msg.id === 'string' ? msg.id : '';
        const chatId = typeof msg.chatId === 'string' ? msg.chatId : '';
        const uid = currentAuthUser?.uid;
        if (uid && msgId && chatId) {
          void updateLocalMessagesStatus(uid, chatId, [msgId], {
            deliveryStatus: 'sent',
          });
        }
        return;
      }

      if (type === 'chat:message' && msg.envelope) {
        const env = msg.envelope as RelayedChatEnvelope;
        if (env.senderId && peerActivityMap.delete(env.senderId)) {
          notifyActivityListeners();
          ensureActivitySweepTimer();
        }
        void handleIncomingEnvelopes([env]);
        return;
      }

      if (type === 'chat:sync' && Array.isArray(msg.envelopes)) {
        void handleIncomingEnvelopes(msg.envelopes as RelayedChatEnvelope[]);
        return;
      }

      if (type === 'chat:delivered') {
        const uid = currentAuthUser?.uid;
        const chatId = typeof msg.chatId === 'string' ? msg.chatId : '';
        const messageIds = Array.isArray(msg.messageIds)
          ? (msg.messageIds as string[]).filter((id) => typeof id === 'string')
          : [];
        if (uid && messageIds.length > 0) {
          void updateLocalMessagesStatus(uid, chatId, messageIds, {
            deliveryStatus: 'delivered',
          });
          sendRaw({ type: 'chat:receipt_ack', messageIds });
        }
        return;
      }
    };

    socket.onclose = () => {
      wsAuthenticated = false;
      if (ws === socket) {
        ws = null;
      }
      pendingWsRequests.forEach((p, key) => {
        window.clearTimeout(p.timer);
        p.reject(new Error('ws_closed'));
        pendingWsRequests.delete(key);
      });
      scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose handles cleanup & reconnect
    };
  } catch {
    scheduleReconnect();
  }
}

export function startRealtimeClient(user: User | null): void {
  if (!user) {
    manualDisconnect = true;
    currentAuthUser = null;
    wsAuthenticated = false;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
      ws = null;
    }
    presenceMap.clear();
    peerActivityMap.clear();
    hiddenPresenceUids.clear();
    blockedSenderUids.clear();
    reachabilityCache.clear();
    outboundActivityByTarget.clear();
    ensureActivitySweepTimer();
    subscribedPeerUids.clear();
    notifyPresenceListeners();
    notifyHiddenPresenceListeners();
    notifyActivityListeners();
    return;
  }

  const sameUser = currentAuthUser?.uid === user.uid;
  currentAuthUser = user;
  manualDisconnect = false;
  if (!sameUser) {
    const prefs = loadLocalChatPrefs(user.uid);
    setRealtimeBlockedUids(prefs.blockedUids);
    hiddenPresenceUids.clear();
    for (const hUid of loadHiddenPresenceCache(user.uid)) {
      hiddenPresenceUids.add(hUid);
    }
    notifyHiddenPresenceListeners();
  }
  if (!sameUser || !ws || ws.readyState === WebSocket.CLOSED) {
    void openSocket();
  }
}

export function updateLivePresenceState(opts: {
  isOnline: boolean;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
}): void {
  currentPresenceState = {
    isOnline: opts.isOnline,
    showOnlineStatus: opts.showOnlineStatus,
    showLastSeen: opts.showLastSeen,
  };
  if (wsAuthenticated) {
    sendRaw({
      type: 'presence:set',
      isOnline: opts.isOnline,
      showOnlineStatus: opts.showOnlineStatus,
      showLastSeen: opts.showLastSeen,
    });
  }
}

export function updateActiveChatWs(peerId: string | null): void {
  currentActiveChatPeerId = peerId;
  if (wsAuthenticated) {
    sendRaw({ type: 'chat:active', peerId });
  }
}

export function setPresenceSubscribedPeers(uids: string[]): void {
  let changed = false;
  const clean = uids.filter((u) => Boolean(u) && u !== currentAuthUser?.uid).slice(0, 500);
  for (const uid of clean) {
    if (!subscribedPeerUids.has(uid)) {
      subscribedPeerUids.add(uid);
      changed = true;
    }
  }
  if (changed && wsAuthenticated && subscribedPeerUids.size > 0) {
    sendRaw({
      type: 'presence:subscribe',
      uids: Array.from(subscribedPeerUids).slice(0, 500),
    });
  }
}

export function refreshPresenceSubscriptions(): void {
  if (wsAuthenticated && subscribedPeerUids.size > 0) {
    sendRaw({
      type: 'presence:subscribe',
      uids: Array.from(subscribedPeerUids).slice(0, 500),
    });
  }
}

export function subscribeLivePresenceMap(listener: PresenceListener): () => void {
  presenceListeners.add(listener);
  listener(new Map(presenceMap));
  return () => {
    presenceListeners.delete(listener);
  };
}

export function subscribeIncomingRelayMessages(
  listener: IncomingEnvelopeListener
): () => void {
  incomingListeners.add(listener);
  return () => {
    incomingListeners.delete(listener);
  };
}

export function subscribePeerChatActivityMap(listener: ActivityListener): () => void {
  activityListeners.add(listener);
  listener(new Map(peerActivityMap));
  return () => {
    activityListeners.delete(listener);
  };
}

export function sendChatActivity(
  targetUid: string,
  activity: ChatActivityKind,
  authUserFallback?: User | null
): void {
  const cleanTarget = (targetUid || '').trim();
  if (!cleanTarget) return;

  if (activity === 'idle') {
    outboundActivityByTarget.delete(cleanTarget);
  } else {
    outboundActivityByTarget.set(cleanTarget, activity);
  }

  if (wsAuthenticated && sendRaw({ type: 'chat:activity', targetUid: cleanTarget, activity })) {
    return;
  }

  const activeUser = authUserFallback || currentAuthUser || auth.currentUser;
  if (!activeUser) return;
  void activeUser
    .getIdToken()
    .then((token) =>
      fetch('/api/chat/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUid: cleanTarget, activity }),
      })
    )
    .catch(() => {});
}

export function subscribeHiddenPresenceUids(
  listener: HiddenPresenceListener
): () => void {
  hiddenPresenceListeners.add(listener);
  listener(new Set(hiddenPresenceUids));
  return () => {
    hiddenPresenceListeners.delete(listener);
  };
}

export async function checkPeerReachability(
  peerUid: string,
  authUserFallback?: User | null,
  forceFresh = false
): Promise<{ reachable: boolean; hidePresence: boolean }> {
  const cleanPeer = (peerUid || '').trim();
  if (!cleanPeer) return { reachable: true, hidePresence: false };

  const cached = reachabilityCache.get(cleanPeer);
  if (!forceFresh && cached && Date.now() - cached.fetchedAt < 2500) {
    return { reachable: cached.reachable, hidePresence: cached.hidePresence };
  }

  const activeUser = authUserFallback || currentAuthUser || auth.currentUser;
  if (!activeUser) {
    if (cached && !cached.reachable) {
      return { reachable: false, hidePresence: cached.hidePresence };
    }
    return { reachable: true, hidePresence: false };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const token = await activeUser.getIdToken();
      const res = await fetch(
        `/api/chats/peer-reachability?peerUid=${encodeURIComponent(cleanPeer)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          reachable?: boolean;
          hidePresence?: boolean;
        };
        const reachable = data.reachable !== false;
        const hidePresence = Boolean(data.hidePresence);
        reachabilityCache.set(cleanPeer, {
          reachable,
          hidePresence,
          fetchedAt: Date.now(),
        });
        markPeerHiddenPresence(cleanPeer, hidePresence);
        return { reachable, hidePresence };
      }
    } catch {
      // retry once on transient network hiccup
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  if (cached && !cached.reachable) {
    return { reachable: false, hidePresence: cached.hidePresence };
  }
  return { reachable: true, hidePresence: false };
}

export interface SendRelayChatParams {
  myUid: string;
  myName: string;
  otherUid: string;
  otherName: string;
  type: ChatMessage['type'];
  text: string;
  mediaUrl?: string;
  audioDuration?: string;
  videoDuration?: string;
  mediaTransitPath?: string;
  mediaDelivered?: boolean;
  mediaSizeBytes?: number;
  mediaMimeType?: string;
  mediaExpiresAtMs?: number;
  orderId?: string;
  orderCode?: string;
  orderSummary?: string;
  orderTotal?: number;
  orderStatusLabel?: string;
  customMessageId?: string;
  pushPreviewText?: string;
  pushMessageType?: 'text' | 'audio' | 'image' | 'video';
  authUser?: User | null;
}

/**
 * WhatsApp-style Send:
 * 1. Immediately writes message to sender's local IndexedDB (`localChatStore`).
 * 2. Sends over authenticated WebSocket (or HTTP relay fallback) to `server.ts`.
 * 3. Server delivers immediately to recipient and deletes once recipient ACKs into IndexedDB.
 *    ZERO Firestore reads or writes per message!
 */
export async function sendRelayChatMessage(
  params: SendRelayChatParams
): Promise<string> {
  const safeMyName = (params.myName || '').trim().slice(0, 80) || 'Usuário';
  const safeOtherName = (params.otherName || '').trim().slice(0, 80) || 'Contato';
  const [userA, userB] = [params.myUid, params.otherUid].sort();
  const chatId = getDeterministicChatId(params.myUid, params.otherUid);
  const nowMs = Date.now();
  const msgId =
    params.customMessageId && params.customMessageId.trim()
      ? params.customMessageId.trim().slice(0, 96)
      : `m_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
  const timestampLabel = formatShortTimePt(nowMs);

  const envelope: RelayedChatEnvelope = {
    id: msgId,
    chatId,
    userA,
    userB,
    senderId: params.myUid,
    senderName: safeMyName,
    recipientId: params.otherUid,
    recipientName: safeOtherName,
    type: params.type,
    text: ((params.text || '').trim() || 'Mensagem').slice(0, 1000),
    createdAtMs: nowMs,
    timestampLabel,
    ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
    ...(params.audioDuration ? { audioDuration: params.audioDuration.slice(0, 16) } : {}),
    ...(params.videoDuration ? { videoDuration: params.videoDuration.slice(0, 16) } : {}),
    ...(params.mediaTransitPath
      ? { mediaTransitPath: params.mediaTransitPath.slice(0, 260) }
      : {}),
    ...(typeof params.mediaDelivered === 'boolean'
      ? { mediaDelivered: params.mediaDelivered }
      : {}),
    ...(typeof params.mediaSizeBytes === 'number' && params.mediaSizeBytes >= 0
      ? { mediaSizeBytes: Math.round(params.mediaSizeBytes) }
      : {}),
    ...(params.mediaMimeType ? { mediaMimeType: params.mediaMimeType.slice(0, 80) } : {}),
    ...(typeof params.mediaExpiresAtMs === 'number' && params.mediaExpiresAtMs >= 0
      ? { mediaExpiresAtMs: Math.round(params.mediaExpiresAtMs) }
      : {}),
    ...(params.orderId ? { orderId: params.orderId.slice(0, 128) } : {}),
    ...(params.orderCode ? { orderCode: params.orderCode.slice(0, 32) } : {}),
    ...(params.orderSummary ? { orderSummary: params.orderSummary.slice(0, 240) } : {}),
    ...(typeof params.orderTotal === 'number' ? { orderTotal: params.orderTotal } : {}),
    ...(params.orderStatusLabel
      ? { orderStatusLabel: params.orderStatusLabel.slice(0, 120) }
      : {}),
    ...(params.pushPreviewText
      ? { pushPreviewText: params.pushPreviewText.slice(0, 180) }
      : {}),
    ...(params.pushMessageType ? { pushMessageType: params.pushMessageType } : {}),
  };

  // Save optimistically into sender's IndexedDB right away
  await upsertLocalChatMessagesBatch(params.myUid, [
    {
      ownerUid: params.myUid,
      createdAtMs: nowMs,
      otherUid: params.otherUid,
      otherName: safeOtherName,
      message: {
        id: msgId,
        chatId,
        senderId: params.myUid,
        senderName: safeMyName,
        type: envelope.type,
        text: envelope.text,
        timestamp: timestampLabel,
        mediaUrl: envelope.mediaUrl,
        audioDuration: envelope.audioDuration,
        videoDuration: envelope.videoDuration,
        mediaTransitPath: envelope.mediaTransitPath,
        mediaDelivered: envelope.mediaDelivered,
        mediaSizeBytes: envelope.mediaSizeBytes,
        mediaMimeType: envelope.mediaMimeType,
        mediaExpiresAtMs: envelope.mediaExpiresAtMs,
        orderId: envelope.orderId,
        orderCode: envelope.orderCode,
        orderSummary: envelope.orderSummary,
        orderTotal: envelope.orderTotal,
        orderStatusLabel: envelope.orderStatusLabel,
        deliveryStatus: 'sending',
      },
    },
  ]);

  // Try authenticated WebSocket first for zero-overhead instant delivery
  if (wsAuthenticated && ws && ws.readyState === WebSocket.OPEN) {
    const clientReqId = `${msgId}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingWsRequests.delete(clientReqId);
          reject(new Error('ws_ack_timeout'));
        }, 3500);
        pendingWsRequests.set(clientReqId, { resolve, reject, timer });
        const sent = sendRaw({ type: 'chat:send', clientReqId, envelope });
        if (!sent) {
          window.clearTimeout(timer);
          pendingWsRequests.delete(clientReqId);
          reject(new Error('ws_send_failed'));
        }
      });
      return chatId;
    } catch {
      // Fall through to HTTP relay endpoint below
    }
  }

  // Reliable HTTP relay fallback (uses same server-side relay + Web Push)
  const activeUser = params.authUser || currentAuthUser || auth.currentUser;
  if (!activeUser) {
    throw new Error('Usuário não autenticado para envio.');
  }
  const token = await activeUser.getIdToken();
  const res = await fetch('/api/chat/relay/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ envelope }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `Falha no relay (${res.status})`);
  }

  await updateLocalMessagesStatus(params.myUid, chatId, [msgId], {
    deliveryStatus: 'sent',
  });

  return chatId;
}

export async function pullPendingRelayMessagesHttp(user: User | null): Promise<void> {
  const activeUser = user || currentAuthUser || auth.currentUser;
  if (!activeUser) return;
  try {
    const token = await activeUser.getIdToken();
    const res = await fetch('/api/chat/relay/pending', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      ok?: boolean;
      envelopes?: RelayedChatEnvelope[];
      deliveredReceipts?: Array<{ chatId: string; messageIds: string[] }>;
    };
    if (Array.isArray(data.envelopes) && data.envelopes.length > 0) {
      await handleIncomingEnvelopes(data.envelopes);
    }
    if (Array.isArray(data.deliveredReceipts) && data.deliveredReceipts.length > 0) {
      for (const receipt of data.deliveredReceipts) {
        if (receipt.messageIds?.length) {
          await updateLocalMessagesStatus(
            activeUser.uid,
            receipt.chatId || '',
            receipt.messageIds,
            { deliveryStatus: 'delivered' }
          );
        }
      }
    }
  } catch {
    // non-fatal
  }
}
