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
import { WebSocket, WebSocketServer } from 'ws';
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
  return 'mailto:suporte.chatfi@gmail.com';
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

// --- Push Notification Sender Avatar Cache (Serves real profile photo URL for Web Push icon) ---
interface CachedPushAvatar {
  buffer: Buffer;
  contentType: string;
  hash: string;
  fetchedAtMs: number;
}

const pushAvatarCache = new Map<string, CachedPushAvatar>();
const pushAvatarDir = path.join(os.tmpdir(), 'chatfi-push-avatars');

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInitialsAvatarSvg(name: string, bgColor?: string): Buffer {
  const parts = (name || 'U')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials =
    parts.length >= 2
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : (parts[0] || 'U').slice(0, 2).toUpperCase();
  const safeColor =
    typeof bgColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(bgColor.trim())
      ? bgColor.trim()
      : '#0E7A34';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" rx="96" fill="${safeColor}"/><text x="96" y="114" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="72" font-weight="700" fill="#ffffff">${escapeSvgText(initials)}</text></svg>`;
  return Buffer.from(svg, 'utf-8');
}

function parseAvatarDataUrl(
  dataUrl: string
): { buffer: Buffer; contentType: string } | null {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const rawMime = match[1].toLowerCase();
  const contentType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
  try {
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (buffer.length === 0 || buffer.length > 512 * 1024) return null;
    return { buffer, contentType };
  } catch {
    return null;
  }
}

function persistPushAvatarEntry(uid: string, entry: CachedPushAvatar): void {
  if (pushAvatarCache.size > 300) {
    const firstKey = pushAvatarCache.keys().next().value;
    if (firstKey) pushAvatarCache.delete(firstKey);
  }
  pushAvatarCache.set(uid, entry);
  try {
    fs.mkdirSync(pushAvatarDir, { recursive: true });
    fs.writeFileSync(path.join(pushAvatarDir, `${uid}.bin`), entry.buffer);
    fs.writeFileSync(
      path.join(pushAvatarDir, `${uid}.json`),
      JSON.stringify({ contentType: entry.contentType, hash: entry.hash }),
      'utf-8'
    );
  } catch {
    // Non-fatal disk cache failure
  }
}

function loadPushAvatarEntryFromDisk(uid: string): CachedPushAvatar | null {
  if (!VALID_UID_REGEX.test(uid)) return null;
  try {
    const binPath = path.join(pushAvatarDir, `${uid}.bin`);
    const metaPath = path.join(pushAvatarDir, `${uid}.json`);
    if (!fs.existsSync(binPath) || !fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
      contentType?: string;
      hash?: string;
    };
    const buffer = fs.readFileSync(binPath);
    if (!buffer.length || !meta.contentType) return null;
    return {
      buffer,
      contentType: meta.contentType,
      hash: meta.hash || 'cached',
      fetchedAtMs: Date.now(),
    };
  } catch {
    return null;
  }
}

