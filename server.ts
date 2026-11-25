import 'dotenv/config';
import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import * as webpush from 'web-push';
import type { PushSubscription as WebPushSubscription } from 'web-push';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase projectId & databaseId (verifyIdToken is stateless; Firestore REST uses user's own Bearer token)
const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
const firebaseAppletConfig = JSON.parse(
  fs.readFileSync(firebaseConfigPath, 'utf-8')
) as { projectId?: string; firestoreDatabaseId?: string };

const firebaseProjectId = firebaseAppletConfig.projectId || '';
const firebaseDatabaseId = firebaseAppletConfig.firestoreDatabaseId || '(default)';

const adminApp = getApps().length
  ? getApp()
  : initializeApp({ projectId: firebaseProjectId });
const adminAuth = getAuth(adminApp);

// --- Persistent VAPID Keys (W3C Web Push for Android Chrome, iOS 16.4+ PWA, Desktop) ---
const vapidStorePath = path.resolve(__dirname, '.zapei-vapid.json');

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function normalizeBase64Url(value: string): string {
  return value
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function deriveVapidPublicKey(privateKey: string): string | null {
  try {
    const normalized = normalizeBase64Url(privateKey);
    const keyBuf = Buffer.from(normalized, 'base64url');
    if (keyBuf.length !== 32) return null;
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(keyBuf);
    const derivedPublic = ecdh.getPublicKey().toString('base64url');
    return derivedPublic.length === 87 ? derivedPublic : null;
  } catch {
    return null;
  }
}

function isValidVapidKeyPair(publicKey: string, privateKey: string): boolean {
  const derivedPublic = deriveVapidPublicKey(privateKey);
  if (!derivedPublic) return false;
  return derivedPublic === normalizeBase64Url(publicKey);
}

function sanitizeVapidSubject(raw: string | undefined): string {
  const cleaned = (raw || '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (cleaned.startsWith('mailto:') || cleaned.startsWith('https://')) {
    return cleaned;
  }
  return 'mailto:contato@chatfi.app';
}

function loadOrCreateVapidKeys(): VapidKeys {
  const envPublic = normalizeBase64Url(process.env.VAPID_PUBLIC_KEY || '');
  const envPrivate = normalizeBase64Url(process.env.VAPID_PRIVATE_KEY || '');
  if (envPrivate) {
    const derivedPublic = deriveVapidPublicKey(envPrivate);
    if (derivedPublic) {
      if (envPublic && envPublic !== derivedPublic) {
        console.warn(
          '[push] VAPID_PUBLIC_KEY env var did not match VAPID_PRIVATE_KEY; auto-deriving the matching P-256 public key to prevent 403 rejections.'
        );
      }
      return {
        publicKey: derivedPublic,
        privateKey: envPrivate,
      };
    }
    console.warn(
      '[push] VAPID_PRIVATE_KEY env var is not a valid 32-byte P-256 key; falling back to local VAPID keypair.'
    );
  }
  if (fs.existsSync(vapidStorePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(vapidStorePath, 'utf-8')) as VapidKeys;
      if (saved.publicKey && saved.privateKey && isValidVapidKeyPair(saved.publicKey, saved.privateKey)) {
        return saved;
      }
    } catch {
      // regenerate below
    }
  }
  const generated = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidStorePath, JSON.stringify(generated, null, 2), { mode: 0o600 });
  return generated;
}

const vapidKeys = loadOrCreateVapidKeys();
const vapidPairValid = isValidVapidKeyPair(vapidKeys.publicKey, vapidKeys.privateKey);
const vapidKeyHash = crypto
  .createHash('sha256')
  .update(vapidKeys.publicKey.replace(/=+$/g, '').trim())
  .digest('hex')
  .slice(0, 16);
const vapidSubject = sanitizeVapidSubject(process.env.VAPID_SUBJECT);
webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);

// --- Persistent Per-User Push Subscription Store (Bound to Current VAPID Key Hash) ---
const subsStorePath = path.resolve(__dirname, '.zapei-push-subs.json');

type SubscriptionMap = Record<string, WebPushSubscription[]>;

interface PersistedSubStore {
  vapidKeyHash: string;
  byUid: SubscriptionMap;
  revokedHashes?: string[];
}

const revokedEndpointHashes = new Set<string>();

function hashEndpoint(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
}

function isEndpointRevoked(endpoint: string): boolean {
  return revokedEndpointHashes.has(hashEndpoint(endpoint));
}

