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
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return sub ? 'enabled' : 'prompt';
    } catch {
      return 'prompt';
    }
  }
  return 'prompt';
}

async function postSubscriptionToServer(
  authUser: User,
  subscription: PushSubscription
): Promise<boolean> {
  const token = await authUser.getIdToken();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  return res.ok;
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
  publicKey: string
): Promise<PushSubscription> {
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    if (subscriptionMatchesVapidKey(existing, publicKey)) {
      return existing;
    }
    // Server VAPID key changed (e.g. after redeploy): silently replace stale subscription
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
        'No iPhone, instale o Zapei na Tela de Início (Compartilhar > Adicionar à Tela de Início) e abra pelo ícone para ativar notificações com tela bloqueada.',
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
      message: 'Este navegador não suporta notificações Web Push em segundo plano.',
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      status: 'denied',
      message:
        'Permissão de notificações negada. Ative as notificações nas configurações do navegador para o telefone tocar com o app fechado.',
    };
  }

  const keyRes = await fetch('/api/push/vapid-public-key');
  if (!keyRes.ok) {
    throw new Error('Não foi possível obter a chave VAPID do servidor.');
  }
  const { publicKey } = (await keyRes.json()) as { publicKey: string };

  const reg = await navigator.serviceWorker.ready;
  const subscription = await ensureFreshSubscriptionForServerKey(reg, publicKey);

  const ok = await postSubscriptionToServer(authUser, subscription);
  if (!ok) {
    throw new Error('Falha ao registrar este aparelho para chamadas em segundo plano.');
  }

  return {
    status: 'enabled',
    message:
      'Alertas em segundo plano ativados! Agora este aparelho receberá chamadas do Zapei mesmo com o app fechado ou tela bloqueada.',
  };
}

/**
 * Silently refreshes an already-granted browser PushSubscription with the server on app boot,
 * automatically healing VAPID key changes after server restarts/redeploys.
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
    const reg = await navigator.serviceWorker.ready;
    const sub = await ensureFreshSubscriptionForServerKey(reg, publicKey);
    const ok = await postSubscriptionToServer(authUser, sub);
    return ok ? 'enabled' : status;
  } catch {
    return status;
  }
}

/**
 * Triggers a real high-priority W3C Web Push to wake up the callee's closed/locked device.
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
): Promise<void> {
  try {
    const token = await authUser.getIdToken();
    await fetch('/api/push/notify-call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
  } catch {
    // Non-blocking: Firestore signaling still delivers to foreground peers
  }
}

/**
 * Triggers a real W3C Web Push alert when sending a message to a peer whose app is closed.
 */
export async function triggerRemoteMessagePush(
  authUser: User,
  params: {
    recipientId: string;
    senderName: string;
    previewText: string;
  }
): Promise<void> {
  try {
    const token = await authUser.getIdToken();
    await fetch('/api/push/notify-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
  } catch {
    // Non-blocking
  }
}