async function resolveSenderAvatarForPush(
  uid: string,
  bearerToken: string,
  fallbackName: string
): Promise<string | undefined> {
  if (!VALID_UID_REGEX.test(uid)) return undefined;
  const existing = pushAvatarCache.get(uid);
  if (existing && Date.now() - existing.fetchedAtMs < 30_000) {
    return `/api/push/avatar/${encodeURIComponent(uid)}?v=${existing.hash}`;
  }

  let avatarUrl = '';
  let avatarColor = '#0E7A34';
  let displayName = fallbackName;

  if (firebaseProjectId && bearerToken) {
    const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseProjectId
    )}/databases/${encodeURIComponent(
      firebaseDatabaseId
    )}/documents/users_public/${encodeURIComponent(uid)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
      const res = await fetch(docUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const docData = (await res.json()) as {
          fields?: {
            avatarUrl?: { stringValue?: string };
            avatarColor?: { stringValue?: string };
            displayName?: { stringValue?: string };
          };
        };
        avatarUrl = (docData.fields?.avatarUrl?.stringValue || '').trim();
        if (docData.fields?.avatarColor?.stringValue) {
          avatarColor = docData.fields.avatarColor.stringValue;
        }
        if (docData.fields?.displayName?.stringValue) {
          displayName = docData.fields.displayName.stringValue;
        }
      }
    } catch {
      // Ignore network/timeout errors and fall back to initials avatar
    } finally {
      clearTimeout(timer);
    }
  }

  if (avatarUrl.startsWith('https://') && avatarUrl.length <= 1000) {
    return avatarUrl;
  }

  const parsed = avatarUrl ? parseAvatarDataUrl(avatarUrl) : null;
  const buffer = parsed ? parsed.buffer : buildInitialsAvatarSvg(displayName, avatarColor);
  const contentType = parsed ? parsed.contentType : 'image/svg+xml';
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 10);

  persistPushAvatarEntry(uid, {
    buffer,
    contentType,
    hash,
    fetchedAtMs: Date.now(),
  });
  return `/api/push/avatar/${encodeURIComponent(uid)}?v=${hash}`;
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // 1. Public VAPID Key for browser PushManager.subscribe()
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  // 1a. Cached sender avatar image for Web Push notification icon (never falls back to ChatFi logo)
  app.get('/api/push/avatar/:uid', (req, res) => {
    const uid = typeof req.params.uid === 'string' ? req.params.uid : '';
    if (!VALID_UID_REGEX.test(uid)) {
      res.status(400).end();
      return;
    }
    let entry = pushAvatarCache.get(uid) || loadPushAvatarEntryFromDisk(uid);
    if (entry) {
      pushAvatarCache.set(uid, entry);
      res.setHeader('Content-Type', entry.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(entry.buffer);
      return;
    }
    const fallbackSvg = buildInitialsAvatarSvg('?', '#0E7A34');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(fallbackSvg);
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

  // Per-user Chat Organization Preferences (pin, archive, mute, favorites, lists, lock PIN, clear, block, shortcuts)
  const chatPrefsStorePath = path.join(os.tmpdir(), 'chatfi-chat-prefs.json');
  interface ChatCustomListServer {
    id: string;
    name: string;
    chatIds: string[];
    createdAtMs: number;
  }
  interface ServerUserChatPreferences {
    pinnedChatIds: string[];
    archivedChatIds: string[];
    mutedChatIds: string[];
    favoriteChatIds: string[];
    unreadChatIds: string[];
    lockedChatIds: string[];
    lockPinHash?: string;
    clearedAtByChatId: Record<string, number>;
    hiddenChatIds: Record<string, number>;
    blockedUids: string[];
    blockedAtByUid: Record<string, number>;
    customLists: ChatCustomListServer[];
    shortcutChatIds: string[];
    updatedAtMs: number;
  }
  const loadChatPrefsStore = (): Record<string, ServerUserChatPreferences> => {
    try {
      if (fs.existsSync(chatPrefsStorePath)) {
        const raw = JSON.parse(fs.readFileSync(chatPrefsStorePath, 'utf-8')) as unknown;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          return raw as Record<string, ServerUserChatPreferences>;
        }
      }
    } catch {
      // ignore corrupted store
    }
    return {};
  };
  const chatPrefsStore = loadChatPrefsStore();
  const saveChatPrefsStore = (): void => {
    try {
      fs.writeFileSync(chatPrefsStorePath, JSON.stringify(chatPrefsStore), { mode: 0o600 });
    } catch {
      // ignore disk write error
    }
  };
  const isBlockedByPeer = (recipientUid: string, senderUid: string): boolean => {
    if (!recipientUid || !senderUid) return false;
    const prefs = chatPrefsStore[recipientUid];
    return Array.isArray(prefs?.blockedUids) && prefs.blockedUids.includes(senderUid);
  };
  const shouldHidePresenceBetween = (viewerUid: string, targetUid: string): boolean =>
    isBlockedByPeer(targetUid, viewerUid) || isBlockedByPeer(viewerUid, targetUid);

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

    // Stealth block: if callee blocked caller, silently drop call ring push without revealing block
    if (isBlockedByPeer(calleeId, actorUid)) {
      res.json({ ok: true, sent: 0, removed: 0 });
      return;
    }

    // Stop any previous loop for the same callId
    stopCallRingLoop(callId);

    const callerAvatarUrl = await resolveSenderAvatarForPush(actorUid, callerIdToken, callerName);

    const sendRingPulse = async (ringIndex: number) =>
      dispatchPushToUser(
        calleeId,
        {
          type: 'incoming_call',
          callId,
          callerId: actorUid,
          callerName,
          callerAvatarUrl,
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

  // Active foreground chat tracking (uid -> currently viewed peerId) so we don't send OS push alerts
  // while the user is already actively chatting with that exact person on screen.
  const activeChatByUid = new Map<string, { peerId: string; updatedAt: number }>();
  const ACTIVE_CHAT_TTL_MS = 30_000;

  app.post(
    '/api/push/active-chat',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const uid = req.verifiedUid!;
      const rawPeerId = typeof req.body?.peerId === 'string' ? req.body.peerId.trim().slice(0, 128) : '';
      if (rawPeerId) {
        activeChatByUid.set(uid, { peerId: rawPeerId, updatedAt: Date.now() });
      } else {
        activeChatByUid.delete(uid);
      }
      res.json({ ok: true });
    }
  );

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

      // Stealth block: never send push notification if recipient blocked sender
      if (isBlockedByPeer(recipientId, senderId)) {
        res.json({ ok: true, sent: 0, removed: 0 });
        return;
      }

      // Suppress Web Push completely when recipient currently has this exact conversation open & visible
      const activeChat = activeChatByUid.get(recipientId);
      if (activeChat) {
        const ageMs = Date.now() - activeChat.updatedAt;
        if (ageMs > ACTIVE_CHAT_TTL_MS) {
          activeChatByUid.delete(recipientId);
        } else if (activeChat.peerId === senderId) {
          res.json({ ok: true, sent: 0, removed: 0, skipped: 'active_chat_open' });
          return;
        }
      }

      const senderAvatarUrl = await resolveSenderAvatarForPush(
        senderId,
        callerIdToken,
        senderName
      );

      const result = await dispatchPushToUser(
        recipientId,
        {
          type: 'new_message',
          senderId,
          senderName,
          senderAvatarUrl,
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

  // 5b. Real-Time In-Memory Presence & WhatsApp-Style Ephemeral Message Relay (Zero Firestore Quota!)
  interface ServerPresenceRecord {
    uid: string;
    isOnline: boolean;
    lastSeenAt: number;
    showOnlineStatus: boolean;
    showLastSeen: boolean;
  }

  interface RelayedChatEnvelope {
    id: string;
    chatId: string;
    userA: string;
    userB: string;
    senderId: string;
    senderName: string;
    recipientId: string;
    recipientName: string;
    type: 'text' | 'audio' | 'image' | 'video' | 'order_card' | 'billing_reminder';
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

  interface DeliveryReceiptBatch {
    chatId: string;
    messageIds: string[];
    deliveredAtMs: number;
  }

  const presenceByUid = new Map<string, ServerPresenceRecord>();
  const socketsByUid = new Map<string, Set<WebSocket>>();
  const socketMeta = new Map<
    WebSocket,
    { uid: string; subscribedPeers: Set<string>; isAlive: boolean }
  >();
  const subscribersByTargetUid = new Map<string, Set<WebSocket>>();

  const RELAY_QUEUE_PATH = path.join(os.tmpdir(), 'chatfi-relay-queue.json');
  const RELAY_MAX_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const pendingRelayByRecipient = new Map<string, RelayedChatEnvelope[]>();
  const deliveryReceiptsBySender = new Map<string, DeliveryReceiptBatch[]>();

  try {
    if (fs.existsSync(RELAY_QUEUE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(RELAY_QUEUE_PATH, 'utf-8')) as {
        pendingByRecipient?: Record<string, RelayedChatEnvelope[]>;
        receiptsBySender?: Record<string, DeliveryReceiptBatch[]>;
      };
      const nowMs = Date.now();
      if (raw.pendingByRecipient) {
        for (const [uid, list] of Object.entries(raw.pendingByRecipient)) {
          if (Array.isArray(list)) {
            const valid = list.filter((m) => m && nowMs - (m.createdAtMs || 0) < RELAY_MAX_TTL_MS);
            if (valid.length > 0) pendingRelayByRecipient.set(uid, valid);
          }
        }
      }
      if (raw.receiptsBySender) {
        for (const [uid, list] of Object.entries(raw.receiptsBySender)) {
          if (Array.isArray(list)) {
            const valid = list.filter((r) => r && nowMs - (r.deliveredAtMs || 0) < RELAY_MAX_TTL_MS);
            if (valid.length > 0) deliveryReceiptsBySender.set(uid, valid);
          }
        }
      }
    }
  } catch {
    // Non-fatal relay queue init error
  }

  let relaySaveTimer: NodeJS.Timeout | null = null;
  const scheduleSaveRelayQueue = () => {
    if (relaySaveTimer) return;
    relaySaveTimer = setTimeout(() => {
      relaySaveTimer = null;
      try {
        const pendingObj: Record<string, RelayedChatEnvelope[]> = {};
        pendingRelayByRecipient.forEach((v, k) => {
          if (v.length > 0) pendingObj[k] = v;
        });
        const receiptsObj: Record<string, DeliveryReceiptBatch[]> = {};
        deliveryReceiptsBySender.forEach((v, k) => {
          if (v.length > 0) receiptsObj[k] = v;
        });
        fs.writeFileSync(
          RELAY_QUEUE_PATH,
          JSON.stringify({ pendingByRecipient: pendingObj, receiptsBySender: receiptsObj }),
          'utf-8'
        );
      } catch {
        // Non-fatal
      }
    }, 350);
  };

  const toPublicPresence = (uid: string, viewerUid?: string) => {
    if (viewerUid && shouldHidePresenceBetween(viewerUid, uid)) {
      return {
        uid,
        isOnline: false,
        lastSeenAt: 0,
        showOnlineStatus: false,
        showLastSeen: false,
      };
    }
    const rec = presenceByUid.get(uid);
    if (!rec) {
      return {
        uid,
        isOnline: false,
        lastSeenAt: 0,
        showOnlineStatus: true,
        showLastSeen: true,
      };
    }
    const showOnline = rec.showOnlineStatus !== false;
    const showLastSeen = rec.showLastSeen !== false;
    return {
      uid,
      isOnline: showOnline ? rec.isOnline : false,
      lastSeenAt: showLastSeen ? rec.lastSeenAt : 0,
      showOnlineStatus: showOnline,
      showLastSeen,
    };
  };

  const sendWsJson = (socket: WebSocket, payload: Record<string, unknown>) => {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(payload));
      } catch {
        // ignore closed socket race
      }
    }
  };

  const broadcastPresenceDelta = (uid: string) => {
    const subs = subscribersByTargetUid.get(uid);
    if (!subs || subs.size === 0) return;
    subs.forEach((sock) => {
      const viewerUid = socketMeta.get(sock)?.uid;
      const entry = toPublicPresence(uid, viewerUid);
      sendWsJson(sock, { type: 'presence:update', entries: [entry] });
    });
  };

  const updateUserPresenceInMemory = (
    uid: string,
    patch: Partial<Omit<ServerPresenceRecord, 'uid'>>
  ) => {
    const prev = presenceByUid.get(uid) || {
      uid,
      isOnline: false,
      lastSeenAt: Date.now(),
      showOnlineStatus: true,
      showLastSeen: true,
    };
    const next: ServerPresenceRecord = {
      uid,
      isOnline: patch.isOnline ?? prev.isOnline,
      lastSeenAt: patch.lastSeenAt ?? prev.lastSeenAt,
      showOnlineStatus: patch.showOnlineStatus ?? prev.showOnlineStatus,
      showLastSeen: patch.showLastSeen ?? prev.showLastSeen,
    };
    presenceByUid.set(uid, next);
    broadcastPresenceDelta(uid);
  };

  type ServerChatActivityKind = 'idle' | 'typing' | 'recording_audio' | 'recording_video';
  interface ServerChatActivityRecord {
    actorUid: string;
    targetUid: string;
    chatId: string;
    activity: Exclude<ServerChatActivityKind, 'idle'>;
    updatedAt: number;
    expiresAt: number;
  }
  const chatActivityByKey = new Map<string, ServerChatActivityRecord>();

  const setChatActivityInMemory = (
    actorUid: string,
    targetUid: string,
    activity: ServerChatActivityKind
  ) => {
    if (!actorUid || !targetUid || actorUid === targetUid || !VALID_UID_REGEX.test(targetUid)) {
      return;
    }
    const [uA, uB] = [actorUid, targetUid].sort();
    const chatId = `${uA}__${uB}`;
    const key = `${actorUid}->${targetUid}`;
    const now = Date.now();

    if (activity === 'idle' || shouldHidePresenceBetween(actorUid, targetUid)) {
      const existed = chatActivityByKey.delete(key);
      if (existed) {
        const targetSockets = socketsByUid.get(targetUid);
        targetSockets?.forEach((sock) => {
          sendWsJson(sock, {
            type: 'chat:activity',
            peerUid: actorUid,
            chatId,
            activity: 'idle',
            updatedAt: now,
          });
        });
      }
      return;
    }

    const ttlMs = activity === 'typing' ? 6_000 : 120_000;
    chatActivityByKey.set(key, {
      actorUid,
      targetUid,
      chatId,
      activity,
      updatedAt: now,
      expiresAt: now + ttlMs,
    });
    const targetSockets = socketsByUid.get(targetUid);
    targetSockets?.forEach((sock) => {
      sendWsJson(sock, {
        type: 'chat:activity',
        peerUid: actorUid,
        chatId,
        activity,
        updatedAt: now,
      });
    });
  };

  const sanitizeRelayEnvelope = (
    actorUid: string,
    raw: Record<string, unknown>
  ): RelayedChatEnvelope | null => {
    const recipientId =
      typeof raw.recipientId === 'string' ? raw.recipientId.trim().slice(0, 128) : '';
    if (!recipientId || !VALID_UID_REGEX.test(recipientId)) return null;
    const [userA, userB] = [actorUid, recipientId].sort();
    const chatId = `${userA}__${userB}`;
    const createdAtMs =
      typeof raw.createdAtMs === 'number' && Number.isFinite(raw.createdAtMs)
        ? Math.round(raw.createdAtMs)
        : Date.now();
    const rawId = typeof raw.id === 'string' ? raw.id.trim().slice(0, 96) : '';
    const id =
      rawId && VALID_MESSAGE_ID_REGEX.test(rawId)
        ? rawId
        : `m_${createdAtMs}_${Math.random().toString(36).slice(2, 7)}`;
    const allowedTypes = new Set([
      'text',
      'audio',
      'image',
      'video',
      'order_card',
      'billing_reminder',
    ]);
    const type = allowedTypes.has(String(raw.type))
      ? (String(raw.type) as RelayedChatEnvelope['type'])
      : 'text';
    const d = new Date(createdAtMs);
    const defaultLabel = `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;

    const env: RelayedChatEnvelope = {
      id,
      chatId,
      userA,
      userB,
      senderId: actorUid,
      senderName:
        typeof raw.senderName === 'string' && raw.senderName.trim()
          ? raw.senderName.trim().slice(0, 80)
          : 'Usuário',
      recipientId,
      recipientName:
        typeof raw.recipientName === 'string' && raw.recipientName.trim()
          ? raw.recipientName.trim().slice(0, 80)
          : 'Contato',
      type,
      text:
        typeof raw.text === 'string' && raw.text.trim()
          ? raw.text.trim().slice(0, 1000)
          : 'Mensagem',
      createdAtMs,
      timestampLabel:
        typeof raw.timestampLabel === 'string' && raw.timestampLabel.trim()
          ? raw.timestampLabel.trim().slice(0, 16)
          : defaultLabel,
    };

    if (typeof raw.mediaUrl === 'string' && raw.mediaUrl.length > 0 && raw.mediaUrl.length <= 520000) {
      env.mediaUrl = raw.mediaUrl;
    }
    if (typeof raw.audioDuration === 'string' && raw.audioDuration) {
      env.audioDuration = raw.audioDuration.slice(0, 16);
    }
    if (typeof raw.videoDuration === 'string' && raw.videoDuration) {
      env.videoDuration = raw.videoDuration.slice(0, 16);
    }
    if (typeof raw.mediaTransitPath === 'string' && raw.mediaTransitPath) {
      env.mediaTransitPath = raw.mediaTransitPath.slice(0, 260);
    }
    if (typeof raw.mediaDelivered === 'boolean') {
      env.mediaDelivered = raw.mediaDelivered;
    }
    if (typeof raw.mediaSizeBytes === 'number' && raw.mediaSizeBytes >= 0) {
      env.mediaSizeBytes = Math.round(raw.mediaSizeBytes);
    }
    if (typeof raw.mediaMimeType === 'string' && raw.mediaMimeType) {
      env.mediaMimeType = raw.mediaMimeType.slice(0, 80);
    }
    if (typeof raw.mediaExpiresAtMs === 'number' && raw.mediaExpiresAtMs >= 0) {
      env.mediaExpiresAtMs = Math.round(raw.mediaExpiresAtMs);
    }
    if (typeof raw.orderId === 'string' && raw.orderId) {
      env.orderId = raw.orderId.slice(0, 128);
    }
    if (typeof raw.orderCode === 'string' && raw.orderCode) {
      env.orderCode = raw.orderCode.slice(0, 32);
    }
    if (typeof raw.orderSummary === 'string' && raw.orderSummary) {
      env.orderSummary = raw.orderSummary.slice(0, 240);
    }
    if (typeof raw.orderTotal === 'number' && Number.isFinite(raw.orderTotal)) {
      env.orderTotal = raw.orderTotal;
    }
    if (typeof raw.orderStatusLabel === 'string' && raw.orderStatusLabel) {
      env.orderStatusLabel = raw.orderStatusLabel.slice(0, 120);
    }
    if (typeof raw.pushPreviewText === 'string' && raw.pushPreviewText) {
      env.pushPreviewText = raw.pushPreviewText.slice(0, 180);
    }
    if (
      raw.pushMessageType === 'text' ||
      raw.pushMessageType === 'audio' ||
      raw.pushMessageType === 'image' ||
      raw.pushMessageType === 'video'
    ) {
      env.pushMessageType = raw.pushMessageType;
    }
    return env;
  };

  const relayAndDeliverChatMessage = async (
    env: RelayedChatEnvelope,
    callerIdToken?: string,
    originSocket?: WebSocket
  ): Promise<void> => {
    const blockedByRecipient =
      env.recipientId !== env.senderId && isBlockedByPeer(env.recipientId, env.senderId);

    // 1) Store in recipient temporary pending queue until recipient device ACKs saving to IndexedDB
    if (env.recipientId !== env.senderId && !blockedByRecipient) {
      const q = pendingRelayByRecipient.get(env.recipientId) || [];
      if (!q.some((item) => item.id === env.id)) {
        q.push(env);
        // Keep queue bounded cleanly (newest 500 pending envelopes)
        if (q.length > 500) {
          q.splice(0, q.length - 500);
        }
        pendingRelayByRecipient.set(env.recipientId, q);
        scheduleSaveRelayQueue();
      }
    }

    // 2) Push immediately over WebSocket to all online sockets of recipient
    if (!blockedByRecipient) {
      const recipientSockets = socketsByUid.get(env.recipientId);
      if (recipientSockets && recipientSockets.size > 0) {
        recipientSockets.forEach((sock) => {
          sendWsJson(sock, { type: 'chat:message', envelope: env });
        });
      }
    }

    // 3) Sync sender's other open tabs/devices so multi-tab chats stay identical
    const senderSockets = socketsByUid.get(env.senderId);
    if (senderSockets && senderSockets.size > 0) {
      senderSockets.forEach((sock) => {
        if (sock !== originSocket) {
          sendWsJson(sock, { type: 'chat:message', envelope: env });
        }
      });
    }

    // 4) Trigger Web Push only if recipient is not actively viewing this exact chat on screen
    if (env.recipientId !== env.senderId && !blockedByRecipient) {
      const activeChat = activeChatByUid.get(env.recipientId);
      const isViewingThisChat =
        activeChat &&
        Date.now() - activeChat.updatedAt <= ACTIVE_CHAT_TTL_MS &&
        activeChat.peerId === env.senderId;

      if (!isViewingThisChat) {
        const preview = env.pushPreviewText || env.text || 'Nova mensagem';
        const msgType =
          env.pushMessageType ||
          (env.type === 'audio' || env.type === 'image' || env.type === 'video'
            ? env.type
            : 'text');
        void resolveSenderAvatarForPush(
          env.senderId,
          callerIdToken || '',
          env.senderName
        ).then((senderAvatarUrl) =>
          dispatchPushToUser(
            env.recipientId,
            {
              type: 'new_message',
              senderId: env.senderId,
              senderName: env.senderName,
              senderAvatarUrl,
              body: preview.slice(0, 180),
              messageType: msgType,
              messageId: env.id,
            },
            { ttl: 3600, urgency: 'high' },
            callerIdToken || ''
          )
        );
      }
    }
  };

  const acknowledgeRelayedMessages = (recipientUid: string, messageIds: string[]): void => {
    if (!recipientUid || messageIds.length === 0) return;
    const queue = pendingRelayByRecipient.get(recipientUid);
    if (!queue || queue.length === 0) return;
    const ackSet = new Set(messageIds);
    const ackedBySenderAndChat = new Map<string, { senderId: string; chatId: string; ids: string[] }>();
    const remaining: RelayedChatEnvelope[] = [];

    for (const env of queue) {
      if (ackSet.has(env.id)) {
        const key = `${env.senderId}::${env.chatId}`;
        const bucket = ackedBySenderAndChat.get(key) || {
          senderId: env.senderId,
          chatId: env.chatId,
          ids: [],
        };
        bucket.ids.push(env.id);
        ackedBySenderAndChat.set(key, bucket);
      } else {
        remaining.push(env);
      }
    }

    if (remaining.length > 0) {
      pendingRelayByRecipient.set(recipientUid, remaining);
    } else {
      pendingRelayByRecipient.delete(recipientUid);
    }

    const nowMs = Date.now();
    ackedBySenderAndChat.forEach(({ senderId, chatId, ids }) => {
      const senderSockets = socketsByUid.get(senderId);
      if (senderSockets && senderSockets.size > 0) {
        senderSockets.forEach((sock) => {
          sendWsJson(sock, { type: 'chat:delivered', chatId, messageIds: ids });
        });
      } else {
        const list = deliveryReceiptsBySender.get(senderId) || [];
        list.push({ chatId, messageIds: ids, deliveredAtMs: nowMs });
        if (list.length > 200) list.splice(0, list.length - 200);
        deliveryReceiptsBySender.set(senderId, list);
      }
    });

    scheduleSaveRelayQueue();
  };

  app.post(
    '/api/chat/relay/send',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const rawEnv =
        req.body && typeof req.body.envelope === 'object' && req.body.envelope !== null
          ? (req.body.envelope as Record<string, unknown>)
          : (req.body as Record<string, unknown>);
      const env = sanitizeRelayEnvelope(actorUid, rawEnv || {});
      if (!env) {
        res.status(400).json({ error: 'Envelope de mensagem inválido.' });
        return;
      }
      await relayAndDeliverChatMessage(env, req.idToken || '');
      res.json({ ok: true, id: env.id, chatId: env.chatId });
    }
  );

  app.post(
    '/api/chat/relay/ack',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const uid = req.verifiedUid!;
      const messageIds = Array.isArray(req.body?.messageIds)
        ? (req.body.messageIds as unknown[]).filter(
            (id): id is string => typeof id === 'string' && id.length > 0
          )
        : [];
      acknowledgeRelayedMessages(uid, messageIds);
      res.json({ ok: true, acknowledged: messageIds.length });
    }
  );

  app.get(
    '/api/chat/relay/pending',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const uid = req.verifiedUid!;
      const envelopes = pendingRelayByRecipient.get(uid) || [];
      const receipts = deliveryReceiptsBySender.get(uid) || [];
      if (receipts.length > 0) {
        deliveryReceiptsBySender.delete(uid);
        scheduleSaveRelayQueue();
      }
      res.json({ ok: true, envelopes, deliveredReceipts: receipts });
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

  interface CancelledOrderRecord {
    orderId: string;
    orderCode: string;
    participantUids: string[];
    status: 'cancelled';
    stockRestored: boolean;
    cancelledAtMs: number;
    cancelReason: string;
    cancelledByUid: string;
    asaasChargeStatus: string;
    asaasCancelled: boolean;
    restoredItems: Array<{
      productId: string;
      productName: string;
      boxesRestored: number;
      newStockBoxes: number;
    }>;
    syncedToFirestore: boolean;
  }

  interface PersistedAsaasLedger {
    chargesByOrderId: Record<string, AsaasLedgerRecord>;
    orderIdByChargeId: Record<string, string>;
    processedWebhookKeys: string[];
    cancelledOrdersByOrderId: Record<string, CancelledOrderRecord>;
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
          cancelledOrdersByOrderId:
            parsed.cancelledOrdersByOrderId && typeof parsed.cancelledOrdersByOrderId === 'object'
              ? parsed.cancelledOrdersByOrderId
              : {},
        };
      }
    } catch {
      // fallback to clean ledger
    }
    return {
      chargesByOrderId: {},
      orderIdByChargeId: {},
      processedWebhookKeys: [],
      cancelledOrdersByOrderId: {},
    };
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

  const ORDER_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;

  const isAsaasPaidStatus = (rawStatus?: string): boolean => {
    const normalized = (rawStatus || '').trim().toUpperCase();
    return (
      normalized === 'CONFIRMED' ||
      normalized === 'RECEIVED' ||
      normalized === 'RECEIVED_IN_CASH' ||
      normalized === 'PAYMENT_CONFIRMED' ||
      normalized === 'PAYMENT_RECEIVED' ||
      normalized === 'PAYMENT_ANTICIPATED' ||
      normalized === 'QUITADO'
    );
  };

  interface FirestoreDocWithMeta {
    data: Record<string, unknown>;
    updateTime?: string;
    createTime?: string;
  }

  const firestoreRestGetDocWithMeta = async (
    collectionPath: string,
    docId: string,
    idToken: string
  ): Promise<FirestoreDocWithMeta | null> => {
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
      updateTime?: string;
      createTime?: string;
    };
    return {
      data: decodeFirestoreFields(json.fields),
      updateTime: json.updateTime,
      createTime: json.createTime,
    };
  };

  const firestoreRestGetDoc = async (
    collectionPath: string,
    docId: string,
    idToken: string
  ): Promise<Record<string, unknown> | null> => {
    const meta = await firestoreRestGetDocWithMeta(collectionPath, docId, idToken);
    return meta ? meta.data : null;
  };

  const encodeFirestoreRestValue = (val: unknown): FirestoreRestValue => {
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') {
      return Number.isInteger(val)
        ? { integerValue: String(val) }
        : { doubleValue: val };
    }
    return { stringValue: String(val ?? '') };
  };

  const firestoreRestCommit = async (
    writes: Array<Record<string, unknown>>,
    idToken: string
  ): Promise<{ ok: boolean; status: number; bodyText: string }> => {
    if (!firebaseProjectId || writes.length === 0) {
      return { ok: true, status: 200, bodyText: '' };
    }
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseProjectId
    )}/databases/${encodeURIComponent(firebaseDatabaseId)}/documents:commit`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ writes }),
    });
    const bodyText = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, bodyText };
  };

  interface QueriedSubOrder {
    id: string;
    subOrderCode: string;
    factoryId: string;
    factoryName: string;
    factoryCost: number;
    status: string;
    items: Array<{
      productId: string;
      productName: string;
      boxesRequested: number;
      availability: string;
    }>;
    updateTime?: string;
  }

  const parseQueriedSubOrder = (
    docId: string,
    d: Record<string, unknown>,
    updateTime?: string
  ): QueriedSubOrder => {
    const rawItems = Array.isArray(d.items) ? d.items : [];
    const items = rawItems
      .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === 'object'))
      .map((it) => ({
        productId: String(it.productId || ''),
        productName: String(it.productName || 'Produto'),
        boxesRequested: Math.max(0, Math.round(Number(it.boxesRequested || 0))),
        availability: String(it.availability || 'pending'),
      }));
    return {
      id: docId,
      subOrderCode: String(d.subOrderCode || ''),
      factoryId: String(d.factoryId || ''),
      factoryName: String(d.factoryName || 'Fábrica'),
      factoryCost: Number(d.factoryCost || 0),
      status: String(d.status || 'pending_inquiry'),
      items,
      updateTime,
    };
  };

  const firestoreRestQuerySubOrdersForActor = async (
    parentOrderId: string,
    actorField: 'buyerId' | 'resellerId' | 'factoryId',
    actorUid: string,
    idToken: string
  ): Promise<QueriedSubOrder[]> => {
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
        updateTime?: string;
      };
    }>;
    const out: QueriedSubOrder[] = [];
    for (const row of rows) {
      if (!row.document?.fields || !row.document.name) continue;
      const d = decodeFirestoreFields(row.document.fields);
      if (String(d.parentOrderId || '') !== parentOrderId) continue;
      const docId = row.document.name.split('/').pop() || '';
      out.push(parseQueriedSubOrder(docId, d, row.document.updateTime));
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

  const cancelAsaasPaymentIfPresent = async (
    asaasPaymentId: string
  ): Promise<{
    alreadyPaid: boolean;
    asaasCancelled: boolean;
    asaasStatus: string;
    errorMessage?: string;
  }> => {
    const cleanId = asaasPaymentId.trim();
    const asaasApiKey = (process.env.ASAAS_API_KEY || '').trim();
    if (!cleanId || cleanId.startsWith('asaas_preview_') || !asaasApiKey) {
      return {
        alreadyPaid: false,
        asaasCancelled: false,
        asaasStatus: cleanId ? 'CANCELLED' : 'CANCELLED',
      };
    }

    const baseUrl = getAsaasBaseUrl();
    try {
      const checkRes = await fetch(`${baseUrl}/payments/${encodeURIComponent(cleanId)}`, {
        headers: {
          access_token: asaasApiKey,
          'User-Agent': 'ChatFi/1.0',
        },
      });
      if (checkRes.status === 404) {
        return { alreadyPaid: false, asaasCancelled: true, asaasStatus: 'DELETED' };
      }
      if (checkRes.ok) {
        const current = (await checkRes.json().catch(() => ({}))) as {
          status?: string;
          deleted?: boolean;
        };
        if (current.deleted || String(current.status || '').toUpperCase() === 'DELETED') {
          return { alreadyPaid: false, asaasCancelled: true, asaasStatus: 'DELETED' };
        }
        if (isAsaasPaidStatus(current.status)) {
          return {
            alreadyPaid: true,
            asaasCancelled: false,
            asaasStatus: String(current.status || 'CONFIRMED'),
          };
        }
      }

      const delRes = await fetch(`${baseUrl}/payments/${encodeURIComponent(cleanId)}`, {
        method: 'DELETE',
        headers: {
          access_token: asaasApiKey,
          'User-Agent': 'ChatFi/1.0',
        },
      });
      if (delRes.ok || delRes.status === 404) {
        return { alreadyPaid: false, asaasCancelled: true, asaasStatus: 'DELETED' };
      }
      const delJson = (await delRes.json().catch(() => ({}))) as {
        errors?: Array<{ description?: string }>;
      };
      const errDesc = delJson.errors?.[0]?.description || '';
      if (/recebid|confirmad|paid|confirmed|received/i.test(errDesc)) {
        return {
          alreadyPaid: true,
          asaasCancelled: false,
          asaasStatus: 'CONFIRMED',
          errorMessage: errDesc,
        };
      }
      return {
        alreadyPaid: false,
        asaasCancelled: false,
        asaasStatus: 'CANCELLED',
        errorMessage: errDesc || `Asaas HTTP ${delRes.status}`,
      };
    } catch (err) {
      return {
        alreadyPaid: false,
        asaasCancelled: false,
        asaasStatus: 'CANCELLED',
        errorMessage: err instanceof Error ? err.message : 'Falha de comunicação com Asaas',
      };
    }
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
            status: 'pending_inquiry',
            items: [],
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

  // 7b. Cancel unpaid order, delete pending Asaas payment, mark cancelled, and atomically return stock without duplication
  app.post(
    '/api/orders/:orderId/cancel',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const idToken = req.idToken || '';
      const orderId = typeof req.params?.orderId === 'string' ? req.params.orderId.trim() : '';
      const rawReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const cancelReason =
        rawReason === 'expired_2h' ||
        rawReason === 'buyer_cancelled' ||
        rawReason === 'reseller_cancelled' ||
        rawReason === 'factory_cancelled'
          ? rawReason
          : 'manual_cancelled';

      if (!VALID_UID_REGEX.test(orderId)) {
        res.status(400).json({ error: 'ID do pedido inválido.' });
        return;
      }

      const orderMeta = await firestoreRestGetDocWithMeta('orders', orderId, idToken);
      if (!orderMeta) {
        res.status(404).json({ error: 'Pedido não encontrado no Firestore.' });
        return;
      }

      const orderData = orderMeta.data;
      const buyerId = String(orderData.buyerId || '');
      const resellerId = String(orderData.resellerId || '');
      const factoryIds = Array.isArray(orderData.factoryIds)
        ? orderData.factoryIds.map((id) => String(id))
        : [];

      if (actorUid !== buyerId && actorUid !== resellerId && !factoryIds.includes(actorUid)) {
        res.status(403).json({ error: 'Sem permissão para cancelar este pedido.' });
        return;
      }

      const currentStatus = String(orderData.status || 'pending_inquiry');
      const existingCancelledRecord = asaasLedger.cancelledOrdersByOrderId[orderId];
      if (
        currentStatus === 'cancelled' ||
        orderData.stockRestored === true ||
        existingCancelledRecord
      ) {
        res.json({
          ok: true,
          alreadyCancelled: true,
          orderId,
          asaasCancelled: false,
          stockRestored: Boolean(orderData.stockRestored || existingCancelledRecord?.stockRestored),
          cancelReason: existingCancelledRecord?.cancelReason || String(orderData.cancelReason || ''),
          cancelledAtMs: existingCancelledRecord?.cancelledAtMs,
          asaasChargeStatus: existingCancelledRecord?.asaasChargeStatus || String(orderData.asaasChargeStatus || ''),
          restoredItems: [],
        });
        return;
      }

      if (currentStatus === 'dispatched' || currentStatus === 'completed') {
        res.status(400).json({
          error: 'Pedidos já despachados ou concluídos não podem ser cancelados.',
        });
        return;
      }

      const ledgerRecord = asaasLedger.chargesByOrderId[orderId];
      if (
        isAsaasPaidStatus(String(orderData.asaasChargeStatus || '')) ||
        isAsaasPaidStatus(ledgerRecord?.asaasStatus) ||
        ledgerRecord?.mappedPaymentStatus === 'Quitado'
      ) {
        res.status(409).json({
          error: 'Pagamento já confirmado no Asaas. Não é possível cancelar como não pago.',
        });
        return;
      }

      if (cancelReason === 'expired_2h') {
        const createdMsFromDoc =
          typeof orderData.createdAtMs === 'number' && orderData.createdAtMs > 0
            ? orderData.createdAtMs
            : orderMeta.createTime
              ? Date.parse(orderMeta.createTime)
              : 0;
        const expiresAtMs =
          typeof orderData.reservationExpiresAtMs === 'number' &&
          orderData.reservationExpiresAtMs > 0
            ? orderData.reservationExpiresAtMs
            : createdMsFromDoc > 0
              ? createdMsFromDoc + ORDER_RESERVATION_TTL_MS
              : 0;
        if (expiresAtMs > 0 && Date.now() + 5000 < expiresAtMs) {
          res.status(400).json({
            error: 'A reserva de 2 horas para este pedido ainda está vigente.',
          });
          return;
        }
      }

      const asaasPaymentId = String(
        orderData.asaasChargeId || ledgerRecord?.chargeId || ''
      ).trim();

      const asaasCancelRes = await cancelAsaasPaymentIfPresent(asaasPaymentId);
      if (asaasCancelRes.alreadyPaid) {
        res.status(409).json({
          error:
            asaasCancelRes.errorMessage ||
            'A cobrança já foi paga no Asaas e não pode ser cancelada.',
        });
        return;
      }

      const nextAsaasStatus =
        cancelReason === 'expired_2h'
          ? 'CANCELLED_EXPIRED'
          : asaasCancelRes.asaasStatus || 'DELETED';

      // Gather all sub-orders authorized for this caller
      const actorField: 'buyerId' | 'resellerId' | 'factoryId' =
        actorUid === buyerId
          ? 'buyerId'
          : actorUid === resellerId
            ? 'resellerId'
            : 'factoryId';
      const queriedSubs = await firestoreRestQuerySubOrdersForActor(
        orderId,
        actorField,
        actorUid,
        idToken
      );
      const subById = new Map<string, QueriedSubOrder>();
      for (const s of queriedSubs) {
        subById.set(s.id, s);
      }

      // If a manufacturer cancels a multi-factory order, probe deterministic sibling sub-order IDs too
      if (actorField === 'factoryId' && factoryIds.length > subById.size) {
        const probeCount = Math.min(10, factoryIds.length + 1);
        for (let idx = 0; idx < probeCount; idx += 1) {
          const candidateId = `sub_${orderId}_${idx}`;
          if (subById.has(candidateId)) continue;
          const subMeta = await firestoreRestGetDocWithMeta('sub_orders', candidateId, idToken);
          if (subMeta && String(subMeta.data.parentOrderId || '') === orderId) {
            subById.set(
              candidateId,
              parseQueriedSubOrder(candidateId, subMeta.data, subMeta.updateTime)
            );
          }
        }
      }

      const subOrders = Array.from(subById.values());
      const boxesToRestoreByProduct = new Map<string, { productName: string; boxes: number }>();

      for (const sub of subOrders) {
        if (sub.status === 'cancelled') continue;
        const wasStockDeducted =
          orderData.stockReserved === true ||
          sub.status === 'confirmed' ||
          sub.status === 'partial_confirmed' ||
          sub.status === 'logistics_sent';
        if (!wasStockDeducted) continue;

        for (const item of sub.items) {
          if (item.availability === 'unavailable') continue;
          if (!VALID_UID_REGEX.test(item.productId) || item.boxesRequested <= 0) continue;
          const prev = boxesToRestoreByProduct.get(item.productId);
          boxesToRestoreByProduct.set(item.productId, {
            productName: item.productName,
            boxes: (prev?.boxes || 0) + item.boxesRequested,
          });
        }
      }

      const docBase = `projects/${firebaseProjectId}/databases/${firebaseDatabaseId}/documents`;
      const coreWrites: Array<Record<string, unknown>> = [];
      const paymentWrites: Array<Record<string, unknown>> = [];
      const factoryDirectProductWrites: Array<Record<string, unknown>> = [];
      const restoredItems: Array<{
        productId: string;
        productName: string;
        boxesRestored: number;
        newStockBoxes: number;
      }> = [];

      // 1) Order update (with updateTime precondition so duplicate/concurrent cancellation is impossible)
      const cancelledAtMs = Date.now();
      const orderCancelReason =
        cancelReason === 'expired_2h'
          ? 'expired_2h'
          : actorUid === buyerId
            ? 'buyer_cancelled'
            : actorUid === resellerId
              ? 'reseller_cancelled'
              : 'factory_cancelled';

      coreWrites.push({
        update: {
          name: `${docBase}/orders/${orderId}`,
          fields: {
            status: encodeFirestoreRestValue('cancelled'),
            stockRestored: encodeFirestoreRestValue(true),
            cancelledAtMs: encodeFirestoreRestValue(cancelledAtMs),
            cancelReason: encodeFirestoreRestValue(orderCancelReason),
            cancelledByUid: encodeFirestoreRestValue(actorUid),
            asaasChargeStatus: encodeFirestoreRestValue(nextAsaasStatus),
          },
        },
        updateMask: {
          fieldPaths: [
            'status',
            'stockRestored',
            'cancelledAtMs',
            'cancelReason',
            'cancelledByUid',
            'asaasChargeStatus',
          ],
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        ...(orderMeta.updateTime
          ? { currentDocument: { updateTime: orderMeta.updateTime } }
          : {}),
      });

      // 2) Sub-order updates
      for (const sub of subOrders) {
        if (sub.status === 'cancelled' || !VALID_UID_REGEX.test(sub.id)) continue;
        coreWrites.push({
          update: {
            name: `${docBase}/sub_orders/${sub.id}`,
            fields: {
              status: encodeFirestoreRestValue('cancelled'),
            },
          },
          updateMask: {
            fieldPaths: ['status'],
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        });
      }

      // 3) Product stock restoration updates (read latest stock + updateTime precondition)
      for (const [productId, restoreInfo] of boxesToRestoreByProduct.entries()) {
        const prodMeta = await firestoreRestGetDocWithMeta('products', productId, idToken);
        if (!prodMeta) continue;
        const currentStock = Math.max(0, Number(prodMeta.data.stockBoxes ?? 0));
        const nextStock = Math.min(100000, currentStock + restoreInfo.boxes);
        coreWrites.push({
          update: {
            name: `${docBase}/products/${productId}`,
            fields: {
              stockBoxes: encodeFirestoreRestValue(nextStock),
              isSoldOutToday: encodeFirestoreRestValue(nextStock <= 0),
              lastStockOrderId: encodeFirestoreRestValue(orderId),
            },
          },
          updateMask: {
            fieldPaths: ['stockBoxes', 'isSoldOutToday', 'lastStockOrderId'],
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          ...(prodMeta.updateTime
            ? { currentDocument: { updateTime: prodMeta.updateTime } }
            : {}),
        });
        if (String(prodMeta.data.factoryId || '') === actorUid) {
          factoryDirectProductWrites.push({
            update: {
              name: `${docBase}/products/${productId}`,
              fields: {
                stockBoxes: encodeFirestoreRestValue(nextStock),
                isSoldOutToday: encodeFirestoreRestValue(nextStock <= 0),
              },
            },
            updateMask: {
              fieldPaths: ['stockBoxes', 'isSoldOutToday'],
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            ...(prodMeta.updateTime
              ? { currentDocument: { updateTime: prodMeta.updateTime } }
              : {}),
          });
        }
        restoredItems.push({
          productId,
          productName: restoreInfo.productName,
          boxesRestored: restoreInfo.boxes,
          newStockBoxes: nextStock,
        });
      }

      // 4) Payment status sync -> 'Cancelado'
      const paymentIdsToCheck = [
        `pay_rb_${orderId}`,
        ...subOrders.map((s) => `pay_fr_${s.id}`),
      ];
      for (const payId of paymentIdsToCheck) {
        const payMeta = await firestoreRestGetDocWithMeta('payments', payId, idToken);
        if (!payMeta) continue;
        if (String(payMeta.data.status || '') === 'Cancelado') continue;
        paymentWrites.push({
          update: {
            name: `${docBase}/payments/${payId}`,
            fields: {
              status: encodeFirestoreRestValue('Cancelado'),
              asaasChargeStatus: encodeFirestoreRestValue(nextAsaasStatus),
            },
          },
          updateMask: {
            fieldPaths: ['status', 'asaasChargeStatus'],
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        });
      }

      let syncedToFirestore = false;
      let commitRes = await firestoreRestCommit([...coreWrites, ...paymentWrites], idToken);
      if (commitRes.ok) {
        syncedToFirestore = true;
      } else {
        // Check if another concurrent caller just cancelled this order
        const recheck = await firestoreRestGetDoc('orders', orderId, idToken);
        if (recheck && (recheck.status === 'cancelled' || recheck.stockRestored === true)) {
          res.json({
            ok: true,
            alreadyCancelled: true,
            orderId,
            asaasCancelled: asaasCancelRes.asaasCancelled,
            stockRestored: Boolean(recheck.stockRestored),
            restoredItems: [],
          });
          return;
        }

        // Retry core writes without payment docs in case a legacy payment doc triggered 403
        if (commitRes.status === 403 && paymentWrites.length > 0 && coreWrites.length > 0) {
          const coreRetry = await firestoreRestCommit(coreWrites, idToken);
          if (coreRetry.ok) {
            syncedToFirestore = true;
          } else {
            commitRes = coreRetry;
          }
        }

        if (!syncedToFirestore) {
          if (commitRes.status === 403) {
            // If live Firestore rules on this project are pending publish, still restore factory-owned stock when possible
            if (factoryDirectProductWrites.length > 0) {
              await firestoreRestCommit(factoryDirectProductWrites, idToken).catch(() => {});
            }
            console.warn(
              `[orders-cancel] Firestore commit returned 403 for ${orderId}; persisted cancellation in server ledger (pending firestore.rules publish).`
            );
          } else {
            console.error(
              `[orders-cancel] Firestore commit failed (${commitRes.status}) for ${orderId}:`,
              commitRes.bodyText.slice(0, 400)
            );
            res.status(commitRes.status >= 400 ? commitRes.status : 500).json({
              error: 'Não foi possível concluir o cancelamento e a devolução do estoque no Firestore.',
            });
            return;
          }
        }
      }

      const orderCodeLabel = String(orderData.orderCode || orderId);
      const participantUids = Array.from(
        new Set([buyerId, resellerId, ...factoryIds].filter(Boolean))
      );

      asaasLedger.cancelledOrdersByOrderId[orderId] = {
        orderId,
        orderCode: orderCodeLabel,
        participantUids,
        status: 'cancelled',
        stockRestored: true,
        cancelledAtMs,
        cancelReason: orderCancelReason,
        cancelledByUid: actorUid,
        asaasChargeStatus: nextAsaasStatus,
        asaasCancelled: asaasCancelRes.asaasCancelled,
        restoredItems,
        syncedToFirestore,
      };

      if (ledgerRecord) {
        ledgerRecord.asaasStatus = nextAsaasStatus;
        ledgerRecord.mappedPaymentStatus = 'Aguardando';
        ledgerRecord.updatedAtMs = cancelledAtMs;
      }
      saveAsaasLedger();

      const notifyTargets = participantUids.filter((u) => u !== actorUid);
      for (const targetUid of notifyTargets) {
        void dispatchPushToUser(
          targetUid,
          {
            type: 'new_message',
            senderId: 'chatfi-orders',
            senderName: 'Pedidos ChatFi',
            body:
              cancelReason === 'expired_2h'
                ? `Reserva de 2h do pedido ${orderCodeLabel} expirou. Itens devolvidos ao estoque.`
                : `Pedido ${orderCodeLabel} foi cancelado e os itens voltaram ao estoque.`,
            messageType: 'text',
            messageId: `cancel-${orderId}-${cancelledAtMs}`,
          },
          { ttl: 3600, urgency: 'normal' },
          idToken
        ).catch(() => {});
      }

      console.log(
        `[orders-cancel] orderId=${orderId} reason=${orderCancelReason} asaasCancelled=${asaasCancelRes.asaasCancelled} restoredProducts=${restoredItems.length} syncedToFirestore=${syncedToFirestore}`
      );

      res.json({
        ok: true,
        alreadyCancelled: false,
        pendingRulesSync: !syncedToFirestore,
        orderId,
        asaasCancelled: asaasCancelRes.asaasCancelled,
        stockRestored: true,
        cancelReason: orderCancelReason,
        cancelledAtMs,
        asaasChargeStatus: nextAsaasStatus,
        restoredItems,
      });
    }
  );

  // 7c. Return server-recorded order cancellations for the authenticated participant
  app.get(
    '/api/orders/cancelled-overrides',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const overrides = Object.values(asaasLedger.cancelledOrdersByOrderId).filter((rec) =>
        rec.participantUids.includes(actorUid)
      );
      res.json({ ok: true, overrides });
    }
  );

  // 7d. Chat message deletions ("Apagar para mim" & "Apagar para todos") persisted cleanly on disk
  const chatDeletionsPath = path.join(os.tmpdir(), 'chatfi-chat-deletions.json');
  interface DeletedForAllRecord {
    chatId: string;
    messageId: string;
    senderId: string;
    deletedAtMs: number;
  }
  interface ChatDeletionsStore {
    deletedForMeByUid: Record<string, string[]>;
    deletedForAllByKey: Record<string, DeletedForAllRecord>;
  }
  const loadChatDeletionsStore = (): ChatDeletionsStore => {
    try {
      if (fs.existsSync(chatDeletionsPath)) {
        const raw = JSON.parse(fs.readFileSync(chatDeletionsPath, 'utf-8')) as Partial<ChatDeletionsStore>;
        return {
          deletedForMeByUid:
            raw && typeof raw.deletedForMeByUid === 'object' && raw.deletedForMeByUid
              ? raw.deletedForMeByUid
              : {},
          deletedForAllByKey:
            raw && typeof raw.deletedForAllByKey === 'object' && raw.deletedForAllByKey
              ? raw.deletedForAllByKey
              : {},
        };
      }
    } catch {
      // ignore corrupted store
    }
    return { deletedForMeByUid: {}, deletedForAllByKey: {} };
  };
  const chatDeletionsStore = loadChatDeletionsStore();
  const saveChatDeletionsStore = (): void => {
    try {
      fs.writeFileSync(chatDeletionsPath, JSON.stringify(chatDeletionsStore), { mode: 0o600 });
    } catch {
      // ignore disk write error
    }
  };
  const isChatParticipantId = (chatId: string, uid: string): boolean => {
    if (!chatId || !uid || !/^[a-zA-Z0-9_-]{3,260}$/.test(chatId)) return false;
    const parts = chatId.split('__');
    return parts.length === 2 && (parts[0] === uid || parts[1] === uid);
  };

  app.get(
    '/api/chats/deleted-state',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const deletedForMeIds = Array.isArray(chatDeletionsStore.deletedForMeByUid[actorUid])
        ? chatDeletionsStore.deletedForMeByUid[actorUid]
        : [];
      const deletedForAll = Object.values(chatDeletionsStore.deletedForAllByKey).filter((rec) =>
        isChatParticipantId(rec.chatId, actorUid)
      );
      res.json({ ok: true, deletedForMeIds, deletedForAll });
    }
  );

  app.post(
    '/api/chats/delete-for-me',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const rawIds = Array.isArray((req.body as { messageIds?: unknown })?.messageIds)
        ? ((req.body as { messageIds: unknown[] }).messageIds as unknown[])
        : [];
      const cleanIds = rawIds
        .filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id))
        .slice(0, 200);
      if (cleanIds.length === 0) {
        res.status(400).json({ error: 'Nenhuma mensagem válida informada.' });
        return;
      }
      const existing = new Set(chatDeletionsStore.deletedForMeByUid[actorUid] || []);
      for (const id of cleanIds) existing.add(id);
      chatDeletionsStore.deletedForMeByUid[actorUid] = Array.from(existing).slice(-5000);
      saveChatDeletionsStore();
      res.json({ ok: true, count: cleanIds.length });
    }
  );

  app.post(
    '/api/chats/delete-for-all',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const idToken = req.idToken || '';
      const body = (req.body || {}) as { chatId?: unknown; messageIds?: unknown };
      const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : '';
      if (!isChatParticipantId(chatId, actorUid)) {
        res.status(403).json({ error: 'Conversa inválida ou sem permissão.' });
        return;
      }
      const rawIds = Array.isArray(body.messageIds) ? (body.messageIds as unknown[]) : [];
      const cleanIds = rawIds
        .filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id))
        .slice(0, 100);
      if (cleanIds.length === 0) {
        res.status(400).json({ error: 'Nenhuma mensagem válida informada.' });
        return;
      }

      const deletedIds: string[] = [];
      const nowMs = Date.now();
      for (const messageId of cleanIds) {
        // Verify sender ownership against Firestore when message exists there
        if (idToken) {
          const msgDoc = await firestoreRestGetDoc(
            `chats/${encodeURIComponent(chatId)}/messages`,
            messageId,
            idToken
          ).catch(() => null);
          if (msgDoc && String(msgDoc.senderId || '') !== actorUid) {
            continue;
          }
        }
        const key = `${chatId}__${messageId}`;
        chatDeletionsStore.deletedForAllByKey[key] = {
          chatId,
          messageId,
          senderId: actorUid,
          deletedAtMs: nowMs,
        };
        deletedIds.push(messageId);
      }

      if (deletedIds.length === 0) {
        res.status(403).json({ error: 'Você só pode apagar para todos as mensagens que enviou.' });
        return;
      }

      saveChatDeletionsStore();
      res.json({ ok: true, deletedIds, deletedAtMs: nowMs });
    }
  );

  // 7e. Per-user Chat Organization Preferences (sanitizers + endpoints; store loaded above)
  const sanitizeServerIdArray = (raw: unknown, maxLen = 1000): string[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const t = item.trim();
      if (!t || t.length > 260 || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= maxLen) break;
    }
    return out;
  };
  const sanitizeServerTimestampMap = (raw: unknown): Record<string, number> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    let count = 0;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = k.trim();
      const num = Number(v);
      if (!key || key.length > 260 || !Number.isFinite(num) || num <= 0) continue;
      out[key] = Math.round(num);
      count += 1;
      if (count >= 1000) break;
    }
    return out;
  };
  const sanitizeServerChatPrefs = (raw: unknown): ServerUserChatPreferences => {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<ServerUserChatPreferences>;
    const rawLists = Array.isArray(obj.customLists) ? obj.customLists : [];
    const seenListIds = new Set<string>();
    const customLists: ChatCustomListServer[] = [];
    for (const item of rawLists) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Partial<ChatCustomListServer>;
      const id = typeof entry.id === 'string' ? entry.id.trim().slice(0, 80) : '';
      const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 48) : '';
      if (!id || !name || seenListIds.has(id)) continue;
      seenListIds.add(id);
      customLists.push({
        id,
        name,
        chatIds: sanitizeServerIdArray(entry.chatIds, 500),
        createdAtMs:
          typeof entry.createdAtMs === 'number' && Number.isFinite(entry.createdAtMs)
            ? Math.round(entry.createdAtMs)
            : Date.now(),
      });
      if (customLists.length >= 30) break;
    }
    const lockPinHash =
      typeof obj.lockPinHash === 'string' && obj.lockPinHash.trim().length >= 16
        ? obj.lockPinHash.trim().slice(0, 128)
        : undefined;
    const blockedUids = sanitizeServerIdArray(obj.blockedUids);
    const rawBlockedAt = sanitizeServerTimestampMap(obj.blockedAtByUid);
    const blockedAtByUid: Record<string, number> = {};
    for (const uid of blockedUids) {
      if (rawBlockedAt[uid]) {
        blockedAtByUid[uid] = rawBlockedAt[uid];
      }
    }
    return {
      pinnedChatIds: sanitizeServerIdArray(obj.pinnedChatIds),
      archivedChatIds: sanitizeServerIdArray(obj.archivedChatIds),
      mutedChatIds: sanitizeServerIdArray(obj.mutedChatIds),
      favoriteChatIds: sanitizeServerIdArray(obj.favoriteChatIds),
      unreadChatIds: sanitizeServerIdArray(obj.unreadChatIds),
      lockedChatIds: sanitizeServerIdArray(obj.lockedChatIds),
      ...(lockPinHash ? { lockPinHash } : {}),
      clearedAtByChatId: sanitizeServerTimestampMap(obj.clearedAtByChatId),
      hiddenChatIds: sanitizeServerTimestampMap(obj.hiddenChatIds),
      blockedUids,
      blockedAtByUid,
      customLists,
      shortcutChatIds: sanitizeServerIdArray(obj.shortcutChatIds, 100),
      updatedAtMs:
        typeof obj.updatedAtMs === 'number' && Number.isFinite(obj.updatedAtMs)
          ? Math.round(obj.updatedAtMs)
          : Date.now(),
    };
  };

  app.get(
    '/api/chats/preferences',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const existing = chatPrefsStore[actorUid] || sanitizeServerChatPrefs({});
      res.json({ ok: true, prefs: existing });
    }
  );

  app.put(
    '/api/chats/preferences',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const prevBlocked = new Set(chatPrefsStore[actorUid]?.blockedUids || []);
      const body = (req.body || {}) as { prefs?: unknown };
      const sanitized = sanitizeServerChatPrefs(body.prefs);
      const now = Date.now();
      for (const uid of sanitized.blockedUids) {
        if (!sanitized.blockedAtByUid[uid]) {
          sanitized.blockedAtByUid[uid] =
            chatPrefsStore[actorUid]?.blockedAtByUid?.[uid] || now;
        }
      }
      chatPrefsStore[actorUid] = sanitized;
      saveChatPrefsStore();

      // Push live presence & clear activity for any newly blocked or unblocked peers
      const nextBlocked = new Set(sanitized.blockedUids);
      const changedPeers = new Set<string>();
      prevBlocked.forEach((uid) => {
        if (!nextBlocked.has(uid)) changedPeers.add(uid);
      });
      nextBlocked.forEach((uid) => {
        if (!prevBlocked.has(uid)) changedPeers.add(uid);
      });
      changedPeers.forEach((peerUid) => {
        setChatActivityInMemory(actorUid, peerUid, 'idle');
        setChatActivityInMemory(peerUid, actorUid, 'idle');
        const peerSocks = socketsByUid.get(peerUid);
        peerSocks?.forEach((sock) => {
          sendWsJson(sock, {
            type: 'presence:update',
            entries: [toPublicPresence(actorUid, peerUid)],
          });
        });
      });

      res.json({ ok: true, prefs: sanitized });
    }
  );

  // Stealth peer reachability check: returns { reachable, hidePresence } without ever exposing block state
  app.get(
    '/api/chats/peer-reachability',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const peerUid =
        typeof req.query.peerUid === 'string' ? req.query.peerUid.trim().slice(0, 128) : '';
      if (!peerUid || !VALID_UID_REGEX.test(peerUid)) {
        res.status(400).json({ ok: false, error: 'Destinatário inválido.' });
        return;
      }
      const blockedByRecipient = isBlockedByPeer(peerUid, actorUid);
      const hidePresence = shouldHidePresenceBetween(actorUid, peerUid);
      res.json({
        ok: true,
        reachable: !blockedByRecipient,
        hidePresence,
      });
    }
  );

  // Ephemeral typing / recording audio / recording video HTTP fallback (0 Firestore writes)
  app.post(
    '/api/chat/activity',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const actorUid = req.verifiedUid!;
      const body = (req.body || {}) as { targetUid?: unknown; activity?: unknown };
      const targetUid =
        typeof body.targetUid === 'string' ? body.targetUid.trim().slice(0, 128) : '';
      const rawActivity = String(body.activity || '').trim();
      const allowed = new Set<ServerChatActivityKind>([
        'idle',
        'typing',
        'recording_audio',
        'recording_video',
      ]);
      if (!targetUid || !VALID_UID_REGEX.test(targetUid) || !allowed.has(rawActivity as ServerChatActivityKind)) {
        res.status(400).json({ ok: false, error: 'Parâmetros inválidos.' });
        return;
      }
      setChatActivityInMemory(actorUid, targetUid, rawActivity as ServerChatActivityKind);
      res.json({ ok: true });
    }
  );

  // Background 60s sweeper: expires unpaid Asaas charges older than 2 hours
  const sweepExpiredAsaasReservations = async (): Promise<void> => {
    const now = Date.now();
    let changed = false;
    for (const rec of Object.values(asaasLedger.chargesByOrderId)) {
      if (
        isAsaasPaidStatus(rec.asaasStatus) ||
        rec.mappedPaymentStatus === 'Quitado' ||
        rec.asaasStatus === 'DELETED' ||
        rec.asaasStatus === 'CANCELLED_EXPIRED' ||
        rec.asaasStatus === 'CANCELLED'
      ) {
        continue;
      }
      if (now - rec.createdAtMs < ORDER_RESERVATION_TTL_MS) continue;
      const cancelRes = await cancelAsaasPaymentIfPresent(rec.chargeId);
      if (cancelRes.alreadyPaid) {
        rec.asaasStatus = cancelRes.asaasStatus;
        rec.mappedPaymentStatus = 'Quitado';
        rec.confirmedAtMs = rec.confirmedAtMs || now;
        rec.updatedAtMs = now;
        changed = true;
        continue;
      }
      rec.asaasStatus = 'CANCELLED_EXPIRED';
      rec.updatedAtMs = now;
      changed = true;
      console.log(
        `[asaas-expiry] Charge ${rec.chargeId} for order ${rec.orderId} expired after 2h without payment.`
      );
    }
    if (changed) saveAsaasLedger();
  };

  setInterval(() => {
    void sweepExpiredAsaasReservations().catch((err) => {
      console.warn('[asaas-expiry] Sweeper error:', err);
    });
  }, 60_000);

  // Fallback for PWA Web Share Target if invoked before Service Worker intercepts POST /share-target
  app.all('/share-target', (_req: Request, res: Response) => {
    res.redirect(303, '/?shared=1');
  });

  const httpServer = http.createServer(app);

  // Attach real WebSocket relay & in-memory presence server on /ws/chatfi
  const chatWsServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  const cleanupSocketSubscriptions = (socket: WebSocket) => {
    const meta = socketMeta.get(socket);
    if (!meta) return;
    meta.subscribedPeers.forEach((targetUid) => {
      const set = subscribersByTargetUid.get(targetUid);
      if (set) {
        set.delete(socket);
        if (set.size === 0) subscribersByTargetUid.delete(targetUid);
      }
    });
    meta.subscribedPeers.clear();

    const userSockets = socketsByUid.get(meta.uid);
    if (userSockets) {
      userSockets.delete(socket);
      if (userSockets.size === 0) {
        socketsByUid.delete(meta.uid);
        activeChatByUid.delete(meta.uid);
        updateUserPresenceInMemory(meta.uid, {
          isOnline: false,
          lastSeenAt: Date.now(),
        });
        chatActivityByKey.forEach((rec) => {
          if (rec.actorUid === meta.uid) {
            setChatActivityInMemory(rec.actorUid, rec.targetUid, 'idle');
          }
        });
      }
    }
    socketMeta.delete(socket);
  };

  chatWsServer.on('connection', (socket) => {
    const authTimeout = setTimeout(() => {
      if (!socketMeta.has(socket) && socket.readyState === WebSocket.OPEN) {
        socket.close(4001, 'auth_timeout');
      }
    }, 10_000);

    socket.on('pong', () => {
      const meta = socketMeta.get(socket);
      if (meta) meta.isAlive = true;
    });

    socket.on('message', async (rawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawData.toString('utf-8')) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');
      const meta = socketMeta.get(socket);

      if (type === 'auth') {
        const token = typeof msg.token === 'string' ? msg.token.trim() : '';
        if (!token) {
          socket.close(4002, 'missing_token');
          return;
        }
        try {
          const decoded = await adminAuth.verifyIdToken(token);
          const uid = decoded.uid;
          clearTimeout(authTimeout);

          if (socket.readyState !== WebSocket.OPEN) return;

          // Replace previous meta if re-authenticating on same socket
          if (meta) cleanupSocketSubscriptions(socket);

          socketMeta.set(socket, {
            uid,
            subscribedPeers: new Set(),
            isAlive: true,
          });
          let userSockets = socketsByUid.get(uid);
          if (!userSockets) {
            userSockets = new Set();
            socketsByUid.set(uid, userSockets);
          }
          userSockets.add(socket);

          const isOnlineNow = msg.isOnline !== false;
          const showOnlineStatus = msg.showOnlineStatus !== false;
          const showLastSeen = msg.showLastSeen !== false;
          updateUserPresenceInMemory(uid, {
            isOnline: isOnlineNow,
            lastSeenAt: Date.now(),
            showOnlineStatus,
            showLastSeen,
          });

          if (typeof msg.activePeerId === 'string' && msg.activePeerId.trim()) {
            activeChatByUid.set(uid, {
              peerId: msg.activePeerId.trim().slice(0, 128),
              updatedAt: Date.now(),
            });
          }

          sendWsJson(socket, { type: 'auth:ok', uid });

          // Deliver any currently active typing/recording statuses targeting this user
          const nowActMs = Date.now();
          chatActivityByKey.forEach((rec, key) => {
            if (rec.expiresAt <= nowActMs) {
              chatActivityByKey.delete(key);
              return;
            }
            if (rec.targetUid === uid) {
              sendWsJson(socket, {
                type: 'chat:activity',
                peerUid: rec.actorUid,
                chatId: rec.chatId,
                activity: rec.activity,
                updatedAt: rec.updatedAt,
              });
            }
          });

          // Push any pending offline messages queued while recipient was away
          const pending = pendingRelayByRecipient.get(uid);
          if (pending && pending.length > 0) {
            sendWsJson(socket, { type: 'chat:sync', envelopes: pending });
          }

          // Push any pending delivery receipts for messages sent while sender was offline
          const receipts = deliveryReceiptsBySender.get(uid);
          if (receipts && receipts.length > 0) {
            for (const r of receipts) {
              sendWsJson(socket, {
                type: 'chat:delivered',
                chatId: r.chatId,
                messageIds: r.messageIds,
              });
            }
          }
        } catch {
          socket.close(4003, 'invalid_token');
        }
        return;
      }

      if (!meta) return;
      meta.isAlive = true;

      if (type === 'presence:subscribe') {
        const uids = Array.isArray(msg.uids)
          ? (msg.uids as unknown[])
              .filter((u): u is string => typeof u === 'string' && VALID_UID_REGEX.test(u))
              .slice(0, 500)
          : [];
        const entries: Array<ReturnType<typeof toPublicPresence>> = [];
        for (const targetUid of uids) {
          if (!meta.subscribedPeers.has(targetUid)) {
            meta.subscribedPeers.add(targetUid);
            let subs = subscribersByTargetUid.get(targetUid);
            if (!subs) {
              subs = new Set();
              subscribersByTargetUid.set(targetUid, subs);
            }
            subs.add(socket);
          }
          entries.push(toPublicPresence(targetUid, meta.uid));
        }
        sendWsJson(socket, { type: 'presence:snapshot', entries });
        return;
      }

      if (type === 'presence:set') {
        updateUserPresenceInMemory(meta.uid, {
          isOnline: msg.isOnline !== false,
          lastSeenAt: Date.now(),
          ...(typeof msg.showOnlineStatus === 'boolean'
            ? { showOnlineStatus: msg.showOnlineStatus }
            : {}),
          ...(typeof msg.showLastSeen === 'boolean'
            ? { showLastSeen: msg.showLastSeen }
            : {}),
        });
        return;
      }

      if (type === 'chat:active') {
        const rawPeer =
          typeof msg.peerId === 'string' ? msg.peerId.trim().slice(0, 128) : '';
        if (rawPeer) {
          activeChatByUid.set(meta.uid, { peerId: rawPeer, updatedAt: Date.now() });
        } else {
          activeChatByUid.delete(meta.uid);
        }
        return;
      }

      if (type === 'chat:activity') {
        const targetUid =
          typeof msg.targetUid === 'string' ? msg.targetUid.trim().slice(0, 128) : '';
        const rawActivity = String(msg.activity || '').trim();
        if (
          rawActivity === 'idle' ||
          rawActivity === 'typing' ||
          rawActivity === 'recording_audio' ||
          rawActivity === 'recording_video'
        ) {
          setChatActivityInMemory(meta.uid, targetUid, rawActivity);
        }
        return;
      }

      if (type === 'chat:send' && typeof msg.envelope === 'object' && msg.envelope !== null) {
        const env = sanitizeRelayEnvelope(
          meta.uid,
          msg.envelope as Record<string, unknown>
        );
        if (!env) return;
        setChatActivityInMemory(meta.uid, env.recipientId, 'idle');
        await relayAndDeliverChatMessage(env, undefined, socket);
        sendWsJson(socket, {
          type: 'chat:sent',
          clientReqId: typeof msg.clientReqId === 'string' ? msg.clientReqId : undefined,
          id: env.id,
          chatId: env.chatId,
        });
        return;
      }

      if (type === 'chat:ack') {
        const messageIds = Array.isArray(msg.messageIds)
          ? (msg.messageIds as unknown[]).filter(
              (id): id is string => typeof id === 'string' && id.length > 0
            )
          : [];
        acknowledgeRelayedMessages(meta.uid, messageIds);
        return;
      }

      if (type === 'chat:receipt_ack') {
        const receiptIds = Array.isArray(msg.messageIds)
          ? new Set(
              (msg.messageIds as unknown[]).filter(
                (id): id is string => typeof id === 'string' && id.length > 0
              )
            )
          : new Set<string>();
        const existing = deliveryReceiptsBySender.get(meta.uid);
        if (existing && existing.length > 0 && receiptIds.size > 0) {
          const remaining = existing
            .map((batch) => ({
              ...batch,
              messageIds: batch.messageIds.filter((id) => !receiptIds.has(id)),
            }))
            .filter((batch) => batch.messageIds.length > 0);
          if (remaining.length > 0) {
            deliveryReceiptsBySender.set(meta.uid, remaining);
          } else {
            deliveryReceiptsBySender.delete(meta.uid);
          }
          scheduleSaveRelayQueue();
        }
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      cleanupSocketSubscriptions(socket);
    });
  });

  // Heartbeat keep-alive so disconnected mobile tabs drop promptly and update "last seen"
  setInterval(() => {
    chatWsServer.clients.forEach((socket) => {
      const meta = socketMeta.get(socket);
      if (!meta) return;
      if (!meta.isAlive) {
        socket.terminate();
        return;
      }
      meta.isAlive = false;
      try {
        socket.ping();
      } catch {
        // ignore
      }
    });
  }, 25_000);

  // Expire stale typing/recording statuses promptly
  setInterval(() => {
    if (chatActivityByKey.size === 0) return;
    const now = Date.now();
    chatActivityByKey.forEach((rec) => {
      if (rec.expiresAt <= now) {
        setChatActivityInMemory(rec.actorUid, rec.targetUid, 'idle');
      }
    });
  }, 4_000);

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/ws/chatfi') {
        chatWsServer.handleUpgrade(request, socket, head, (ws) => {
          chatWsServer.emit('connection', ws, request);
        });
      }
    } catch {
      // Ignore malformed upgrade URLs
    }
  });

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
