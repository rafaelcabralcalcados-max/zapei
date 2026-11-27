/**
 * WhatsApp-style presence & status formatting utilities for ChatFi.
 * - Sanitizes any legacy "Zapei" brand strings persisted in Firestore statusMessage.
 * - Formats live "online" and "visto por último hoje/ontem/em DD/MM às HH:mm".
 * - Respects user privacy choices (showOnlineStatus / showLastSeen).
 */

export const DEFAULT_STATUS_MESSAGE = 'Disponível';

/**
 * Heartbeat freshness window (6 minutes). Heartbeats run every 5 minutes while the tab
 * is active, keeping "online" accurate while minimizing Firestore write units.
 */
export const ONLINE_FRESHNESS_MS = 6 * 60 * 1000;

export interface PresenceSnapshot {
  isOnline?: boolean;
  lastSeenAt?: number;
  showOnlineStatus?: boolean;
  showLastSeen?: boolean;
  statusMessage?: string;
}

/**
 * Normalizes legacy status messages saved before the ChatFi rebrand
 * (e.g. "Disponível no Zapei" -> "Disponível") while keeping custom user bios intact.
 */
export function sanitizeStatusMessage(raw?: string | null): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return DEFAULT_STATUS_MESSAGE;

  const lower = trimmed.toLowerCase();
  if (
    lower === 'disponível no zapei' ||
    lower === 'disponivel no zapei' ||
    lower === 'disponível no chatfi' ||
    lower === 'disponivel no chatfi' ||
    lower === 'no zapei' ||
    lower === 'online no zapei'
  ) {
    return DEFAULT_STATUS_MESSAGE;
  }

  if (/zapei/i.test(trimmed)) {
    return trimmed.replace(/zapei/gi, 'ChatFi');
  }

  return trimmed;
}

/**
 * Returns true ONLY if the user allows showing online status, is marked online,
 * and their last heartbeat is fresh.
 */
export function isUserEffectivelyOnline(
  presence?: PresenceSnapshot | null,
  nowMs: number = Date.now()
): boolean {
  if (!presence) return false;
  if (presence.showOnlineStatus === false) return false;
  if (!presence.isOnline) return false;
  const lastSeen = Number(presence.lastSeenAt || 0);
  if (lastSeen <= 0) return false;
  return nowMs - lastSeen <= ONLINE_FRESHNESS_MS;
}

/**
 * Formats a timestamp in WhatsApp pt-BR style:
 * - "visto por último hoje às 14:32"
 * - "visto por último ontem às 21:05"
 * - "visto por último em 19/11 às 09:40"
 */
export function formatLastSeenPtBr(
  lastSeenAtMs: number,
  nowMs: number = Date.now()
): string {
  if (!lastSeenAtMs || lastSeenAtMs <= 0) return '';

  const target = new Date(lastSeenAtMs);
  const now = new Date(nowMs);

  const hh = String(target.getHours()).padStart(2, '0');
  const mm = String(target.getMinutes()).padStart(2, '0');
  const timeStr = `${hh}:${mm}`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime();
  const dayDiff = Math.round((startOfToday - startOfTarget) / (24 * 60 * 60 * 1000));

  if (dayDiff <= 0) {
    return `visto por último hoje às ${timeStr}`;
  }
  if (dayDiff === 1) {
    return `visto por último ontem às ${timeStr}`;
  }

  const dd = String(target.getDate()).padStart(2, '0');
  const mo = String(target.getMonth() + 1).padStart(2, '0');
  if (target.getFullYear() === now.getFullYear()) {
    return `visto por último em ${dd}/${mo} às ${timeStr}`;
  }

  return `visto por último em ${dd}/${mo}/${target.getFullYear()} às ${timeStr}`;
}

export interface FormattedPresence {
  /** Text to display under the contact's name (e.g. "online", "visto por último hoje às 14:32", or fallback). */
  label: string;
  /** True when the peer is actively online and visible. */
  isOnline: boolean;
  /** True when label is real presence info ("online" or "visto por último..."). */
  isPresence: boolean;
}

/**
 * Computes WhatsApp-style presence display for a contact/peer.
 * Respects both the peer's privacy preferences and optional fallback text.
 */
export function getContactPresenceDisplay(
  presence?: PresenceSnapshot | null,
  options?: {
    fallback?: string;
    nowMs?: number;
  }
): FormattedPresence {
  const nowMs = options?.nowMs ?? Date.now();

  if (presence) {
    if (isUserEffectivelyOnline(presence, nowMs)) {
      return {
        label: 'online',
        isOnline: true,
        isPresence: true,
      };
    }

    const canShowLastSeen = presence.showLastSeen !== false;
    const lastSeen = Number(presence.lastSeenAt || 0);
    if (canShowLastSeen && lastSeen > 0) {
      const formatted = formatLastSeenPtBr(lastSeen, nowMs);
      if (formatted) {
        return {
          label: formatted,
          isOnline: false,
          isPresence: true,
        };
      }
    }
  }

  const fallbackText =
    options?.fallback?.trim() ||
    (presence?.statusMessage ? sanitizeStatusMessage(presence.statusMessage) : DEFAULT_STATUS_MESSAGE);

  return {
    label: fallbackText,
    isOnline: false,
    isPresence: false,
  };
}
