/**
 * Real phone normalization, SHA-256 hashing for privacy-preserving Firestore lookup,
 * real W3C Contact Picker API + real vCard (.vcf) phonebook import,
 * real image compression, and real audio/file helpers.
 */

export function normalizePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Strip leading 0 from Brazilian national format (e.g. 037984128682)
  if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
    return `55${digits.slice(1)}`;
  }
  // Strip Brazilian carrier selection prefix (e.g. 01537984128682 or 02137984128682)
  if (digits.startsWith('0') && (digits.length === 13 || digits.length === 14)) {
    return `55${digits.slice(3)}`;
  }
  // Default Brazil country code (55) when 10 or 11 local digits are provided
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

export function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return raw.trim();
}

export async function hashPhoneNumber(rawPhone: string): Promise<string> {
  const normalized = normalizePhoneDigits(rawPhone);
  if (!normalized) return '';
  const data = new TextEncoder().encode(`zapei_phone_v1:${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface ImportedPhonebookContact {
  name: string;
  phone: string;
}

interface NavigatorWithContacts extends Navigator {
  contacts?: {
    select: (
      properties: string[],
      options?: { multiple?: boolean }
    ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
  };
}

export function supportsNativeContactPicker(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'contacts' in navigator &&
    typeof (navigator as NavigatorWithContacts).contacts?.select === 'function'
  );
}

/**
 * Invokes the real browser/mobile Contact Picker API (Android Chrome / supported PWAs).
 */
export async function pickRealDeviceContacts(): Promise<ImportedPhonebookContact[]> {
  const nav = navigator as NavigatorWithContacts;
  if (!nav.contacts?.select) {
    throw new Error('UNSUPPORTED_CONTACT_PICKER');
  }
  const picked = await nav.contacts.select(['name', 'tel'], { multiple: true });
  const results: ImportedPhonebookContact[] = [];
  for (const entry of picked) {
    const name = entry.name?.[0]?.trim() || '';
    const phones = entry.tel ?? [];
    for (const tel of phones) {
      const cleaned = tel.trim();
      if (cleaned && normalizePhoneDigits(cleaned).length >= 8) {
        results.push({
          name: name || formatPhoneDisplay(cleaned),
          phone: formatPhoneDisplay(cleaned),
        });
        break;
      }
    }
  }
  return results;
}

/**
 * Parses a real .vcf (vCard 2.1 / 3.0 / 4.0) file exported from Android, iOS, or Google Contacts.
 */
export function parseVCardText(vcfContent: string): ImportedPhonebookContact[] {
  const cards = vcfContent.split(/BEGIN:VCARD/i).slice(1);
  const parsed: ImportedPhonebookContact[] = [];

  for (const card of cards) {
    const lines = card.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
    let name = '';
    let phone = '';

    for (const line of lines) {
      const upper = line.toUpperCase();
      if (upper.startsWith('FN:') || upper.startsWith('FN;')) {
        const idx = line.indexOf(':');
        if (idx >= 0) name = line.slice(idx + 1).trim();
      } else if (!name && (upper.startsWith('N:') || upper.startsWith('N;'))) {
        const idx = line.indexOf(':');
        if (idx >= 0) {
          const parts = line
            .slice(idx + 1)
            .split(';')
            .map((p) => p.trim())
            .filter(Boolean);
          name = parts.reverse().join(' ').trim();
        }
      } else if (!phone && (upper.startsWith('TEL:') || upper.startsWith('TEL;'))) {
        const idx = line.indexOf(':');
        if (idx >= 0) {
          const rawTel = line.slice(idx + 1).trim();
          if (normalizePhoneDigits(rawTel).length >= 8) {
            phone = formatPhoneDisplay(rawTel);
          }
        }
      }
    }

    if (phone) {
      parsed.push({
        name: name || phone,
        phone,
      });
    }
  }

  return parsed;
}

function drawImageHighQuality(
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  // Multi-step halving downscale prevents aliasing/blurriness when resizing
  // high-megapixel phone camera photos (e.g. 4000px -> 1080px).
  let currentSource: CanvasImageSource = img;
  let curW = img.naturalWidth || img.width;
  let curH = img.naturalHeight || img.height;

  while (curW > targetWidth * 2 && curH > targetHeight * 2) {
    const nextW = Math.max(targetWidth, Math.round(curW / 2));
    const nextH = Math.max(targetHeight, Math.round(curH / 2));
    const stepCanvas = document.createElement('canvas');
    stepCanvas.width = nextW;
    stepCanvas.height = nextH;
    const stepCtx = stepCanvas.getContext('2d');
    if (!stepCtx) break;
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(currentSource, 0, 0, nextW, nextH);
    currentSource = stepCanvas;
    curW = nextW;
    curH = nextH;
  }

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetWidth;
  finalCanvas.height = targetHeight;
  const ctx = finalCanvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(currentSource, 0, 0, targetWidth, targetHeight);
  }
  return finalCanvas;
}

/**
 * Compresses a real uploaded image File into a crisp JPEG data URL using
 * high-quality multi-step resampling suitable for Retina displays and Firestore persistence.
 */
export async function compressImageFileToDataUrl(
  file: File,
  maxDimension = 960,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Formato de imagem inválido.'));
    };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.max(1, Math.round((height * maxDimension) / width));
          width = maxDimension;
        } else {
          width = Math.max(1, Math.round((width * maxDimension) / height));
          height = maxDimension;
        }
      }
      const canvas = drawImageHighQuality(img, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl);
    };
    img.src = objectUrl;
  });
}

/**
 * Encodes a user profile avatar at Full HD (up to 1080px, high JPEG quality)
 * so enlarged profile views look razor sharp on Retina phones while staying
 * safely below Firestore's 450,000-char avatar field cap.
 */
export async function compressAvatarImageHD(
  file: File,
  maxDataUrlChars = 440000
): Promise<string> {
  const attempts: Array<[number, number]> = [
    [1080, 0.9],
    [1080, 0.84],
    [960, 0.84],
    [840, 0.82],
    [720, 0.78],
    [600, 0.74],
  ];
  let lastResult = '';
  for (const [dim, q] of attempts) {
    lastResult = await compressImageFileToDataUrl(file, dim, q);
    if (lastResult.length <= maxDataUrlChars) {
      return lastResult;
    }
  }
  return lastResult;
}

/**
 * Iteratively compresses an image File until its base64 Data URL fits safely inside
 * Firestore's field size limit (default 320,000 chars < 350,000 limit).
 */
export async function compressImageFileToMaxBytes(
  file: File,
  maxDataUrlChars = 320000
): Promise<string> {
  const attempts: Array<[number, number]> = [
    [960, 0.8],
    [840, 0.74],
    [680, 0.66],
    [540, 0.58],
    [420, 0.5],
  ];
  let lastResult = '';
  for (const [dim, q] of attempts) {
    lastResult = await compressImageFileToDataUrl(file, dim, q);
    if (lastResult.length <= maxDataUrlChars) {
      return lastResult;
    }
  }
  return lastResult;
}

/**
 * Compresses an uploaded image File to JPEG Blob (max width/dimension 1280px, quality 0.8)
 * for WhatsApp-style local IndexedDB storage + Firebase Storage transit delivery.
 */
export async function compressImageFileToBlob(
  file: File,
  maxWidth = 1280,
  quality = 0.8
): Promise<{ blob: Blob; width: number; height: number; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Formato de imagem inválido.'));
    };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxWidth || height > maxWidth) {
        if (width >= height) {
          height = Math.max(1, Math.round((height * maxWidth) / width));
          width = maxWidth;
        } else {
          width = Math.max(1, Math.round((width * maxWidth) / height));
          height = maxWidth;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Não foi possível processar a imagem.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Falha ao comprimir a imagem.'));
            return;
          }
          resolve({ blob, width, height, mimeType: 'image/jpeg' });
        },
        'image/jpeg',
        quality
      );
    };
    img.src = objectUrl;
  });
}

/**
 * Converts a base64 Data URL (e.g. legacy media) into a binary Blob for IndexedDB storage.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const header = parts[0] || '';
  const body = parts[1] || '';
  const mimeMatch = /data:([^;]+)/i.exec(header);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(body);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Reads the duration of a local video File/Blob as a short label (e.g. "0:24").
 */
export async function extractVideoDurationLabel(file: Blob): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };
    video.onloadedmetadata = () => {
      const secs = Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration)) : 0;
      cleanup();
      if (secs <= 0) {
        resolve('');
        return;
      }
      const mins = Math.floor(secs / 60);
      const rem = secs % 60;
      resolve(`${mins}:${rem.toString().padStart(2, '0')}`);
    };
    video.onerror = () => {
      cleanup();
      resolve('');
    };
    video.src = url;
  });
}

/**
 * Converts a real recorded MediaRecorder audio Blob into a base64 Data URL for real playback.
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao processar gravação de áudio.'));
    reader.onloadend = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

/**
 * Real native invite using Web Share API, falling back to clipboard + SMS URI.
 */
export async function shareRealZapeiInvite(
  contactName: string,
  contactPhone: string
): Promise<'shared' | 'copied'> {
  const appUrl = window.location.origin;
  const text = `Oi ${contactName}! Estou usando o ChatFi para conversas, chamadas de áudio/vídeo e vitrines. Baixe ou acesse aqui: ${appUrl}`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'Convite para o ChatFi',
        text,
        url: appUrl,
      });
      return 'shared';
    } catch {
      // User cancelled share sheet or unsupported in iframe; fall back to clipboard
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const digits = normalizePhoneDigits(contactPhone);
    const link = document.createElement('a');
    link.href = `sms:+${digits}?body=${encodeURIComponent(text)}`;
    link.click();
  }
  return 'copied';
}
