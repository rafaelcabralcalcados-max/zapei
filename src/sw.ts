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

  // Real background chat message notification
  const msgTitle = payload.senderName || 'Nova mensagem no Zapei';
  const msgOptions: NotificationOptions & { vibrate?: number[] } = {
    body: payload.body || 'Você recebeu uma nova mensagem.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.senderId ? `zapei-msg-${payload.senderId}` : 'zapei-msg',
    vibrate: [180, 80, 180],
    data: {
      type: 'new_message',
      senderId: payload.senderId || '',
      url: payload.senderId
        ? `/?openChat=${encodeURIComponent(payload.senderId)}`
        : '/',
    },
  };

  event.waitUntil(self.registration.showNotification(msgTitle, msgOptions));
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
