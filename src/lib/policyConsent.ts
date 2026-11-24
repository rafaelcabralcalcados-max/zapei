import type { User } from 'firebase/auth';
import {
  enableRealBackgroundCallPush,
  getBackgroundPushStatus,
  type BackgroundPushStatus,
} from './pushService';
import { unlockCallAudio } from './webrtcService';

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
 * Executed immediately when the user accepts the ChatFi Terms of Responsibility & Privacy Policy.
 * Unlocks call/message ringtone audio, requests persistent local media storage, and registers
 * background Web Push notifications synchronously inside the tap gesture without interrupting iOS audio.
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

  // 2. Request Push Notifications synchronously inside the user tap gesture (required by iOS Safari & Android Chrome)
  let pushStatus: BackgroundPushStatus = 'unsupported';
  try {
    if (authUser) {
      const pushRes = await enableRealBackgroundCallPush(authUser);
      pushStatus = pushRes.status;
    } else {
      pushStatus = await getBackgroundPushStatus();
    }
  } catch {
    try {
      pushStatus = await getBackgroundPushStatus();
    } catch {
      pushStatus = 'unsupported';
    }
  }

  return { mediaAuthorized: true, pushStatus };
}
