import 'dotenv/config';
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

// Load Firebase projectId (used ONLY for stateless verifyIdToken — needs zero IAM)
const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
const firebaseAppletConfig = JSON.parse(
  fs.readFileSync(firebaseConfigPath, 'utf-8')
) as { projectId?: string };

const adminApp = getApps().length
  ? getApp()
  : initializeApp({ projectId: firebaseAppletConfig.projectId });
const adminAuth = getAuth(adminApp);

// --- Persistent VAPID Keys (W3C Web Push for Android Chrome, iOS 16.4+ PWA, Desktop) ---
const vapidStorePath = path.resolve(__dirname, '.zapei-vapid.json');

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function loadOrCreateVapidKeys(): VapidKeys {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
    };
  }
  if (fs.existsSync(vapidStorePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(vapidStorePath, 'utf-8')) as VapidKeys;
      if (saved.publicKey && saved.privateKey) return saved;
    } catch {
      // regenerate below
    }
  }
  const generated = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidStorePath, JSON.stringify(generated, null, 2), { mode: 0o600 });
  return generated;
}

const vapidKeys = loadOrCreateVapidKeys();
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:contato@zapei.app';
webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);

// --- Persistent Per-User Push Subscription Store ---
const subsStorePath = path.resolve(__dirname, '.zapei-push-subs.json');

type SubscriptionMap = Record<string, WebPushSubscription[]>;

function loadSubscriptions(): SubscriptionMap {
  if (!fs.existsSync(subsStorePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(subsStorePath, 'utf-8')) as SubscriptionMap;
  } catch {
    return {};
  }
}

function saveSubscriptions(map: SubscriptionMap): void {
  fs.writeFileSync(subsStorePath, JSON.stringify(map, null, 2), { mode: 0o600 });
}

const subscriptionsByUid: SubscriptionMap = loadSubscriptions();

// --- Authenticated Express Request Helper ---
interface AuthenticatedRequest extends Request {
  verifiedUid?: string;
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
    next();
  } catch {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

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

async function dispatchPushToUser(
  targetUid: string,
  payload: Record<string, unknown>,
  options: { ttl: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; topic?: string }
): Promise<{ sent: number; removed: number }> {
  const subs = subscriptionsByUid[targetUid] || [];
  if (subs.length === 0) return { sent: 0, removed: 0 };

  const jsonPayload = JSON.stringify(payload);
  let sent = 0;
  const validRemaining: WebPushSubscription[] = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, jsonPayload, {
        TTL: options.ttl,
        urgency: options.urgency,
        topic: options.topic,
      });
      sent += 1;
      validRemaining.push(sub);
    } catch (err) {
      const statusCode =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? Number((err as { statusCode?: unknown }).statusCode)
          : 0;
      // Prune permanently expired/unsubscribed endpoints (404 / 410)
      if (statusCode !== 404 && statusCode !== 410) {
        validRemaining.push(sub);
      }
    }
  }

  const removed = subs.length - validRemaining.length;
  if (removed > 0) {
    subscriptionsByUid[targetUid] = validRemaining;
    saveSubscriptions(subscriptionsByUid);
  }
  return { sent, removed };
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // 1. Public VAPID Key for browser PushManager.subscribe()
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  // 2. Register authenticated user's device PushSubscription
  app.post('/api/push/subscribe', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    const uid = req.verifiedUid!;
    const sub = req.body?.subscription;
    if (!isValidPushSubscription(sub)) {
      res.status(400).json({ error: 'Inscrição Web Push inválida.' });
      return;
    }

    const existing = subscriptionsByUid[uid] || [];
    const deduped = existing.filter((item) => item.endpoint !== sub.endpoint);
    deduped.push(sub);
    // Keep up to 6 devices per user
    subscriptionsByUid[uid] = deduped.slice(-6);
    saveSubscriptions(subscriptionsByUid);
    res.json({ ok: true, devices: subscriptionsByUid[uid].length });
  });

  // 3. Remove device subscription
  app.post('/api/push/unsubscribe', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    const uid = req.verifiedUid!;
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (endpoint && subscriptionsByUid[uid]) {
      subscriptionsByUid[uid] = subscriptionsByUid[uid].filter(
        (item) => item.endpoint !== endpoint
      );
      saveSubscriptions(subscriptionsByUid);
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
          { ttl: 30, urgency: 'high' }
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
          ttl: 30,
          urgency: 'high',
        }
      );

    // Pulse #1 immediately
    const firstResult = await sendRingPulse(1);

    // Repeat ringing pulses every 3.5 seconds (up to 7 total pulses ~24s) so the locked phone rings repeatedly
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
      }, 3500);
      activeCallRingLoops.set(callId, { timer, callerId: actorUid, calleeId });
    }

    res.json({ ok: true, ...firstResult });
  });

  // 5. Real background chat message push alert
  app.post(
    '/api/push/notify-message',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res) => {
      const senderId = req.verifiedUid!;
      const recipientId =
        typeof req.body?.recipientId === 'string' ? req.body.recipientId.slice(0, 128) : '';
      const senderName =
        typeof req.body?.senderName === 'string' ? req.body.senderName.slice(0, 80) : 'Zapei';
      const previewText =
        typeof req.body?.previewText === 'string'
          ? req.body.previewText.slice(0, 180)
          : 'Nova mensagem';

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
        },
        { ttl: 3600, urgency: 'high' }
      );

      res.json({ ok: true, ...result });
    }
  );

  const httpServer = http.createServer(app);

  // Mount Vite middleware in dev OR serve dist/ in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Zapei server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
