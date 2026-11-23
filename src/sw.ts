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
      self.registration
        .getNotifications({ tag: `zapei-call-${payload.callId}` })
        .then((notifications) => {
          notifications.forEach((n) => n.close());
        })
    );
    return;
  }

  if (payload.type === 'incoming_call' && payload.callId) {
    const isVideo = payload.callType === 'video';
    const title = isVideo
      ? `Chamada de vídeo · ${payload.callerName || 'Zapei'}`
      : `Ligação de voz · ${payload.callerName || 'Zapei'}`;

    const options: NotificationOptions & {
      vibrate?: number[];
      renotify?: boolean;
      actions?: Array<{ action: string; title: string }>;
    } = {
      body: 'Zapei está chamando · Toque para atender agora',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: `zapei-call-${payload.callId}`,
      renotify: true,
      requireInteraction: true,
      vibrate: [600, 250, 600, 250, 600, 250, 600, 250, 600],
      data: {
        type: 'incoming_call',
        callId: payload.callId,
        callType: payload.callType || 'audio',
        callerName: payload.callerName || 'Contato',
        url: `/?incomingCall=${encodeURIComponent(payload.callId)}`,
      },
      actions: [
        { action: 'answer', title: 'Atender' },
        { action: 'decline', title: 'Recusar' },
      ],
    };

    event.waitUntil(self.registration.showNotification(title, options));
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