function loadSubscriptions(): SubscriptionMap {
  if (!fs.existsSync(subsStorePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(subsStorePath, 'utf-8')) as
      | PersistedSubStore
      | SubscriptionMap;
    // Discard legacy untagged files or subscriptions bound to a different VAPID key to prevent 403 mismatch loops
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('vapidKeyHash' in parsed) ||
      parsed.vapidKeyHash !== vapidKeyHash ||
      !parsed.byUid ||
      typeof parsed.byUid !== 'object'
    ) {
      return {};
    }
    if (Array.isArray(parsed.revokedHashes)) {
      for (const h of parsed.revokedHashes.slice(-500)) {
        if (typeof h === 'string' && h.length > 0) revokedEndpointHashes.add(h);
      }
    }
    const clean: SubscriptionMap = {};
    for (const [uid, list] of Object.entries(parsed.byUid)) {
      if (!Array.isArray(list)) continue;
      const valid = list.filter((s) => isValidPushSubscription(s) && !isEndpointRevoked(s.endpoint));
      if (valid.length > 0) clean[uid] = valid;
    }
    return clean;
  } catch {
    return {};
  }
}

function saveSubscriptions(map: SubscriptionMap): void {
  const payload: PersistedSubStore = {
    vapidKeyHash,
    byUid: map,
    revokedHashes: Array.from(revokedEndpointHashes).slice(-500),
  };
  fs.writeFileSync(subsStorePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

const VALID_UID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidPushSubscription(sub: unknown): sub is WebPushSubscription {
  if (!sub || typeof sub !== 'object') return false;
  const candidate = sub as Partial<WebPushSubscription>;
  if (typeof candidate.endpoint !== 'string' || !candidate.endpoint.startsWith('https://')) {
    return false;
  }
  if (
    !candidate.keys ||
    typeof candidate.keys.p256dh !== 'string' ||
    typeof candidate.keys.auth !== 'string'
  ) {
    return false;
  }
  return candidate.endpoint.length <= 2000;
}

const subscriptionsByUid: SubscriptionMap = loadSubscriptions();

// --- AES-256-GCM Encryption + Firestore REST Persistence (Survives Render / Cloud Run Restarts) ---
const pushEncryptionKey = crypto.createHash('sha256').update(vapidKeys.privateKey).digest();

function encryptSubscriptions(subs: WebPushSubscription[]): {
  ciphertext: string;
  iv: string;
  authTag: string;
} {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', pushEncryptionKey, iv);
  const plaintext = JSON.stringify(subs);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptSubscriptions(blob: {
  ciphertext: string;
  iv: string;
  authTag: string;
}): WebPushSubscription[] {
  try {
    const iv = Buffer.from(blob.iv, 'base64');
    const authTag = Buffer.from(blob.authTag, 'base64');
    const ciphertext = Buffer.from(blob.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', pushEncryptionKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8'
    );
    const parsed = JSON.parse(decrypted);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPushSubscription);
  } catch {
    return [];
  }
}

function buildPushEndpointFirestoreUrl(uid: string): string | null {
  if (!firebaseProjectId || !VALID_UID_REGEX.test(uid)) return null;
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseProjectId
  )}/databases/${encodeURIComponent(
    firebaseDatabaseId
  )}/documents/push_endpoints/${encodeURIComponent(uid)}`;
}

async function persistSubscriptionsToFirestore(
  uid: string,
  subs: WebPushSubscription[],
  idToken: string
): Promise<void> {
  const url = buildPushEndpointFirestoreUrl(uid);
  if (!url || !idToken) return;
  try {
    if (subs.length === 0) {
      await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      return;
    }
    const enc = encryptSubscriptions(subs);
    if (enc.ciphertext.length > 32000) return;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        fields: {
          ownerId: { stringValue: uid },
          ciphertext: { stringValue: enc.ciphertext },
          iv: { stringValue: enc.iv },
          authTag: { stringValue: enc.authTag },
          deviceCount: { integerValue: String(subs.length) },
          updatedAtMs: { integerValue: String(Date.now()) },
        },
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[push] Firestore persist failed (${res.status}) for ${uid}:`, errBody.slice(0, 200));
    }
  } catch (err) {
    console.error('[push] Firestore persist error:', err instanceof Error ? err.message : err);
  }
}

async function fetchSubscriptionsFromFirestore(
  targetUid: string,
  bearerToken: string
): Promise<WebPushSubscription[]> {
  const url = buildPushEndpointFirestoreUrl(targetUid);
  if (!url || !bearerToken) return [];
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!res.ok) return [];
    const docData = (await res.json()) as {
      fields?: {
        ciphertext?: { stringValue?: string };
        iv?: { stringValue?: string };
        authTag?: { stringValue?: string };
      };
    };
    const ciphertext = docData.fields?.ciphertext?.stringValue || '';
    const iv = docData.fields?.iv?.stringValue || '';
    const authTag = docData.fields?.authTag?.stringValue || '';
    if (!ciphertext || !iv || !authTag) return [];
    return decryptSubscriptions({ ciphertext, iv, authTag });
  } catch {
    return [];
  }
}

