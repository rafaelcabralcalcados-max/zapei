import type { User } from 'firebase/auth';
import { deleteObject, getBlob, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { ChatMessage } from '../types/zapei';
import {
  auth,
  getDeterministicChatId,
  markChatMessageMediaDelivered,
  sendRealChatMessage,
  storage,
} from './firebase';
import {
  type CachedMediaType,
  getLocalMedia,
  getOrCreateMediaObjectUrl,
  isMediaManuallyDeletedLocally,
  saveLocalMedia,
} from './localMediaCache';
import { blobToDataUrl, dataUrlToBlob } from './phoneUtils';
import { triggerRemoteMessagePush } from './pushService';

/**
 * ZAPEI WHATSAPP-STYLE MEDIA TRANSIT BRIDGE
 * -----------------------------------------
 * 1. Sender saves media IMMEDIATELY to local IndexedDB for instant zero-latency rendering.
 * 2. Sender uploads the binary Blob to temporary Firebase Storage path:
 *      transit_media/{chatId}/{messageId}
 *    and creates the Firestore message with `mediaDelivered: false` and a 14-day retention window
 *    (`mediaExpiresAtMs`) in case the recipient is offline.
 * 3. When the recipient opens the chat or receives the message:
 *    - Downloads the Blob from `transit_media/{chatId}/{messageId}` directly into local IndexedDB;
 *    - Updates Firestore `mediaDelivered: true` (sender sees double blue checks);
 *    - Deletes the temporary file from Firebase Storage immediately so cloud storage stays clean.
 */

export const MAX_IMAGE_WIDTH = 1280;
export const IMAGE_JPEG_QUALITY = 0.8;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB
export const TRANSIT_RETENTION_DAYS = 14;
export const TRANSIT_RETENTION_MS = TRANSIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Safe Firestore direct-delivery ceiling for voice messages & compact photos
// (340 KB binary ≈ 453 KB base64, safely under the 500 KB Firestore message mediaUrl rule)
const INLINE_FALLBACK_MAX_BYTES = 340 * 1024;
let firebaseStorageUnavailable = false;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(label));
    }, ms);
    promise.then(
      (val) => {
        window.clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface SendTransitMediaParams {
  myUid: string;
  myName: string;
  recipientId: string;
  recipientName: string;
  mediaType: CachedMediaType;
  blob: Blob;
  mimeType?: string;
  caption?: string;
  durationLabel?: string;
  fileName?: string;
  authUser: User | null;
}

export interface SendTransitMediaResult {
  messageId: string;
  chatId: string;
  localObjectUrl: string;
  usedStorageTransit: boolean;
}

export async function sendMediaWithTransitBridge(
  params: SendTransitMediaParams
): Promise<SendTransitMediaResult> {
  const {
    myUid,
    myName,
    recipientId,
    recipientName,
    mediaType,
    blob,
    caption,
    durationLabel,
    fileName,
    authUser,
  } = params;

  if (mediaType === 'video' && blob.size > MAX_VIDEO_BYTES) {
    throw new Error('O vídeo ultrapassa o limite de 25 MB. Escolha um vídeo menor.');
  }
  if (blob.size > MAX_MEDIA_BYTES) {
    throw new Error('O arquivo ultrapassa o limite máximo de 25 MB.');
  }

  const mimeType = params.mimeType || blob.type || (
    mediaType === 'image'
      ? 'image/jpeg'
      : mediaType === 'video'
        ? 'video/mp4'
        : 'audio/webm'
  );

  const chatId = getDeterministicChatId(myUid, recipientId);
  const messageId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const transitPath = `transit_media/${chatId}/${messageId}`;
  const expiresAtMs = Date.now() + TRANSIT_RETENTION_MS;

  const isPdfFile =
    mimeType.toLowerCase().includes('pdf') ||
    (fileName ? fileName.toLowerCase().endsWith('.pdf') : false);

  let downloadUrl = '';
  let storedTransitPath: string | undefined = undefined;
  let usedStorageTransit = false;

  // FAST PATH 1: Voice messages & compact images <= 340 KB.
  // Encode Data URL in parallel with local IndexedDB save (~10ms) and send directly
  // in Firestore without stalling 4-10s waiting on Firebase Storage upload/retry.
  const canUseInstantInline =
    !isPdfFile &&
    (mediaType === 'audio' || mediaType === 'image') &&
    blob.size <= INLINE_FALLBACK_MAX_BYTES;

  let localObjectUrl: string;
  if (canUseInstantInline) {
    const [savedUrl, inlineDataUrl] = await Promise.all([
      saveLocalMedia({
        messageId,
        chatId,
        peerUid: recipientId,
        peerName: recipientName,
        senderId: myUid,
        mediaType,
        mimeType,
        blob,
        sizeBytes: blob.size,
        durationLabel,
        caption,
        fileName,
        savedAtMs: Date.now(),
      }),
      blobToDataUrl(blob),
    ]);
    localObjectUrl = savedUrl;
    if (inlineDataUrl.length <= 495000) {
      downloadUrl = inlineDataUrl;
      storedTransitPath = undefined;
      usedStorageTransit = false;
    }
  } else {
    // Save permanent copy immediately in the sender's local IndexedDB
    localObjectUrl = await saveLocalMedia({
      messageId,
      chatId,
      peerUid: recipientId,
      peerName: recipientName,
      senderId: myUid,
      mediaType,
      mimeType,
      blob,
      sizeBytes: blob.size,
      durationLabel,
      caption,
      fileName,
      savedAtMs: Date.now(),
    });
  }

  // FAST PATH 2: Larger audios, videos, PDFs, or > 495k base64 -> fast same-origin transit endpoint FIRST
  if (!downloadUrl) {
    const activeUser = authUser || auth.currentUser;
    if (activeUser) {
      try {
        const token = await activeUser.getIdToken();
        const res = await withTimeout(
          fetch(
            `/api/media/transit/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': mimeType,
              },
              body: blob,
            }
          ),
          mediaType === 'video' ? 45000 : 12000,
          'Same-origin transit upload timeout'
        );
        if (res.ok) {
          const payload = (await res.json()) as { url?: string };
          if (payload.url) {
            downloadUrl = payload.url;
            storedTransitPath = undefined;
            usedStorageTransit = true;
          }
        }
      } catch (serverErr) {
        console.warn('[Zapei Media Transit] Same-origin transit fallback triggered:', serverErr);
      }
    }
  }

  // FALLBACK 3: Firebase Storage transit bucket (only if same-origin transit was unavailable)
  if (!downloadUrl && !firebaseStorageUnavailable) {
    try {
      const storageRef = ref(storage, transitPath);
      const timeoutMs = mediaType === 'video' ? 30000 : 5000;
      downloadUrl = await withTimeout(
        (async () => {
          await uploadBytes(storageRef, blob, {
            contentType: mimeType,
            customMetadata: {
              chatId,
              messageId,
              senderId: myUid,
              recipientId,
              expiresAtMs: String(expiresAtMs),
            },
          });
          return getDownloadURL(storageRef);
        })(),
        timeoutMs,
        'Firebase Storage upload timeout'
      );
      storedTransitPath = transitPath;
      usedStorageTransit = true;
    } catch (uploadError) {
      firebaseStorageUnavailable = true;
      console.error('[Zapei Media Transit] Firebase Storage upload failed:', uploadError);
    }
  }

  if (!downloadUrl) {
    throw new Error(
      'Não foi possível enviar esta mídia agora. Verifique sua conexão com a internet e tente novamente.'
    );
  }

  // Step 3: Create message document in Firestore with mediaDelivered: false
  const textLabel = isPdfFile
    ? caption?.trim() || fileName?.trim() || 'Documento.pdf'
    : mediaType === 'image'
      ? caption?.trim() || 'Foto'
      : mediaType === 'video'
        ? caption?.trim() || (durationLabel ? `Vídeo (${durationLabel})` : 'Vídeo')
        : `Mensagem de voz (${durationLabel || '0:00'})`;

  const pushPreviewText = isPdfFile
    ? `PDF: ${caption?.trim() || fileName?.trim() || 'Documento.pdf'}`
    : mediaType === 'image'
      ? caption?.trim()
        ? `Foto: ${caption.trim()}`
        : 'Enviou uma foto'
      : mediaType === 'video'
        ? caption?.trim()
          ? `Vídeo: ${caption.trim()}`
          : 'Enviou um vídeo'
        : `Áudio (${durationLabel || '0:00'})`;

  await sendRealChatMessage({
    myUid,
    myName,
    otherUid: recipientId,
    otherName: recipientName,
    type: mediaType,
    text: textLabel,
    mediaUrl: downloadUrl,
    audioDuration: mediaType === 'audio' ? durationLabel : undefined,
    videoDuration: mediaType === 'video' ? durationLabel : undefined,
    mediaTransitPath: storedTransitPath,
    mediaDelivered: false,
    mediaSizeBytes: blob.size,
    mediaMimeType: mimeType,
    mediaExpiresAtMs: expiresAtMs,
    customMessageId: messageId,
  });

  if (authUser) {
    void triggerRemoteMessagePush(authUser, {
      recipientId,
      senderName: myName,
      previewText: pushPreviewText,
      messageType: mediaType,
    });
  }

  return {
    messageId,
    chatId,
    localObjectUrl,
    usedStorageTransit,
  };
}

export type MediaResolveStatus =
  | 'ready'
  | 'downloading'
  | 'deleted_locally'
  | 'expired'
  | 'offline_waiting'
  | 'error';

export interface MediaResolveResult {
  status: MediaResolveStatus;
  url?: string;
  sizeBytes?: number;
  mimeType?: string;
}

const inFlightDownloads = new Map<string, Promise<MediaResolveResult>>();

async function downloadTransitBlob(msg: ChatMessage): Promise<Blob | null> {
  // 1. Legacy or inline fallback Data URL
  if (msg.mediaUrl && msg.mediaUrl.startsWith('data:')) {
    return dataUrlToBlob(msg.mediaUrl);
  }

  // 2. Primary: Firebase Storage SDK getBlob on transit_media/{chatId}/{messageId}
  if (msg.mediaTransitPath) {
    try {
      const storageRef = ref(storage, msg.mediaTransitPath);
      return await getBlob(storageRef);
    } catch {
      // Fall back to HTTPS download URL if getBlob fails
    }
  }

  // 3. Fallback: direct fetch of download URL or authenticated same-origin transit endpoint
  if (msg.mediaUrl && msg.mediaUrl.startsWith('/api/media/transit/')) {
    const token = await auth.currentUser?.getIdToken().catch(() => '');
    if (!token) return null;
    const response = await fetch(msg.mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return await response.blob();
  }

  if (msg.mediaUrl && (msg.mediaUrl.startsWith('https://') || msg.mediaUrl.startsWith('http://'))) {
    const response = await fetch(msg.mediaUrl);
    if (!response.ok) return null;
    return await response.blob();
  }

  return null;
}

/**
 * Resolves a media message (photo, audio, or video) using WhatsApp-style local-first delivery:
 * - Always checks IndexedDB first for instantaneous zero-network playback.
 * - For incoming undelivered media, downloads to IndexedDB, sets `mediaDelivered: true`
 *   in Firestore (blue double checks), and deletes the temporary `transit_media/` cloud object.
 */
export async function receiveAndDeliverTransitMedia(params: {
  msg: ChatMessage;
  myUid: string;
  peerUid: string;
  peerName: string;
}): Promise<MediaResolveResult> {
  const { msg, myUid, peerUid, peerName } = params;

  if (msg.type !== 'image' && msg.type !== 'audio' && msg.type !== 'video') {
    return { status: 'error' };
  }
  const mediaType: CachedMediaType = msg.type;

  // Fast path 1: Already cached permanently in this device's IndexedDB
  const cached = await getLocalMedia(msg.id);
  if (cached?.blob) {
    const fallbackMime =
      mediaType === 'audio' ? 'audio/webm' : mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
    const effectiveMime =
      (cached.mimeType && cached.mimeType !== 'application/octet-stream' ? cached.mimeType : '') ||
      (msg.mediaMimeType && msg.mediaMimeType !== 'application/octet-stream'
        ? msg.mediaMimeType
        : '') ||
      fallbackMime;
    return {
      status: 'ready',
      url: getOrCreateMediaObjectUrl(msg.id, cached.blob, effectiveMime),
      sizeBytes: cached.sizeBytes || cached.blob.size,
      mimeType: effectiveMime,
    };
  }

  // Fast path 2: User explicitly deleted this file from this device in Storage Manager
  if (isMediaManuallyDeletedLocally(msg.id)) {
    return { status: 'deleted_locally' };
  }

  // Deduplicate concurrent downloads for the same messageId
  const existingPromise = inFlightDownloads.get(msg.id);
  if (existingPromise) return existingPromise;

  const task = (async (): Promise<MediaResolveResult> => {
    const isSender = msg.senderId === myUid;

    // If this is the sender (e.g., opened on another device or cleared storage):
    if (isSender) {
      // If still in cloud transit (not delivered yet) or legacy inline URL, cache locally without deleting cloud!
      const hasSource = Boolean(msg.mediaUrl || (msg.mediaTransitPath && msg.mediaDelivered === false));
      if (!hasSource) {
        return { status: 'deleted_locally' };
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine && !msg.mediaUrl?.startsWith('data:')) {
        return { status: 'offline_waiting' };
      }
      try {
        const blob = await downloadTransitBlob(msg);
        if (!blob) return { status: 'deleted_locally' };
        const fallbackMime =
          mediaType === 'audio' ? 'audio/webm' : mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
        const effectiveMime =
          (msg.mediaMimeType && msg.mediaMimeType !== 'application/octet-stream'
            ? msg.mediaMimeType
            : '') ||
          (blob.type && blob.type !== 'application/octet-stream' ? blob.type : '') ||
          fallbackMime;
        const url = await saveLocalMedia({
          messageId: msg.id,
          chatId: msg.chatId,
          peerUid,
          peerName,
          senderId: msg.senderId,
          mediaType,
          mimeType: effectiveMime,
          blob,
          sizeBytes: blob.size,
          durationLabel: msg.audioDuration || msg.videoDuration,
          caption: msg.text,
          savedAtMs: Date.now(),
        });
        return { status: 'ready', url, sizeBytes: blob.size, mimeType: effectiveMime };
      } catch {
        return { status: 'deleted_locally' };
      }
    }

    // Recipient flow:
    // If already marked delivered and not in local IndexedDB (and no legacy mediaUrl remains)
    if (msg.mediaDelivered === true && !msg.mediaUrl) {
      return { status: 'deleted_locally' };
    }

    // Check 14-day cloud transit expiration when recipient stayed offline > 14 days
    if (msg.mediaExpiresAtMs && Date.now() > msg.mediaExpiresAtMs && !msg.mediaUrl?.startsWith('data:')) {
      return { status: 'expired' };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine && !msg.mediaUrl?.startsWith('data:')) {
      return { status: 'offline_waiting' };
    }

    try {
      const blob = await downloadTransitBlob(msg);
      if (!blob) {
        if (msg.mediaExpiresAtMs && Date.now() > msg.mediaExpiresAtMs) {
          return { status: 'expired' };
        }
        return { status: 'deleted_locally' };
      }

      // 1) Save permanently in recipient's local IndexedDB
      const fallbackMime =
        mediaType === 'audio' ? 'audio/webm' : mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
      const effectiveMime =
        (msg.mediaMimeType && msg.mediaMimeType !== 'application/octet-stream'
          ? msg.mediaMimeType
          : '') ||
        (blob.type && blob.type !== 'application/octet-stream' ? blob.type : '') ||
        fallbackMime;
      const url = await saveLocalMedia({
        messageId: msg.id,
        chatId: msg.chatId,
        peerUid,
        peerName,
        senderId: msg.senderId,
        mediaType,
        mimeType: effectiveMime,
        blob,
        sizeBytes: blob.size,
        durationLabel: msg.audioDuration || msg.videoDuration,
        caption: msg.text,
        savedAtMs: Date.now(),
      });

      // 2) Confirm delivery in Firestore -> mediaDelivered: true (blue double checks for sender)
      if (msg.mediaDelivered === false) {
        await markChatMessageMediaDelivered(msg.chatId, msg.id);
      }

      // 3) Automatically delete temporary file from Firebase Storage transit_media/ or server transit
      if (msg.mediaTransitPath) {
        try {
          await deleteObject(ref(storage, msg.mediaTransitPath));
        } catch {
          // Ignore storage/object-not-found or transient errors
        }
      }
      if (msg.mediaUrl && msg.mediaUrl.startsWith('/api/media/transit/')) {
        try {
          const token = await auth.currentUser?.getIdToken().catch(() => '');
          if (token) {
            await fetch(msg.mediaUrl, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        } catch {
          // Ignore cleanup errors
        }
      }

      return { status: 'ready', url, sizeBytes: blob.size, mimeType: blob.type };
    } catch {
      return { status: 'error' };
    }
  })();

  inFlightDownloads.set(msg.id, task);
  try {
    return await task;
  } finally {
    inFlightDownloads.delete(msg.id);
  }
}
