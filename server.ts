import 'dotenv/config';
import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as webpush from 'web-push';
import type { PushSubscription as WebPushSubscription } from 'web-push';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  buildAsaasSplitEntries,
  calculateOrderSplit,
} from './src/lib/splitCalculator.ts';
import type {
  AsaasSplitEntry,
  OrderSplitBreakdown,
  SplitPaymentMethod,
} from './src/types/zapei.ts';

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

  // 6. Authenticated temporary media transit bridge fallback (up to 25 MB, 14-day TTL)
  const transitRootDir = path.join(os.tmpdir(), 'chatfi-transit');
  const VALID_CHAT_ID_REGEX = /^[a-zA-Z0-9_-]{3,260}$/;
  const VALID_MESSAGE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
  const MAX_TRANSIT_BYTES = 25 * 1024 * 1024;
  const TRANSIT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

  const resolveAuthorizedTransitFile = (
    chatId: string,
    messageId: string,
    uid: string
  ): { dataPath: string; metaPath: string } | null => {
    if (!VALID_CHAT_ID_REGEX.test(chatId) || !VALID_MESSAGE_ID_REGEX.test(messageId)) {
      return null;
    }
    const parts = chatId.split('__');
    if (parts.length !== 2 || (parts[0] !== uid && parts[1] !== uid)) {
      return null;
    }
    const safeDir = path.join(transitRootDir, chatId);
    return {
      dataPath: path.join(safeDir, `${messageId}.bin`),
      metaPath: path.join(safeDir, `${messageId}.json`),
    };
  };

  app.post(
    '/api/media/transit/:chatId/:messageId',
    requireFirebaseAuth,
    express.raw({ type: '*/*', limit: '26mb' }),
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.verifiedUid!;
      const { chatId = '', messageId = '' } = req.params;
      const paths = resolveAuthorizedTransitFile(chatId, messageId, uid);
      if (!paths) {
        res.status(403).json({ error: 'Acesso negado ao trânsito de mídia.' });
        return;
      }
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length === 0 || buf.length > MAX_TRANSIT_BYTES) {
        res.status(400).json({ error: 'Arquivo de mídia inválido ou maior que 25 MB.' });
        return;
      }
      const contentType =
        typeof req.headers['content-type'] === 'string' && req.headers['content-type'].trim()
          ? req.headers['content-type'].slice(0, 80)
          : 'application/octet-stream';
      try {
        await fs.promises.mkdir(path.dirname(paths.dataPath), { recursive: true });
        await fs.promises.writeFile(paths.dataPath, buf);
        await fs.promises.writeFile(
          paths.metaPath,
          JSON.stringify({
            mimeType: contentType,
            expiresAtMs: Date.now() + TRANSIT_TTL_MS,
            senderId: uid,
          })
        );
        res.json({
          ok: true,
          url: `/api/media/transit/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}`,
        });
      } catch (err) {
        console.error('[media-transit] Upload failed:', err);
        res.status(500).json({ error: 'Falha ao armazenar mídia em trânsito.' });
      }
    }
  );

  app.get(
    '/api/media/transit/:chatId/:messageId',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.verifiedUid!;
      const { chatId = '', messageId = '' } = req.params;
      const paths = resolveAuthorizedTransitFile(chatId, messageId, uid);
      if (!paths) {
        res.status(403).json({ error: 'Acesso negado ao trânsito de mídia.' });
        return;
      }
      try {
        const metaRaw = await fs.promises.readFile(paths.metaPath, 'utf-8');
        const meta = JSON.parse(metaRaw) as { mimeType?: string; expiresAtMs?: number };
        if (meta.expiresAtMs && Date.now() > meta.expiresAtMs) {
          await fs.promises.rm(paths.dataPath, { force: true }).catch(() => {});
          await fs.promises.rm(paths.metaPath, { force: true }).catch(() => {});
          res.status(404).json({ error: 'Mídia expirada.' });
          return;
        }
        const data = await fs.promises.readFile(paths.dataPath);
        res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(data);
      } catch {
        res.status(404).json({ error: 'Mídia não encontrada ou já entregue.' });
      }
    }
  );

  app.delete(
    '/api/media/transit/:chatId/:messageId',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.verifiedUid!;
      const { chatId = '', messageId = '' } = req.params;
      const paths = resolveAuthorizedTransitFile(chatId, messageId, uid);
      if (!paths) {
        res.status(403).json({ error: 'Acesso negado ao trânsito de mídia.' });
        return;
      }
      await fs.promises.rm(paths.dataPath, { force: true }).catch(() => {});
      await fs.promises.rm(paths.metaPath, { force: true }).catch(() => {});
      res.json({ ok: true });
    }
  );

  // 7. Asaas Payment Split Charge Creation & Webhook Confirmation
  const asaasLedgerPath = path.join(os.tmpdir(), 'chatfi-asaas-ledger.json');

  interface AsaasLedgerRecord {
    chargeId: string;
    orderId: string;
    orderCode: string;
    buyerId: string;
    resellerId: string;
    factoryIds: string[];
    mode: 'live' | 'preview';
    asaasStatus: string;
    mappedPaymentStatus: 'Aguardando' | 'Parcial' | 'Quitado' | 'Em Atraso';
    lastWebhookEvent?: string;
    invoiceUrl?: string;
    pixQrCode?: string;
    pixCopyPaste?: string;
    splitBreakdown: OrderSplitBreakdown;
    splitRecipients: AsaasSplitEntry[];
    createdAtMs: number;
    updatedAtMs: number;
    confirmedAtMs?: number;
  }

  interface PersistedAsaasLedger {
    chargesByOrderId: Record<string, AsaasLedgerRecord>;
    orderIdByChargeId: Record<string, string>;
    processedWebhookKeys: string[];
  }

  const loadAsaasLedger = (): PersistedAsaasLedger => {
    try {
      if (fs.existsSync(asaasLedgerPath)) {
        const parsed = JSON.parse(
          fs.readFileSync(asaasLedgerPath, 'utf-8')
        ) as Partial<PersistedAsaasLedger>;
        return {
          chargesByOrderId:
            parsed.chargesByOrderId && typeof parsed.chargesByOrderId === 'object'
              ? parsed.chargesByOrderId
              : {},
          orderIdByChargeId:
            parsed.orderIdByChargeId && typeof parsed.orderIdByChargeId === 'object'
              ? parsed.orderIdByChargeId
              : {},
          processedWebhookKeys: Array.isArray(parsed.processedWebhookKeys)
            ? parsed.processedWebhookKeys.slice(-1000)
            : [],
        };
      }
    } catch {
      // fallback to clean ledger
    }
    return { chargesByOrderId: {}, orderIdByChargeId: {}, processedWebhookKeys: [] };
  };

  const asaasLedger = loadAsaasLedger();

  const saveAsaasLedger = (): void => {
    try {
      asaasLedger.processedWebhookKeys = asaasLedger.processedWebhookKeys.slice(-1000);
      fs.writeFileSync(asaasLedgerPath, JSON.stringify(asaasLedger, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error('[asaas] Failed to persist ledger:', err);
    }
  };

  type FirestoreRestValue = {
    stringValue?: string;
    integerValue?: string;
    doubleValue?: number;
    booleanValue?: boolean;
    arrayValue?: { values?: FirestoreRestValue[] };
    mapValue?: { fields?: Record<string, FirestoreRestValue> };
  };

  const decodeFirestoreValue = (val: FirestoreRestValue | undefined): unknown => {
    if (!val || typeof val !== 'object') return undefined;
    if ('stringValue' in val) return val.stringValue ?? '';
    if ('booleanValue' in val) return Boolean(val.booleanValue);
    if ('doubleValue' in val) return Number(val.doubleValue ?? 0);
    if ('integerValue' in val) return Number(val.integerValue ?? 0);
    if ('arrayValue' in val) {
      return (val.arrayValue?.values || []).map((v) => decodeFirestoreValue(v));
    }
    if ('mapValue' in val) {
      const obj: Record<string, unknown> = {};
      const fields = val.mapValue?.fields || {};
      for (const [k, v] of Object.entries(fields)) {
        obj[k] = decodeFirestoreValue(v);
      }
      return obj;
    }
    return undefined;
  };

  const decodeFirestoreFields = (
    fields: Record<string, FirestoreRestValue> | undefined
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!fields) return out;
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  };

  const firestoreRestGetDoc = async (
    collectionPath: string,
    docId: string,
    idToken: string
  ): Promise<Record<string, unknown> | null> => {
    if (!firebaseProjectId || !VALID_UID_REGEX.test(docId)) return null;
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseProjectId
    )}/databases/${encodeURIComponent(
      firebaseDatabaseId
    )}/documents/${collectionPath}/${encodeURIComponent(docId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      fields?: Record<string, FirestoreRestValue>;
    };
    return decodeFirestoreFields(json.fields);
  };

  const firestoreRestQuerySubOrdersForActor = async (
    parentOrderId: string,
    actorField: 'buyerId' | 'resellerId',
    actorUid: string,
    idToken: string
  ): Promise<
    Array<{
      id: string;
      subOrderCode: string;
      factoryId: string;
      factoryName: string;
      factoryCost: number;
    }>
  > => {
    if (!firebaseProjectId) return [];
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseProjectId
    )}/databases/${encodeURIComponent(firebaseDatabaseId)}/documents:runQuery`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'sub_orders' }],
          where: {
            fieldFilter: {
              field: { fieldPath: actorField },
              op: 'EQUAL',
              value: { stringValue: actorUid },
            },
          },
          limit: 200,
        },
      }),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      document?: {
        name?: string;
        fields?: Record<string, FirestoreRestValue>;
      };
    }>;
    const out: Array<{
      id: string;
      subOrderCode: string;
      factoryId: string;
      factoryName: string;
      factoryCost: number;
    }> = [];
    for (const row of rows) {
      if (!row.document?.fields || !row.document.name) continue;
      const d = decodeFirestoreFields(row.document.fields);
      if (String(d.parentOrderId || '') !== parentOrderId) continue;
      const docId = row.document.name.split('/').pop() || '';
      out.push({
        id: docId,
        subOrderCode: String(d.subOrderCode || ''),
        factoryId: String(d.factoryId || ''),
        factoryName: String(d.factoryName || 'Fábrica'),
        factoryCost: Number(d.factoryCost || 0),
      });
    }
    return out;
  };

  const getAsaasBaseUrl = (): string => {
    const custom = (process.env.ASAAS_BASE_URL || '').trim().replace(/\/+$/g, '');
    if (custom.startsWith('https://')) return custom;
    const env = (process.env.ASAAS_ENV || 'sandbox').trim().toLowerCase();
    return env === 'production'
      ? 'https://api.asaas.com/v3'
      : 'https://api-sandbox.asaas.com/v3';
  };

  const mapAsaasEventToStatus = (
    event: string
  ): 'Aguardando' | 'Parcial' | 'Quitado' | 'Em Atraso' => {
    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_ANTICIPATED':
      case 'CONFIRMED':
      case 'RECEIVED':
      case 'RECEIVED_IN_CASH':
        return 'Quitado';
      case 'PAYMENT_OVERDUE':
      case 'OVERDUE':
        return 'Em Atraso';
      case 'PAYMENT_PARTIALLY_REFUNDED':
      case 'PARTIALLY_REFUNDED':
        return 'Parcial';
      default:
        return 'Aguardando';
    }
  };

  app.post(
    '/api/payments/asaas/create-charge',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const idToken = req.idToken || '';

      const orderId =
        typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : '';
      const paymentMethod: SplitPaymentMethod =
        req.body?.paymentMethod === 'credit_card' ? 'credit_card' : 'pix';
      const rawInstallments = Number(req.body?.installments ?? 1);
      const installments =
        paymentMethod === 'credit_card'
          ? Math.min(12, Math.max(1, Math.round(Number.isFinite(rawInstallments) ? rawInstallments : 1)))
          : 1;

      if (!VALID_UID_REGEX.test(orderId)) {
        res.status(400).json({ error: 'ID do pedido inválido.' });
        return;
      }

      const orderData = await firestoreRestGetDoc('orders', orderId, idToken);
      if (!orderData) {
        res.status(404).json({ error: 'Pedido não encontrado no Firestore.' });
        return;
      }

      const buyerId = String(orderData.buyerId || '');
      const resellerId = String(orderData.resellerId || '');
      const factoryIds = Array.isArray(orderData.factoryIds)
        ? orderData.factoryIds.map((id) => String(id))
        : [];

      if (actorUid !== buyerId && actorUid !== resellerId) {
        res.status(403).json({ error: 'Sem permissão para gerar cobrança deste pedido.' });
        return;
      }

      const orderTotal = Number(orderData.buyerFinalTotal ?? orderData.buyerSubtotal ?? 0);
      const factoryCostTotal = Number(orderData.factoryCostTotal ?? 0);
      if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
        res.status(400).json({ error: 'Valor do pedido inválido para cobrança.' });
        return;
      }

      const actorRoleField = actorUid === buyerId ? 'buyerId' : 'resellerId';
      let subOrders = await firestoreRestQuerySubOrdersForActor(
        orderId,
        actorRoleField,
        actorUid,
        idToken
      );

      if (subOrders.length === 0 && factoryIds.length > 0) {
        subOrders = [
          {
            id: `sub_${orderId}_0`,
            subOrderCode: `${String(orderData.orderCode || '')}-A`,
            factoryId: factoryIds[0],
            factoryName: 'Fábrica',
            factoryCost: factoryCostTotal,
          },
        ];
      }

      const isDirectManufacturerSale =
        factoryIds.length === 1 &&
        factoryIds[0] === resellerId &&
        Math.abs(orderTotal - factoryCostTotal) < 0.01;

      const splitBreakdown = calculateOrderSplit({
        orderTotal,
        factoryCostTotal,
        paymentMethod,
        installments,
        isDirectManufacturerSale,
        subOrders,
      });

      // Fetch Asaas Wallet IDs from user profiles
      const distinctFactoryIds = Array.from(
        new Set(subOrders.map((s) => s.factoryId).filter((id) => VALID_UID_REGEX.test(id)))
      );
      const [resellerDoc, ...factoryDocs] = await Promise.all([
        VALID_UID_REGEX.test(resellerId)
          ? firestoreRestGetDoc('users', resellerId, idToken)
          : Promise.resolve(null),
        ...distinctFactoryIds.map((fid) => firestoreRestGetDoc('users', fid, idToken)),
      ]);

      const factoryWalletMap: Record<string, string | undefined> = {};
      distinctFactoryIds.forEach((fid, idx) => {
        const docData = factoryDocs[idx];
        factoryWalletMap[fid] = docData?.asaasWalletId
          ? String(docData.asaasWalletId).trim()
          : undefined;
      });

      const resellerWalletId = resellerDoc?.asaasWalletId
        ? String(resellerDoc.asaasWalletId).trim()
        : undefined;
      const resellerName = String(
        orderData.storefrontName || resellerDoc?.storefrontName || resellerDoc?.displayName || 'Revendedor'
      );

      const { asaasApiSplits, detailedSplits, missingWallets } = buildAsaasSplitEntries({
        breakdown: splitBreakdown,
        resellerId,
        resellerName,
        resellerWalletId,
        factoryWalletMap,
        platformWalletId: process.env.ASAAS_PLATFORM_WALLET_ID,
        includePlatformWalletInSplitArray:
          process.env.ASAAS_INCLUDE_PLATFORM_WALLET_IN_SPLIT === 'true',
      });

      const due = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const dueDate = due.toISOString().slice(0, 10);
      const orderCode = String(orderData.orderCode || orderId);
      const asaasApiKey = (process.env.ASAAS_API_KEY || '').trim();

      const baseAsaasPayload = {
        billingType: (paymentMethod === 'credit_card' ? 'CREDIT_CARD' : 'PIX') as
          | 'PIX'
          | 'CREDIT_CARD',
        value: splitBreakdown.buyerChargedTotal,
        dueDate,
        description: `Pedido ChatFi ${orderCode}`,
        externalReference: orderId,
        ...(paymentMethod === 'credit_card' && splitBreakdown.installments > 1
          ? {
              installmentCount: splitBreakdown.installments,
              totalValue: splitBreakdown.buyerChargedTotal,
            }
          : {}),
        split: asaasApiSplits,
      };

      if (!asaasApiKey) {
        const previewChargeId = `asaas_preview_${orderId}`;
        const record: AsaasLedgerRecord = {
          chargeId: previewChargeId,
          orderId,
          orderCode,
          buyerId,
          resellerId,
          factoryIds,
          mode: 'preview',
          asaasStatus: 'PENDING_GATEWAY_KEY',
          mappedPaymentStatus: 'Aguardando',
          splitBreakdown,
          splitRecipients: detailedSplits,
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
        asaasLedger.chargesByOrderId[orderId] = record;
        asaasLedger.orderIdByChargeId[previewChargeId] = orderId;
        saveAsaasLedger();

        res.json({
          ok: true,
          mode: 'preview',
          asaasConfigured: false,
          chargeId: previewChargeId,
          status: 'PENDING_GATEWAY_KEY',
          mappedPaymentStatus: 'Aguardando',
          missingWallets,
          message:
            'Split calculado e payload Asaas pronto. Adicione ASAAS_API_KEY nas variáveis do servidor para emitir cobranças reais no Asaas.',
          splitBreakdown,
          splitRecipients: detailedSplits,
          asaasPayload: baseAsaasPayload,
        });
        return;
      }

      if (missingWallets.length > 0) {
        res.status(422).json({
          error: `Wallet ID Asaas não configurado para: ${missingWallets
            .map((w) => `${w.label} (${w.role === 'manufacturer' ? 'Fabricante' : 'Revendedor'})`)
            .join(', ')}. Peça para configurarem no painel comercial.`,
          missingWallets,
        });
        return;
      }

      const asaasBaseUrl = getAsaasBaseUrl();
      const customerInfo =
        req.body?.customerInfo && typeof req.body.customerInfo === 'object'
          ? (req.body.customerInfo as Record<string, unknown>)
          : {};
      const customerName = String(
        customerInfo.name || orderData.buyerName || 'Cliente ChatFi'
      ).slice(0, 80);
      const customerCpfCnpj = String(customerInfo.cpfCnpj || '').replace(/\D/g, '').slice(0, 14);
      const customerEmail = String(customerInfo.email || '').trim().slice(0, 120);
      const customerPhone = String(customerInfo.phone || '').replace(/\D/g, '').slice(0, 15);

      try {
        let asaasCustomerId = '';
        if (customerCpfCnpj) {
          const findRes = await fetch(
            `${asaasBaseUrl}/customers?cpfCnpj=${encodeURIComponent(customerCpfCnpj)}`,
            {
              headers: {
                access_token: asaasApiKey,
                'User-Agent': 'ChatFi/1.0',
              },
            }
          );
          if (findRes.ok) {
            const found = (await findRes.json()) as { data?: Array<{ id?: string }> };
            asaasCustomerId = String(found.data?.[0]?.id || '');
          }
        }
        if (!asaasCustomerId) {
          const createCustRes = await fetch(`${asaasBaseUrl}/customers`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              access_token: asaasApiKey,
              'User-Agent': 'ChatFi/1.0',
            },
            body: JSON.stringify({
              name: customerName,
              ...(customerCpfCnpj ? { cpfCnpj: customerCpfCnpj } : {}),
              ...(customerEmail ? { email: customerEmail } : {}),
              ...(customerPhone ? { mobilePhone: customerPhone } : {}),
              externalReference: buyerId,
            }),
          });
          const custJson = (await createCustRes.json().catch(() => ({}))) as {
            id?: string;
            errors?: Array<{ description?: string }>;
          };
          if (!createCustRes.ok || !custJson.id) {
            res.status(400).json({
              error:
                custJson.errors?.[0]?.description ||
                'Não foi possível criar/localizar o cliente no Asaas (informe CPF/CNPJ válido).',
            });
            return;
          }
          asaasCustomerId = custJson.id;
        }

        const chargeRes = await fetch(`${asaasBaseUrl}/payments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            access_token: asaasApiKey,
            'User-Agent': 'ChatFi/1.0',
          },
          body: JSON.stringify({
            customer: asaasCustomerId,
            ...baseAsaasPayload,
          }),
        });

        const chargeJson = (await chargeRes.json().catch(() => ({}))) as {
          id?: string;
          status?: string;
          invoiceUrl?: string;
          errors?: Array<{ description?: string }>;
        };
        if (!chargeRes.ok || !chargeJson.id) {
          res.status(chargeRes.status || 400).json({
            error:
              chargeJson.errors?.[0]?.description ||
              'Erro ao gerar cobrança com Split no Asaas.',
          });
          return;
        }

        let pixQrCode = '';
        let pixCopyPaste = '';
        if (paymentMethod === 'pix') {
          const pixRes = await fetch(`${asaasBaseUrl}/payments/${encodeURIComponent(chargeJson.id)}/pixQrCode`, {
            headers: {
              access_token: asaasApiKey,
              'User-Agent': 'ChatFi/1.0',
            },
          });
          if (pixRes.ok) {
            const pixData = (await pixRes.json().catch(() => ({}))) as {
              encodedImage?: string;
              payload?: string;
            };
            pixQrCode = pixData.encodedImage
              ? `data:image/png;base64,${pixData.encodedImage}`
              : '';
            pixCopyPaste = String(pixData.payload || '');
          }
        }

        const record: AsaasLedgerRecord = {
          chargeId: chargeJson.id,
          orderId,
          orderCode,
          buyerId,
          resellerId,
          factoryIds,
          mode: 'live',
          asaasStatus: String(chargeJson.status || 'PENDING'),
          mappedPaymentStatus: 'Aguardando',
          invoiceUrl: chargeJson.invoiceUrl ? String(chargeJson.invoiceUrl) : undefined,
          pixQrCode: pixQrCode || undefined,
          pixCopyPaste: pixCopyPaste || undefined,
          splitBreakdown,
          splitRecipients: detailedSplits,
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
        asaasLedger.chargesByOrderId[orderId] = record;
        asaasLedger.orderIdByChargeId[chargeJson.id] = orderId;
        saveAsaasLedger();

        res.json({
          ok: true,
          mode: 'live',
          asaasConfigured: true,
          chargeId: chargeJson.id,
          status: record.asaasStatus,
          mappedPaymentStatus: 'Aguardando',
          invoiceUrl: record.invoiceUrl,
          pixQrCode: record.pixQrCode,
          pixCopyPaste: record.pixCopyPaste,
          splitBreakdown,
          splitRecipients: detailedSplits,
          asaasPayload: baseAsaasPayload,
        });
      } catch (err) {
        console.error('[asaas] Create charge error:', err);
        res.status(502).json({ error: 'Falha de comunicação com a API do Asaas.' });
      }
    }
  );

  app.post('/api/webhooks/asaas', async (req: Request, res: Response) => {
    const expectedToken = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
    if (!expectedToken) {
      res.status(503).json({
        error: 'Webhook Asaas indisponível: ASAAS_WEBHOOK_TOKEN não configurado no servidor.',
      });
      return;
    }

    const receivedToken =
      typeof req.headers['asaas-access-token'] === 'string'
        ? req.headers['asaas-access-token'].trim()
        : '';

    const expectedBuf = Buffer.from(expectedToken, 'utf8');
    const receivedBuf = Buffer.from(receivedToken, 'utf8');
    if (
      expectedBuf.length !== receivedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      res.status(401).json({ error: 'Token de webhook Asaas inválido.' });
      return;
    }

    const event = typeof req.body?.event === 'string' ? req.body.event.trim().slice(0, 60) : '';
    const payment =
      req.body?.payment && typeof req.body.payment === 'object'
        ? (req.body.payment as Record<string, unknown>)
        : null;

    if (!event || !payment || typeof payment.id !== 'string') {
      res.status(400).json({ error: 'Payload de webhook Asaas inválido.' });
      return;
    }

    const chargeId = String(payment.id).slice(0, 128);
    const externalReference =
      typeof payment.externalReference === 'string'
        ? payment.externalReference.trim().slice(0, 128)
        : '';
    const dedupKey = `${event}:${chargeId}`;
    if (asaasLedger.processedWebhookKeys.includes(dedupKey)) {
      res.json({ received: true, deduplicated: true, chargeId, event });
      return;
    }

    asaasLedger.processedWebhookKeys.push(dedupKey);
    const orderId = asaasLedger.orderIdByChargeId[chargeId] || externalReference;
    const mappedPaymentStatus = mapAsaasEventToStatus(event);
    const existingRecord = orderId ? asaasLedger.chargesByOrderId[orderId] : undefined;

    if (existingRecord) {
      existingRecord.asaasStatus = String(payment.status || event).slice(0, 40);
      existingRecord.mappedPaymentStatus = mappedPaymentStatus;
      existingRecord.lastWebhookEvent = event;
      existingRecord.updatedAtMs = Date.now();
      if (mappedPaymentStatus === 'Quitado') {
        existingRecord.confirmedAtMs = Date.now();
      }
      saveAsaasLedger();

      if (mappedPaymentStatus === 'Quitado') {
        const recipients = Array.from(
          new Set([existingRecord.resellerId, ...existingRecord.factoryIds])
        ).filter(Boolean);
        for (const uid of recipients) {
          void dispatchPushToUser(
            uid,
            {
              type: 'new_message',
              senderId: 'chatfi-asaas',
              senderName: 'Pagamentos ChatFi',
              body: `Pagamento confirmado (${existingRecord.orderCode})! Split liberado via Asaas.`,
              messageType: 'text',
              messageId: `asaas-${chargeId}-${Date.now()}`,
            },
            { ttl: 3600, urgency: 'high' }
          ).catch(() => {});
        }
      }
    } else {
      saveAsaasLedger();
    }

    console.log(
      `[asaas-webhook] event=${event} chargeId=${chargeId} orderId=${orderId || 'unknown'} status=${mappedPaymentStatus}`
    );

    res.json({
      received: true,
      chargeId,
      orderId: orderId || null,
      event,
      mappedPaymentStatus,
    });
  });

  app.get(
    '/api/payments/asaas/status/:orderId',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const idToken = req.idToken || '';
      const orderId = typeof req.params?.orderId === 'string' ? req.params.orderId.trim() : '';

      if (!VALID_UID_REGEX.test(orderId)) {
        res.status(400).json({ error: 'ID do pedido inválido.' });
        return;
      }

      const record = asaasLedger.chargesByOrderId[orderId];
      if (!record) {
        const orderDoc = await firestoreRestGetDoc('orders', orderId, idToken);
        if (!orderDoc) {
          res.status(404).json({ error: 'Pedido não encontrado.' });
          return;
        }
        const factoryIds = Array.isArray(orderDoc.factoryIds)
          ? orderDoc.factoryIds.map((x) => String(x))
          : [];
        if (
          orderDoc.buyerId !== actorUid &&
          orderDoc.resellerId !== actorUid &&
          !factoryIds.includes(actorUid)
        ) {
          res.status(403).json({ error: 'Sem permissão para consultar este pedido.' });
          return;
        }
        res.json({ ok: true, found: false, orderId });
        return;
      }

      if (
        record.buyerId !== actorUid &&
        record.resellerId !== actorUid &&
        !record.factoryIds.includes(actorUid)
      ) {
        res.status(403).json({ error: 'Sem permissão para consultar esta cobrança.' });
        return;
      }

      const asaasApiKey = (process.env.ASAAS_API_KEY || '').trim();
      if (
        asaasApiKey &&
        record.mode === 'live' &&
        record.chargeId &&
        !record.chargeId.startsWith('asaas_preview_')
      ) {
        try {
          const liveRes = await fetch(
            `${getAsaasBaseUrl()}/payments/${encodeURIComponent(record.chargeId)}`,
            {
              headers: {
                access_token: asaasApiKey,
              },
            }
          );
          if (liveRes.ok) {
            const liveJson = (await liveRes.json()) as {
              status?: string;
              invoiceUrl?: string;
              bankSlipUrl?: string;
            };
            if (liveJson.status) {
              record.asaasStatus = liveJson.status;
              record.mappedPaymentStatus = mapAsaasEventToStatus(liveJson.status);
              record.updatedAtMs = Date.now();
              if (record.mappedPaymentStatus === 'Quitado' && !record.confirmedAtMs) {
                record.confirmedAtMs = Date.now();
              }
            }
            if (liveJson.invoiceUrl || liveJson.bankSlipUrl) {
              record.invoiceUrl = liveJson.invoiceUrl || liveJson.bankSlipUrl;
            }
            saveAsaasLedger();
          }
        } catch (err) {
          console.warn('[asaas-status] Live poll fallback to cached ledger:', err);
        }
      }

      res.json({
        ok: true,
        found: true,
        orderId,
        chargeId: record.chargeId,
        asaasStatus: record.asaasStatus,
        mappedPaymentStatus: record.mappedPaymentStatus,
        invoiceUrl: record.invoiceUrl,
        pixCopyPaste: record.pixCopyPaste,
        pixQrCode: record.pixQrCode,
        splitBreakdown: record.splitBreakdown,
        splitRecipients: record.splitRecipients,
        lastWebhookEvent: record.lastWebhookEvent,
        confirmedAtMs: record.confirmedAtMs,
      });
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
