import type { User } from 'firebase/auth';

export type BackgroundPushStatus =
  | 'enabled'
  | 'prompt'
  | 'denied'
  | 'ios_needs_install'
  | 'unsupported';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

async function getActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('Service Worker indisponível.');
  }
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) {
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch {
      // Dev mode uses virtual SW or already-registering SW; continue to ready check
    }
  }
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    window.setTimeout(() => reject(new Error('Service Worker timeout')), 6000);
  });
  return Promise.race([navigator.serviceWorker.ready, timeoutPromise]);
}

export async function getBackgroundPushStatus(): Promise<BackgroundPushStatus> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  if (isIOSDevice() && !isStandalonePWA()) {
    return 'ios_needs_install';
  }
  if (!('Notification' in window) || !('PushManager' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') {
    return 'denied';
  }
  if (Notification.permission === 'granted') {
    try {
      const reg = await getActiveServiceWorkerRegistration();
      const sub = await reg.pushManager.getSubscription();
      return sub ? 'enabled' : 'prompt';
    } catch {
      return 'prompt';
    }
  }
  return 'prompt';
}

const IOS_PUSH_REGEN_KEY = 'chatfi_push_regen_v3';

async function postSubscriptionToServer(
  authUser: User,
  subscription: PushSubscription
): Promise<{ ok: boolean; staleEndpoint?: boolean }> {
  const token = await authUser.getIdToken();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!res.ok) return { ok: false };
  try {
    const data = (await res.json()) as { ok?: boolean; staleEndpoint?: boolean };
    return { ok: Boolean(data.ok), staleEndpoint: Boolean(data.staleEndpoint) };
  } catch {
    return { ok: true };
  }
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function subscriptionMatchesVapidKey(
  sub: PushSubscription,
  serverPublicKey: string
): boolean {
  try {
    const rawKey = sub.options?.applicationServerKey;
    if (!rawKey) return false;
    const currentKeyB64 = uint8ArrayToBase64Url(new Uint8Array(rawKey));
    return currentKeyB64 === serverPublicKey.replace(/=+$/g, '').trim();
  } catch {
    return false;
  }
}

async function ensureFreshSubscriptionForServerKey(
  reg: ServiceWorkerRegistration,
  publicKey: string,
  forceRenew = false
): Promise<PushSubscription> {
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    if (!forceRenew && subscriptionMatchesVapidKey(existing, publicKey)) {
      return existing;
    }
    // Server VAPID key changed or endpoint was revoked: silently replace stale subscription
    try {
      await existing.unsubscribe();
    } catch {
      // ignore
    }
  }
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

function needsOneTimeIosPushRenewal(): boolean {
  if (!isIOSDevice()) return false;
  try {
    return window.localStorage.getItem(IOS_PUSH_REGEN_KEY) !== '1';
  } catch {
    return false;
  }
}

function markIosPushRenewed(): void {
  if (!isIOSDevice()) return;
  try {
    window.localStorage.setItem(IOS_PUSH_REGEN_KEY, '1');
  } catch {
    // ignore
  }
}

async function subscribeAndSyncDevice(
  authUser: User,
  reg: ServiceWorkerRegistration,
  publicKey: string
): Promise<boolean> {
  const forceOneTime = needsOneTimeIosPushRenewal();
  let subscription = await ensureFreshSubscriptionForServerKey(reg, publicKey, forceOneTime);
  let res = await postSubscriptionToServer(authUser, subscription);
  if (res.staleEndpoint) {
    subscription = await ensureFreshSubscriptionForServerKey(reg, publicKey, true);
    res = await postSubscriptionToServer(authUser, subscription);
  }
  if (res.ok && forceOneTime) {
    markIosPushRenewed();
  }
  return res.ok;
}

/**
 * Requests real browser/OS notification permission, subscribes to W3C Web Push (VAPID),
 * and registers the PushSubscription on the Zapei server for closed-app / locked-screen wake-up.
 */
