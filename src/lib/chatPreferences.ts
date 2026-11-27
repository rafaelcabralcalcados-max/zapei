import type { User } from 'firebase/auth';
import type { ChatCustomList, UserChatPreferences } from '../types/zapei';

const LS_KEY_PREFIX = 'chatfi_chat_prefs_v1_';

export const DEFAULT_CHAT_PREFS: UserChatPreferences = {
  pinnedChatIds: [],
  archivedChatIds: [],
  mutedChatIds: [],
  favoriteChatIds: [],
  unreadChatIds: [],
  lockedChatIds: [],
  lockPinHash: undefined,
  clearedAtByChatId: {},
  hiddenChatIds: {},
  blockedUids: [],
  blockedAtByUid: {},
  customLists: [],
  shortcutChatIds: [],
  updatedAtMs: 0,
};

function cleanIdArray(raw: unknown, maxLen = 1000): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 260 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= maxLen) break;
  }
  return out;
}

function cleanTimestampRecord(raw: unknown, maxEntries = 1000): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    const num = Number(v);
    if (!key || key.length > 260 || !Number.isFinite(num) || num <= 0) continue;
    out[key] = Math.round(num);
    count += 1;
    if (count >= maxEntries) break;
  }
  return out;
}

function cleanCustomLists(raw: unknown): ChatCustomList[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ChatCustomList[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<ChatCustomList>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 80) : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, 48) : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      chatIds: cleanIdArray(candidate.chatIds, 500),
      createdAtMs:
        typeof candidate.createdAtMs === 'number' && Number.isFinite(candidate.createdAtMs)
          ? Math.round(candidate.createdAtMs)
          : Date.now(),
    });
    if (out.length >= 30) break;
  }
  return out;
}

export function sanitizeChatPrefs(raw: unknown): UserChatPreferences {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CHAT_PREFS };
  }
  const obj = raw as Partial<UserChatPreferences>;
  const lockPinHash =
    typeof obj.lockPinHash === 'string' && obj.lockPinHash.trim().length >= 16
      ? obj.lockPinHash.trim().slice(0, 128)
      : undefined;
  return {
    pinnedChatIds: cleanIdArray(obj.pinnedChatIds),
    archivedChatIds: cleanIdArray(obj.archivedChatIds),
    mutedChatIds: cleanIdArray(obj.mutedChatIds),
    favoriteChatIds: cleanIdArray(obj.favoriteChatIds),
    unreadChatIds: cleanIdArray(obj.unreadChatIds),
    lockedChatIds: cleanIdArray(obj.lockedChatIds),
    lockPinHash,
    clearedAtByChatId: cleanTimestampRecord(obj.clearedAtByChatId),
    hiddenChatIds: cleanTimestampRecord(obj.hiddenChatIds),
    blockedUids: cleanIdArray(obj.blockedUids),
    blockedAtByUid: cleanTimestampRecord(obj.blockedAtByUid),
    customLists: cleanCustomLists(obj.customLists),
    shortcutChatIds: cleanIdArray(obj.shortcutChatIds, 100),
    updatedAtMs:
      typeof obj.updatedAtMs === 'number' && Number.isFinite(obj.updatedAtMs)
        ? Math.round(obj.updatedAtMs)
        : 0,
  };
}

export function loadLocalChatPrefs(uid: string): UserChatPreferences {
  if (!uid || typeof window === 'undefined') return { ...DEFAULT_CHAT_PREFS };
  try {
    const raw = window.localStorage.getItem(`${LS_KEY_PREFIX}${uid}`);
    if (!raw) return { ...DEFAULT_CHAT_PREFS };
    return sanitizeChatPrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CHAT_PREFS };
  }
}

export function saveLocalChatPrefs(uid: string, prefs: UserChatPreferences): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LS_KEY_PREFIX}${uid}`, JSON.stringify(prefs));
  } catch {
    // ignore storage quota errors
  }
}

export async function fetchServerChatPrefs(
  authUser: User
): Promise<UserChatPreferences | null> {
  try {
    const token = await authUser.getIdToken();
    const res = await fetch('/api/chats/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; prefs?: unknown };
    if (!data?.ok || !data.prefs) return null;
    return sanitizeChatPrefs(data.prefs);
  } catch {
    return null;
  }
}

export async function saveServerChatPrefs(
  authUser: User,
  prefs: UserChatPreferences
): Promise<void> {
  try {
    const token = await authUser.getIdToken();
    await fetch('/api/chats/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prefs }),
    });
  } catch {
    // Local cache preserves preferences immediately; next sync will update server
  }
}

export function pickNewerChatPrefs(
  local: UserChatPreferences,
  server: UserChatPreferences
): UserChatPreferences {
  const localTs = local.updatedAtMs || 0;
  const serverTs = server.updatedAtMs || 0;
  if (serverTs > localTs) return server;
  if (localTs > serverTs) return local;
  // Tie-breaker: merge non-empty sets conservatively
  return serverTs === 0 && localTs === 0 ? server : local;
}

export async function hashChatLockPin(pin: string): Promise<string> {
  const normalized = `chatfi_lock_v1:${pin.trim()}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoded = new TextEncoder().encode(normalized);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // fall back below
    }
  }
  // Deterministic fallback hash when WebCrypto subtle is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + ((h1 >>> 0) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `fb_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export async function verifyChatLockPin(pin: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  const computed = await hashChatLockPin(pin);
  return computed === storedHash;
}
