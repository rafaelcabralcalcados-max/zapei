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

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

interface ZapeiPushPayload {
  type: 'incoming_call' | 'call_cancelled' | 'new_message';
  callId?: string;
  callerId?: string;
  callerName?: string;
  callType?: 'audio' | 'video';
  ringIndex?: number;
  senderId?: string;
  senderName?: string;
  body?: string;
  messageType?: 'text' | 'audio' | 'image';
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
      senderName: 'Zapei',
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

  if (payload.type === 'incoming_call' && payload.callId) {
    const isVideo = payload.callType === 'video';
    const ringIndex = Number(payload.ringIndex || 1);
    const caller = payload.callerName || 'Zapei';
    const title = isVideo
      ? `📹 CHAMADA DE VÍDEO · ${caller}`
      : `📞 LIGAÇÃO · ${caller}`;

    const options: NotificationOptions & {
      vibrate?: number[];
      renotify?: boolean;
      silent?: boolean;
      actions?: Array<{ action: string; title: string }>;
    } = {
      body: `🔔 TOCANDO AGORA — Toque para ATENDER ou RECUSAR`,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      // Unique tag per ring pulse after closing the previous one guarantees iOS & Android re-play sound + vibration
      tag: `zapei-call-${payload.callId}-${ringIndex}`,
      renotify: true,
      silent: false,
      requireInteraction: true,
      vibrate: [900, 250, 900, 250, 900],
      data: {
        type: 'incoming_call',
        callId: payload.callId,
        callType: payload.callType || 'audio',
        callerName: caller,
        url: `/?incomingCall=${encodeURIComponent(payload.callId)}`,
      },
      actions: [
        { action: 'answer', title: '✅ Atender' },
        { action: 'decline', title: '❌ Recusar' },
      ],
    };

    event.waitUntil(
      self.registration
        .getNotifications()
        .then((existing) => {
          existing.forEach((n) => {
            const d = (n.data || {}) as { callId?: string };
            if (d.callId === payload.callId) {
              n.close();
            }
          });
        })
        .catch(() => {})
        .then(() => self.registration.showNotification(title, options))
    );
    return;
  }

  // Real background chat message notification (text, audio, photo)
  const msgTitle = payload.senderName || 'Nova mensagem no Zapei';
  const rawBody = payload.body || 'Você recebeu uma nova mensagem.';
  const formattedBody =
    payload.messageType === 'audio' && !rawBody.startsWith('🎤')
      ? `🎤 ${rawBody}`
      : payload.messageType === 'image' && !rawBody.startsWith('📷')
        ? `📷 ${rawBody}`
        : rawBody;
  const uniqueMsgKey = payload.messageId || String(Date.now());
  const msgOptions: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
    silent?: boolean;
  } = {
    body: formattedBody,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    // Unique tag + renotify:true + silent:false ensures EVERY text/audio message chimes & vibrates on iOS & Android
    tag: payload.senderId
      ? `zapei-msg-${payload.senderId}-${uniqueMsgKey}`
      : `zapei-msg-${uniqueMsgKey}`,
    renotify: true,
    silent: false,
    vibrate: [200, 80, 200],
    data: {
      type: 'new_message',
      senderId: payload.senderId || '',
      url: payload.senderId
        ? `/?openChat=${encodeURIComponent(payload.senderId)}`
        : '/',
    },
  };

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        const activeForegroundClient = windowClients.find(
          (c) => c.visibilityState === 'visible' && 'focused' in c && (c as WindowClient).focused
        );
        if (activeForegroundClient) {
          // App is already open & focused on screen: let in-app WhatsApp chime + banner handle it without double OS alert
          activeForegroundClient.postMessage({
            type: 'ZAPEI_INCOMING_MESSAGE_PING',
            payload: {
              senderId: payload.senderId || '',
              senderName: msgTitle,
              body: formattedBody,
              messageType: payload.messageType || 'text',
            },
          });
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
        return self.registration.showNotification(msgTitle, msgOptions);
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
