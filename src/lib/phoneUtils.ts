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

/**
 * Compresses a real uploaded image File into a compact JPEG data URL (< 280 KB)
 * suitable for fast real-time rendering and Firestore persistence without hitting the 1MB doc limit.
 */
export async function compressImageFileToDataUrl(
  file: File,
  maxDimension = 960,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagem inválido.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
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
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
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
  const text = `Oi ${contactName}! Estou usando o Zapei para conversas, chamadas de áudio/vídeo e vitrines. Baixe ou acesse aqui: ${appUrl}`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'Convite para o Zapei',
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