export async function enableRealBackgroundCallPush(
  authUser: User
): Promise<{ status: BackgroundPushStatus; message: string }> {
  if (isIOSDevice() && !isStandalonePWA()) {
    return {
      status: 'ios_needs_install',
      message:
        'No iPhone, adicione o ChatFi à Tela de Início para ativar alertas com a tela bloqueada.',
    };
  }

  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('Notification' in window) ||
    !('PushManager' in window)
  ) {
    return {
      status: 'unsupported',
      message: 'Notificações em segundo plano não estão disponíveis neste dispositivo.',
    };
  }

  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return {
      status: 'denied',
      message:
        'Notificações desativadas nas preferências do aparelho. Ative nas configurações do sistema quando desejar.',
    };
  }

  const keyRes = await fetch('/api/push/vapid-public-key');
  if (!keyRes.ok) {
    throw new Error('Não foi possível sincronizar o serviço de notificações.');
  }
  const { publicKey } = (await keyRes.json()) as { publicKey: string };

  const reg = await getActiveServiceWorkerRegistration();
  const ok = await subscribeAndSyncDevice(authUser, reg, publicKey);
  if (!ok) {
    throw new Error('Falha ao ativar notificações neste aparelho.');
  }

  return {
    status: 'enabled',
    message:
      'Notificações ativadas com sucesso neste aparelho.',
  };
}

/**
 * Silently refreshes an already-granted browser PushSubscription with the server on app boot,
 * automatically healing VAPID key changes or Apple-revoked endpoints after server restarts/redeploys.
 */
export async function syncExistingPushSubscription(
  authUser: User
): Promise<BackgroundPushStatus> {
  const status = await getBackgroundPushStatus();
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  ) {
    return status;
  }
  if (isIOSDevice() && !isStandalonePWA()) {
    return 'ios_needs_install';
  }
  try {
    const keyRes = await fetch('/api/push/vapid-public-key');
    if (!keyRes.ok) return status;
    const { publicKey } = (await keyRes.json()) as { publicKey: string };
    const reg = await getActiveServiceWorkerRegistration();
    const ok = await subscribeAndSyncDevice(authUser, reg, publicKey);
    return ok ? 'enabled' : status;
  } catch {
    return status;
  }
}

/**
 * Retries push subscription registration if the first attempt fails transiently (e.g. Render cold start).
 */
export async function syncExistingPushSubscriptionWithRetry(
  authUser: User
): Promise<BackgroundPushStatus> {
  const delays = [0, 6000, 15000];
  let lastStatus: BackgroundPushStatus = 'prompt';
  for (let i = 0; i < delays.length; i += 1) {
    if (delays[i] > 0) {
      await new Promise((r) => window.setTimeout(r, delays[i]));
    }
    lastStatus = await syncExistingPushSubscription(authUser);
    if (
      lastStatus === 'enabled' ||
      lastStatus === 'denied' ||
      lastStatus === 'unsupported' ||
      lastStatus === 'ios_needs_install'
    ) {
      return lastStatus;
    }
  }
  return lastStatus;
}

/**
 * Triggers a real high-priority W3C Web Push to wake up the callee's closed/locked device,
 * with 1 automatic retry for transient server cold-starts.
 */
export async function triggerRemoteCallPush(
  authUser: User,
  params: {
    calleeId: string;
    callId: string;
    callerName: string;
    callType: 'audio' | 'video';
    event: 'ringing' | 'cancelled';
  }
): Promise<{ ok: boolean; sent: number }> {
  const attempt = async (): Promise<{ ok: boolean; sent: number }> => {
    const token = await authUser.getIdToken();
    const res = await fetch('/api/push/notify-call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) return { ok: false, sent: 0 };
    const data = (await res.json()) as { ok?: boolean; sent?: number };
    return { ok: Boolean(data.ok), sent: Number(data.sent ?? 0) };
  };

  try {
    const first = await attempt();
    if (first.ok) return first;
    await new Promise((r) => window.setTimeout(r, 2000));
    return await attempt();
  } catch {
    try {
      await new Promise((r) => window.setTimeout(r, 2000));
      return await attempt();
    } catch {
      return { ok: false, sent: 0 };
    }
  }
}

/**
 * Triggers a real W3C Web Push alert when sending a message to a peer whose app is closed,
 * with 1 automatic retry for transient server cold-starts.
 */
export async function triggerRemoteMessagePush(
  authUser: User,
  params: {
    recipientId: string;
    senderName: string;
    previewText: string;
    messageType?: 'text' | 'audio' | 'image' | 'video';
  }
): Promise<void> {
  const attempt = async (): Promise<boolean> => {
    const token = await authUser.getIdToken();
    const res = await fetch('/api/push/notify-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    return res.ok;
  };

  try {
    const ok = await attempt();
    if (!ok) {
      await new Promise((r) => window.setTimeout(r, 2000));
      await attempt();
    }
  } catch {
    try {
      await new Promise((r) => window.setTimeout(r, 2000));
      await attempt();
    } catch {
      // Non-blocking
    }
  }
}
