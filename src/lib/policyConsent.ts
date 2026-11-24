import type { User } from 'firebase/auth';
import {
  enableRealBackgroundCallPush,
  getBackgroundPushStatus,
  type BackgroundPushStatus,
} from './pushService';
import {
  preauthorizeMediaPermissions,
  unlockCallAudio,
} from './webrtcService';

export const CURRENT_POLICY_VERSION = '1.0';

export interface PolicyConsentRecord {
  version: string;
  acceptedAtMs: number;
  acceptedAtLabel: string;
  permissionsRequested: boolean;
}

function getConsentStorageKey(uid: string): string {
  return `zapei_policy_consent_v1_${uid}`;
}

function formatDatePtBr(timestampMs: number): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(timestampMs));
  } catch {
    return new Date(timestampMs).toLocaleDateString('pt-BR');
  }
}

export function getPolicyConsentRecord(uid: string): PolicyConsentRecord | null {
  if (typeof window === 'undefined' || !uid) return null;
  try {
    const raw = localStorage.getItem(getConsentStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PolicyConsentRecord>;
    if (!parsed || parsed.version !== CURRENT_POLICY_VERSION || !parsed.acceptedAtMs) {
      return null;
    }
    return {
      version: parsed.version,
      acceptedAtMs: Number(parsed.acceptedAtMs),
      acceptedAtLabel:
        parsed.acceptedAtLabel || formatDatePtBr(Number(parsed.acceptedAtMs)),
      permissionsRequested: Boolean(parsed.permissionsRequested),
    };
  } catch {
    return null;
  }
}

export function hasAcceptedCurrentPolicy(uid: string): boolean {
  return getPolicyConsentRecord(uid) !== null;
}

export function savePolicyConsentRecord(uid: string): PolicyConsentRecord {
  const now = Date.now();
  const record: PolicyConsentRecord = {
    version: CURRENT_POLICY_VERSION,
    acceptedAtMs: now,
    acceptedAtLabel: formatDatePtBr(now),
    permissionsRequested: true,
  };
  try {
    localStorage.setItem(getConsentStorageKey(uid), JSON.stringify(record));
  } catch {
    // Non-fatal if storage is restricted
  }
  return record;
}

/**
 * Unified one-time device permissions request executed immediately when the user
 * accepts the Zapei Terms of Responsibility & Privacy Policy.
 * Requests microphone, camera, notifications, audio playback unlock, and persistent
 * local media storage in a single cohesive step so the user is not interrupted later.
 */
export async function authorizeAllZapeiResourcesOnce(
  authUser: User | null
): Promise<{
  mediaAuthorized: boolean;
  pushStatus: BackgroundPushStatus;
}> {
  unlockCallAudio();

  // 1. Request persistent local storage for photos, audios & custom ringtones (silent)
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => {});
    }
  } catch {
    // ignore
  }

  // 2. Request Push Notifications FIRST while the fresh user tap gesture is still valid on iOS/Android
  let pushStatus: BackgroundPushStatus = 'unsupported';
  try {
    const currentStatus = await getBackgroundPushStatus();
    if (authUser && (currentStatus === 'prompt' || currentStatus === 'enabled')) {
      const pushRes = await enableRealBackgroundCallPush(authUser);
      pushStatus = pushRes.status;
    } else {
      pushStatus = currentStatus;
    }
  } catch {
    try {
      pushStatus = await getBackgroundPushStatus();
    } catch {
      pushStatus = 'unsupported';
    }
  }

  // 3. Request Camera + Microphone once (releases hardware immediately after grant)
  let mediaAuthorized = false;
  try {
    const mediaRes = await preauthorizeMediaPermissions();
    mediaAuthorized = mediaRes.ok;
  } catch {
    mediaAuthorized = false;
  }

  return { mediaAuthorized, pushStatus };
}
