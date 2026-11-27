/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

let activeChatState: { peerId: string | null; visible: boolean; updatedAt: number } = {
  peerId: null,
  visible: false,
  updatedAt: 0,
};

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'CHATFI_ACTIVE_CHAT') {
    activeChatState = {
      peerId: typeof event.data.peerId === 'string' && event.data.peerId ? event.data.peerId : null,
      visible: Boolean(event.data.visible),
      updatedAt: Date.now(),
    };
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const SHARE_INBOX_DB_NAME = 'zapei_share_inbox_v1';
const SHARE_INBOX_DB_VERSION = 1;
const SHARE_INBOX_STORE_NAME = 'pending_shares';

interface SwSharedFileRecord {
  name: string;
  type: string;
  size: number;
  blob: Blob;
}

interface SwSharedPayloadRecord {
  id: string;
  createdAtMs: number;
  title: string;
  text: string;
  url: string;
  files: SwSharedFileRecord[];
}

function saveSharedPayloadInSw(payload: SwSharedPayloadRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_INBOX_DB_NAME, SHARE_INBOX_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_INBOX_STORE_NAME)) {
        db.createObjectStore(SHARE_INBOX_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(SHARE_INBOX_STORE_NAME, 'readwrite');
      tx.objectStore(SHARE_INBOX_STORE_NAME).put(payload);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

// Intercept Web Share Target POSTs from WhatsApp / Android Share Sheet
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const title = String(formData.get('title') || '').trim();
          const text = String(formData.get('text') || '').trim();
          const sharedUrl = String(formData.get('url') || '').trim();
          const rawFiles = formData.getAll('media');

          const files: SwSharedFileRecord[] = [];
          for (const entry of rawFiles) {
            if (entry instanceof File && entry.size > 0) {
              const arrayBuffer = await entry.arrayBuffer();
              const blob = new Blob([arrayBuffer], {
                type: entry.type || 'application/octet-stream',
              });
              files.push({
                name: entry.name || `arquivo_${Date.now()}`,
                type: entry.type || blob.type || '',
                size: blob.size,
                blob,
              });
            }
          }

          if (files.length > 0 || title || text || sharedUrl) {
            await saveSharedPayloadInSw({
              id: `share_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              createdAtMs: Date.now(),
              title,
              text,
              url: sharedUrl,
              files,
            });
          }

          const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });
          clients.forEach((client) => {
            client.postMessage({ type: 'ZAPEI_SHARED_MEDIA_READY' });
          });
        } catch {
          // Always redirect gracefully even if share payload is empty
        }
        return Response.redirect('/?shared=1', 303);
      })()
    );
  }
});

interface ZapeiPushPayload {
  type: 'incoming_call' | 'call_cancelled' | 'new_message';
  callId?: string;
  callerId?: string;
  callerName?: string;
  callerAvatarUrl?: string;
  callType?: 'audio' | 'video';
  ringIndex?: number;
  senderId?: string;
  senderName?: string;
  senderAvatarUrl?: string;
  body?: string;
  messageType?: 'text' | 'audio' | 'image' | 'video';
  messageId?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let payload: ZapeiPushPayload;
  try {
    payload = event.data.json() as ZapeiPushPayload;
  } catch {
    payload = {
      type: 'new_message',
      senderName: 'Nova mensagem',
      body: event.data.text(),
    };
  }

  if (payload.type === 'call_cancelled' && payload.callId) {
    event.waitUntil(
      self.registration.getNotifications().then((notifications) => {
        notifications.forEach((n) => {
          const d = (n.data || {}) as { callId?: string };
          if (d.callId === payload.callId || n.tag.startsWith(`zapei-call-${payload.callId}`)) {
            n.close();
          }
        });
      })
    );
    return;
  }

  const supportsNotificationActions =
    typeof Notification !== 'undefined' && 'actions' in Notification.prototype;

  if (payload.type === 'incoming_call' && payload.callId) {
    const isVideo = payload.callType === 'video';
    const ringIndex = Number(payload.ringIndex || 1);
    const caller = payload.callerName || 'Ligação recebida';
    const title = caller;

    const callData = {
      type: 'incoming_call',
      callId: payload.callId,
      callType: payload.callType || 'audio',
      callerName: caller,
      url: `/?incomingCall=${encodeURIComponent(payload.callId)}`,
    };

    const minimalOptions: NotificationOptions = {
      body: isVideo ? '📹 Chamada de vídeo recebida' : '📞 Ligação de voz recebida',
      ...(payload.callerAvatarUrl ? { icon: payload.callerAvatarUrl } : {}),
      tag: `zapei-call-${payload.callId}-${ringIndex}`,
      data: callData,
    };

    const richOptions: NotificationOptions & {
      vibrate?: number[];
      renotify?: boolean;
      actions?: Array<{ action: string; title: string }>;
    } = supportsNotificationActions
      ? {
          ...minimalOptions,
          body: '🔔 TOCANDO AGORA — Toque para ATENDER ou RECUSAR',
          renotify: true,
          silent: false,
          requireInteraction: true,
          vibrate: [900, 250, 900, 250, 900],
          actions: [
            { action: 'answer', title: '✅ Atender' },
            { action: 'decline', title: '❌ Recusar' },
          ],
        }
      : minimalOptions;

    event.waitUntil(
      (async () => {
        // Also ping any open ChatFi window so foreground/resuming phones open the call screen immediately
        try {
          const windowClients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });
          windowClients.forEach((client) => {
            client.postMessage({
              type: 'ZAPEI_INCOMING_CALL_PING',
              payload: { callId: payload.callId },
            });
          });
        } catch {
          // Non-fatal
        }

        try {
          const existing = await self.registration.getNotifications();
          existing.forEach((n) => {
            const d = (n.data || {}) as { callId?: string };
            if (d.callId === payload.callId) {
              n.close();
            }
          });
        } catch {
          // Non-fatal
        }

        try {
          await self.registration.showNotification(title, richOptions);
        } catch {
          // Guaranteed minimal fallback for strict iOS WebKit / Safari builds
          await self.registration.showNotification(title, minimalOptions);
        }
      })()
    );
    return;
  }

  // Real background chat message notification (text, audio, photo)
  // Show ONLY sender photo, sender name, and message (never the ChatFi app logo)
  const msgTitle = payload.senderName || 'Nova mensagem';
  const rawBody = payload.body || 'Você recebeu uma nova mensagem.';
  const formattedBody =
    payload.messageType === 'audio' && !rawBody.startsWith('🎤')
      ? `🎤 ${rawBody}`
      : payload.messageType === 'image' && !rawBody.startsWith('📷')
        ? `📷 ${rawBody}`
        : payload.messageType === 'video' && !rawBody.startsWith('🎥')
          ? `🎥 ${rawBody}`
          : rawBody;
  const uniqueMsgKey = payload.messageId || String(Date.now());
  const msgMinimalOptions: NotificationOptions = {
    body: formattedBody,
    ...(payload.senderAvatarUrl ? { icon: payload.senderAvatarUrl } : {}),
    tag: payload.senderId
      ? `zapei-msg-${payload.senderId}-${uniqueMsgKey}`
      : `zapei-msg-${uniqueMsgKey}`,
    data: {
      type: 'new_message',
      senderId: payload.senderId || '',
      url: payload.senderId
        ? `/?openChat=${encodeURIComponent(payload.senderId)}`
        : '/',
    },
  };
  const msgRichOptions: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
  } = supportsNotificationActions
    ? {
        ...msgMinimalOptions,
        renotify: true,
        silent: false,
        vibrate: [200, 80, 200],
      }
    : msgMinimalOptions;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        const visibleClients = windowClients.filter((c) => c.visibilityState === 'visible');
        const isViewingSenderChat = Boolean(
          visibleClients.length > 0 &&
            payload.senderId &&
            activeChatState.visible &&
            activeChatState.peerId === payload.senderId &&
            Date.now() - activeChatState.updatedAt < 45_000
        );
        if (isViewingSenderChat) {
          // User already has this exact conversation open and visible on screen — no OS notification needed
          return;
        }

        const activeForegroundClient =
          windowClients.find(
            (c) => c.visibilityState === 'visible' && 'focused' in c && (c as WindowClient).focused
          ) || visibleClients[0];
        if (activeForegroundClient) {
          activeForegroundClient.postMessage({
            type: 'ZAPEI_INCOMING_MESSAGE_PING',
            payload: {
              senderId: payload.senderId || '',
              senderName: msgTitle,
              body: formattedBody,
              messageType: payload.messageType || 'text',
            },
          });
          // On iOS Safari (no actions support), WebKit strictly enforces userVisibleOnly on every push
          // and revokes push subscriptions after 3 silent pushes. Show briefly and auto-close.
          if (!supportsNotificationActions) {
            try {
              const fgTag = `zapei-fg-${uniqueMsgKey}`;
              await self.registration.showNotification(msgTitle, {
                ...msgMinimalOptions,
                tag: fgTag,
                silent: true,
              });
              const open = await self.registration.getNotifications({ tag: fgTag });
              open.forEach((n) => n.close());
            } catch {
              // Ignore
            }
          }
          return;
        }
        try {
          const nav = self.navigator as Navigator & {
            setAppBadge?: (count?: number) => Promise<void>;
          };
          if (typeof nav.setAppBadge === 'function') {
            void nav.setAppBadge().catch(() => {});
          }
        } catch {
          // Ignore badge API errors on unsupported browsers
        }
        try {
          await self.registration.showNotification(msgTitle, msgRichOptions);
        } catch {
          await self.registration.showNotification(msgTitle, msgMinimalOptions);
        }
      })
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  const notification = event.notification;
  const data = (notification.data || {}) as {
    type?: string;
    callId?: string;
    senderId?: string;
    url?: string;
  };
  const action = event.action || 'open';

  notification.close();

  const targetUrl =
    data.type === 'incoming_call' && data.callId
      ? `/?incomingCall=${encodeURIComponent(data.callId)}&callAction=${encodeURIComponent(action)}`
      : data.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if ('focus' in client) {
            client.postMessage({
              type: 'ZAPEI_PUSH_ACTION',
              payload: {
                kind: data.type,
                callId: data.callId,
                senderId: data.senderId,
                action,
              },
            });
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