// --- Authenticated Express Request Helper ---
interface AuthenticatedRequest extends Request {
  verifiedUid?: string;
  idToken?: string;
}

async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticação ausente.' });
    return;
  }
  const idToken = authHeader.slice(7).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    req.verifiedUid = decoded.uid;
    req.idToken = idToken;
    next();
  } catch (err) {
    console.error('[push] Auth token verify failed:', err instanceof Error ? err.message : err);
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

const firestoreHydratedAtByUid = new Map<string, number>();

function rememberRevokedEndpoint(endpoint: string): void {
  if (revokedEndpointHashes.size > 1000) {
    revokedEndpointHashes.clear();
  }
  revokedEndpointHashes.add(hashEndpoint(endpoint));
}

function mergeSubscriptions(
  localSubs: WebPushSubscription[],
  remoteSubs: WebPushSubscription[]
): WebPushSubscription[] {
  const byEndpoint = new Map<string, WebPushSubscription>();
  for (const s of remoteSubs) {
    if (!isEndpointRevoked(s.endpoint)) byEndpoint.set(s.endpoint, s);
  }
  for (const s of localSubs) {
    if (!isEndpointRevoked(s.endpoint)) byEndpoint.set(s.endpoint, s);
  }
  return Array.from(byEndpoint.values()).slice(-6);
}

async function dispatchPushToUser(
  targetUid: string,
  payload: Record<string, unknown>,
  options: {
    ttl: number;
    urgency: 'very-low' | 'low' | 'normal' | 'high';
    topic?: string;
    skipAppleEndpoints?: boolean;
  },
  callerIdToken?: string
): Promise<{ sent: number; removed: number }> {
  let subs = (subscriptionsByUid[targetUid] || []).filter((s) => !isEndpointRevoked(s.endpoint));
  const lastHydrated = firestoreHydratedAtByUid.get(targetUid) || 0;
  const shouldHydrate =
    Boolean(callerIdToken) && (subs.length === 0 || Date.now() - lastHydrated > 15_000);

  // Hydrate & merge from Firestore so newly registered phones are always reached across restarts/instances
  if (shouldHydrate && callerIdToken) {
    firestoreHydratedAtByUid.set(targetUid, Date.now());
    const restored = await fetchSubscriptionsFromFirestore(targetUid, callerIdToken);
    if (restored.length > 0) {
      const merged = mergeSubscriptions(subs, restored);
      if (merged.length !== subs.length) {
        subs = merged;
        subscriptionsByUid[targetUid] = subs;
        saveSubscriptions(subscriptionsByUid);
      }
    }
  }
  if (subs.length === 0) {
    console.log(`[push] No registered devices for uid=${targetUid} (type=${String(payload.type || '')})`);
    return { sent: 0, removed: 0 };
  }

  const jsonPayload = JSON.stringify(payload);
  let sent = 0;
  const validRemaining: WebPushSubscription[] = [];

  for (const sub of subs) {
    const isAppleEndpoint = sub.endpoint.includes('web.push.apple.com');
    // Apple WebKit revokes subscriptions after 3 silent pushes without showNotification (e.g. call_cancelled)
    if (options.skipAppleEndpoints && isAppleEndpoint) {
      validRemaining.push(sub);
      continue;
    }
    try {
      await webpush.sendNotification(sub, jsonPayload, {
        TTL: options.ttl,
        urgency: options.urgency,
        ...(options.topic ? { topic: options.topic } : {}),
      });
      sent += 1;
      validRemaining.push(sub);
    } catch (err) {
      const statusCode =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? Number((err as { statusCode?: unknown }).statusCode)
          : 0;
      const errBody =
        typeof err === 'object' && err !== null && 'body' in err && typeof (err as { body?: unknown }).body === 'string'
          ? (err as { body: string }).body.slice(0, 140).replace(/\s+/g, ' ')
          : '';
      const host = (() => {
        try {
          return new URL(sub.endpoint).host;
        } catch {
          return 'unknown';
        }
      })();

      // Prune permanently expired, revoked, or VAPID-key-mismatched endpoints (401 / 403 / 404 / 410)
      // Marking as revoked triggers silent automatic re-subscription on the device's next /api/push/subscribe sync.
      if (statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 410) {
        rememberRevokedEndpoint(sub.endpoint);
        console.warn(
          `[push] Pruned stale/mismatched subscription (${statusCode}) on ${host} for uid=${targetUid}${errBody ? `: ${errBody}` : ''}`
        );
      } else {
        console.error(
          `[push] Delivery failed (${statusCode || 'ERR'}) to ${host} for uid=${targetUid}:`,
          errBody || (err instanceof Error ? err.message : err)
        );
        validRemaining.push(sub);
      }
    }
  }

  const removed = subs.length - validRemaining.length;
  if (removed > 0) {
    subscriptionsByUid[targetUid] = validRemaining;
    saveSubscriptions(subscriptionsByUid);
  }
  console.log(
    `[push] Dispatched type=${String(payload.type || '')} uid=${targetUid} sent=${sent} removed=${removed}`
  );
  return { sent, removed };
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // 1. Public VAPID Key for browser PushManager.subscribe()
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  // 1b. Non-sensitive push service health check (helps verify Render backend & VAPID env setup)
  app.get('/api/push/health', (_req, res) => {
    const uids = Object.keys(subscriptionsByUid).filter(
      (u) => (subscriptionsByUid[u]?.length || 0) > 0
    );
    const totalDevices = uids.reduce((acc, u) => acc + (subscriptionsByUid[u]?.length || 0), 0);
    res.json({
      ok: true,
      hasEnvVapid: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      vapidPairValid,
      firestoreConfigured: Boolean(firebaseProjectId),
      cachedUsers: uids.length,
      cachedDevices: totalDevices,
    });
  });

  // 2. Register authenticated user's device PushSubscription (memory + disk + encrypted Firestore)
  app.post('/api/push/subscribe', requireFirebaseAuth, async (req: AuthenticatedRequest, res) => {
    const uid = req.verifiedUid!;
    const idToken = req.idToken || '';
    const sub = req.body?.subscription;
    if (!isValidPushSubscription(sub)) {
      res.status(400).json({ error: 'Inscrição Web Push inválida.' });
      return;
    }
    if (isEndpointRevoked(sub.endpoint)) {
      res.status(200).json({ ok: false, staleEndpoint: true });
      return;
    }

    let existing = subscriptionsByUid[uid] || [];
    if (idToken) {
      const remote = await fetchSubscriptionsFromFirestore(uid, idToken);
      if (remote.length > 0) {
        existing = mergeSubscriptions(existing, remote);
      }
    }
    const deduped = existing.filter(
      (item) => item.endpoint !== sub.endpoint && !isEndpointRevoked(item.endpoint)
    );
    deduped.push(sub);
    // Keep up to 6 devices per user
    const nextList = deduped.slice(-6);
    subscriptionsByUid[uid] = nextList;
    firestoreHydratedAtByUid.set(uid, Date.now());
    saveSubscriptions(subscriptionsByUid);
    await persistSubscriptionsToFirestore(uid, nextList, idToken);
    console.log(`[push] Subscribed uid=${uid} devices=${nextList.length}`);
    res.json({ ok: true, devices: nextList.length });
  });

  // 3. Remove device subscription
  app.post('/api/push/unsubscribe', requireFirebaseAuth, async (req: AuthenticatedRequest, res) => {
    const uid = req.verifiedUid!;
    const idToken = req.idToken || '';
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    let existing = subscriptionsByUid[uid] || [];
    if (existing.length === 0 && idToken) {
      existing = await fetchSubscriptionsFromFirestore(uid, idToken);
    }
    if (endpoint && existing.length > 0) {
      const nextList = existing.filter((item) => item.endpoint !== endpoint);
      subscriptionsByUid[uid] = nextList;
      saveSubscriptions(subscriptionsByUid);
      await persistSubscriptionsToFirestore(uid, nextList, idToken);
    }
    res.json({ ok: true });
  });

  // Active incoming call ring-cadence timers (pulses Web Push every 3.5s like a real ringing phone)
  const activeCallRingLoops = new Map<
    string,
    { timer: NodeJS.Timeout; callerId: string; calleeId: string }
  >();

  const stopCallRingLoop = (callId: string) => {
    const existing = activeCallRingLoops.get(callId);
    if (existing) {
      clearInterval(existing.timer);
      activeCallRingLoops.delete(callId);
    }
  };

  // 4. High-priority incoming call (repeated ring cadence) / cancellation Web Push
  app.post('/api/push/notify-call', requireFirebaseAuth, async (req: AuthenticatedRequest, res) => {
    const actorUid = req.verifiedUid!;
    const callerIdToken = req.idToken || '';
    const calleeId = typeof req.body?.calleeId === 'string' ? req.body.calleeId.slice(0, 128) : '';
    const callId = typeof req.body?.callId === 'string' ? req.body.callId.slice(0, 128) : '';
    const callerName =
      typeof req.body?.callerName === 'string' ? req.body.callerName.slice(0, 80) : 'Contato';
    const callType = req.body?.callType === 'video' ? 'video' : 'audio';
    const event = req.body?.event === 'cancelled' ? 'cancelled' : 'ringing';

    if (!callId) {
      res.status(400).json({ error: 'Parâmetros de chamada inválidos.' });
      return;
    }

    if (event === 'cancelled') {
      const activeLoop = activeCallRingLoops.get(callId);
      const targetUid = activeLoop?.calleeId || calleeId;
      // Only caller or callee may stop an active ring loop
      if (activeLoop && activeLoop.callerId !== actorUid && activeLoop.calleeId !== actorUid) {
        res.status(403).json({ error: 'Sem permissão para encerrar este toque.' });
        return;
      }
      stopCallRingLoop(callId);
      if (targetUid) {
        const result = await dispatchPushToUser(
          targetUid,
          { type: 'call_cancelled', callId },
          { ttl: 30, urgency: 'high', skipAppleEndpoints: true },
          callerIdToken
        );
        res.json({ ok: true, ...result });
        return;
      }
      res.json({ ok: true, sent: 0, removed: 0 });
      return;
    }

    if (!calleeId || calleeId === actorUid) {
      res.status(400).json({ error: 'Parâmetros de chamada inválidos.' });
      return;
    }

    // Stop any previous loop for the same callId
    stopCallRingLoop(callId);

    const sendRingPulse = async (ringIndex: number) =>
      dispatchPushToUser(
        calleeId,
        {
          type: 'incoming_call',
          callId,
          callerId: actorUid,
          callerName,
          callType,
          ringIndex,
        },
        {
          ttl: 45,
          urgency: 'high',
        },
        callerIdToken
      );

    // Pulse #1 immediately
    const firstResult = await sendRingPulse(1);

    // Repeat ringing pulses every 4.2 seconds (up to 7 pulses ~26s) so locked Android & iOS phones ring reliably without APNs throttling
    if (firstResult.sent > 0) {
      let pulseCount = 1;
      const timer = setInterval(() => {
        pulseCount += 1;
        if (pulseCount > 7) {
          stopCallRingLoop(callId);
          return;
        }
        void sendRingPulse(pulseCount).then((r) => {
          if (r.sent === 0) {
            stopCallRingLoop(callId);
          }
        });
      }, 4200);
      activeCallRingLoops.set(callId, { timer, callerId: actorUid, calleeId });
    }

    res.json({ ok: true, ...firstResult });
  });

  // 5. Real background chat message push alert (unique messageId so every message chimes & vibrates)
  app.post(
    '/api/push/notify-message',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res) => {
      const senderId = req.verifiedUid!;
      const callerIdToken = req.idToken || '';
      const recipientId =
        typeof req.body?.recipientId === 'string' ? req.body.recipientId.slice(0, 128) : '';
      const senderName =
        typeof req.body?.senderName === 'string' ? req.body.senderName.slice(0, 80) : 'ChatFi';
      const previewText =
        typeof req.body?.previewText === 'string'
          ? req.body.previewText.slice(0, 180)
          : 'Nova mensagem';
      const messageType =
        req.body?.messageType === 'audio' ||
        req.body?.messageType === 'image' ||
        req.body?.messageType === 'video'
          ? req.body.messageType
          : 'text';
      const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      if (!recipientId || recipientId === senderId) {
        res.status(400).json({ error: 'Destinatário inválido.' });
        return;
      }

      const result = await dispatchPushToUser(
        recipientId,
        {
          type: 'new_message',
          senderId,
          senderName,
          body: previewText,
          messageType,
          messageId,
        },
        { ttl: 3600, urgency: 'high' },
        callerIdToken
      );

      res.json({ ok: true, ...result });
    }
  );

  // Fallback for PWA Web Share Target if invoked before Service Worker intercepts POST /share-target
  app.all('/share-target', (_req: Request, res: Response) => {
    res.redirect(303, '/?shared=1');
  });

  const httpServer = http.createServer(app);

  // Mount Vite middleware in dev OR serve dist/ in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true as const,
        hmr: hmrDisabled ? false : true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const setNoCacheHeaders = (res: Response) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    };
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'manifest.webmanifest' ||
            base === 'manifest.json'
          ) {
            setNoCacheHeaders(res);
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      setNoCacheHeaders(res);
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`ChatFi server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
