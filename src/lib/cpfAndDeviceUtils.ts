export interface LocalDeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
}

export interface ParsedDeviceAuthQrPayload {
  requestId: string;
  requestToken: string;
  code6: string;
}

const LOCAL_DEVICE_ID_KEY = 'zapei_device_id_v1';

/**
 * Strips all non-numeric characters and keeps up to 11 digits.
 */
export function cleanCpfDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 11);
}

/**
 * Formats a CPF input with the Brazilian mask 000.000.000-00.
 */
export function formatCpfMask(raw: string): string {
  const digits = cleanCpfDigits(raw);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

/**
 * Real mathematical validation of Brazilian CPF check digits (Receita Federal mod-11).
 */
export function isValidCpf(raw: string): boolean {
  const cpf = cleanCpfDigits(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(cpf[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(cpf[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  return remainder === Number(cpf[10]);
}

/**
 * Generates an LGPD-safe SHA-256 hex digest of the 11 clean CPF digits.
 * Raw CPF is NEVER written to Firestore.
 */
export async function hashCpfSha256(raw: string): Promise<string> {
  const clean = cleanCpfDigits(raw);
  if (clean.length !== 11) return '';
  const data = new TextEncoder().encode(`zapei-cpf-v1:${clean}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Returns true if the string begins with a ChatFi (CFI-) or legacy (ZAP-) virtual line prefix.
 */
export function isVirtualLinePrefix(raw: string): boolean {
  const upper = raw.trim().toUpperCase();
  return upper.startsWith('CFI-') || upper.startsWith('ZAP-');
}

/**
 * Validates whether a string matches the full virtual line format (CFI-XXXX-XXXX or legacy ZAP-XXXX-XXXX).
 */
export function isVirtualLineFormat(raw: string): boolean {
  return /^(CFI|ZAP)-\d{4}-\d{4}$/i.test(raw.trim());
}

/**
 * Generates an exclusive ChatFi Virtual Line in the format CFI-XXXX-XXXX.
 */
export function generateVirtualLine(): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  const part1 = String(1000 + (bytes[0] % 9000));
  const part2 = String(1000 + (bytes[1] % 9000));
  return `CFI-${part1}-${part2}`;
}

/**
 * Masks an email address for user-friendly password reset confirmation.
 */
export function maskEmailForDisplay(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

/**
 * Generates a cryptographically secure 6-digit numeric authorization code.
 */
export function generateSixDigitCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1000000).padStart(6, '0');
}

/**
 * Generates a cryptographically strong random token for auth_requests QR linking.
 */
export function generateRequestToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function detectDeviceLabelAndPlatform(): { deviceName: string; platform: string } {
  if (typeof navigator === 'undefined') {
    return { deviceName: 'Navegador Web', platform: 'Web' };
  }
  const ua = navigator.userAgent || '';

  let os = 'Dispositivo';
  let platform = 'Web';
  if (/iPhone/i.test(ua)) {
    os = 'iPhone';
    platform = 'iOS';
  } else if (/iPad/i.test(ua)) {
    os = 'iPad';
    platform = 'iPadOS';
  } else if (/Android/i.test(ua)) {
    os = 'Celular Android';
    platform = 'Android';
  } else if (/Windows/i.test(ua)) {
    os = 'PC Windows';
    platform = 'Windows';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'Mac';
    platform = 'macOS';
  } else if (/Linux/i.test(ua)) {
    os = 'PC Linux';
    platform = 'Linux';
  }

  let browser = 'Navegador';
  if (/Edg\//i.test(ua)) {
    browser = 'Edge';
  } else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/Firefox\//i.test(ua) || /FxiOS/i.test(ua)) {
    browser = 'Firefox';
  } else if (/CriOS/i.test(ua) || (/Chrome\//i.test(ua) && !/Edg\//i.test(ua))) {
    browser = 'Chrome';
  } else if (/Safari\//i.test(ua)) {
    browser = 'Safari';
  }

  return {
    deviceName: `${os} - ${browser}`,
    platform,
  };
}

/**
 * Gets or creates the persistent local deviceId and human-readable device label.
 */
export function getOrCreateLocalDeviceInfo(): LocalDeviceInfo {
  const { deviceName, platform } = detectDeviceLabelAndPlatform();
  let deviceId = '';
  try {
    deviceId = localStorage.getItem(LOCAL_DEVICE_ID_KEY) || '';
    if (!deviceId || !/^[a-zA-Z0-9_-]{8,100}$/.test(deviceId)) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      const suffix = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      deviceId = `dev_${suffix}`;
      localStorage.setItem(LOCAL_DEVICE_ID_KEY, deviceId);
    }
  } catch {
    deviceId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  return {
    deviceId,
    deviceName,
    platform,
  };
}

export function encodeDeviceAuthQrPayload(params: {
  requestId: string;
  requestToken: string;
  code6: string;
}): string {
  return `CHATFI_AUTH|v1|${params.requestId}|${params.requestToken}|${params.code6}`;
}

export function parseDeviceAuthQrPayload(raw: string): ParsedDeviceAuthQrPayload | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('CHATFI_AUTH|v1|') && !trimmed.startsWith('ZAPEI_AUTH|v1|')) return null;
  const parts = trimmed.split('|');
  if (parts.length !== 5) return null;
  const [, , requestId, requestToken, code6] = parts;
  if (!requestId || !requestToken || !/^\d{6}$/.test(code6)) return null;
  return { requestId, requestToken, code6 };
}
