import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPhoneNumber,
  RecaptchaVerifier,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type Auth,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { deleteObject, getStorage, ref, type FirebaseStorage } from 'firebase/storage';
import appletConfig from '../../firebase-applet-config.json';
import type {
  CallSessionRecord,
  CategoryMargin,
  ChatMessage,
  ChatThreadSummary,
  CommercialBanRecord,
  CommercialMode,
  CommercialReview,
  ConnectedDevice,
  ConnectionApprovalStatus,
  Contact,
  DeliveryReport,
  DeliveryReportStatus,
  DeviceAuthRequest,
  DualPaymentRecord,
  FactoryConnection,
  FavoriteGrade,
  LogisticsType,
  MinimumDeliveryPolicy,
  MixedOrder,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductCategory,
  ProductUnitType,
  SubOrder,
  SubOrderLineItem,
  SubscriptionStatus,
  SupportTicket,
  SupportTicketReason,
  SupportTicketStatus,
  TargetCommercialRole,
  UserProfile,
} from '../types/zapei';
import { buildDefaultMarginsMap } from './categories';
import { DEFAULT_STATUS_MESSAGE, sanitizeStatusMessage } from './presenceUtils';
import {
  generateRequestToken,
  generateSixDigitCode,
  generateVirtualLine,
  getOrCreateLocalDeviceInfo,
  hashCpfSha256,
  isValidCpf,
  isVirtualLinePrefix,
  maskEmailForDisplay,
  type LocalDeviceInfo,
} from './cpfAndDeviceUtils';
import { DEFAULT_FAVORITE_GRADES, getInitials } from './gradeParser';
import { formatPhoneDisplay, hashPhoneNumber } from './phoneUtils';

export const firebaseConfig = {
  apiKey: appletConfig.apiKey || '',
  authDomain: appletConfig.authDomain || '',
  projectId: appletConfig.projectId || '',
  storageBucket: appletConfig.storageBucket || '',
  messagingSenderId: appletConfig.messagingSenderId || '',
  appId: appletConfig.appId || '',
  firestoreDatabaseId: appletConfig.firestoreDatabaseId || '(default)',
};

const app: FirebaseApp =
  getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

function initPersistentFirestore(firebaseApp: FirebaseApp): Firestore {
  try {
    return initializeFirestore(
      firebaseApp,
      {
        experimentalAutoDetectLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    // Fallback if Firestore was already initialized or IndexedDB is unavailable (e.g., private browsing)
    return getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
  }
}

export const auth: Auth = getAuth(app);
export const db: Firestore = initPersistentFirestore(app);
export const storage: FirebaseStorage = getStorage(app);
storage.maxUploadRetryTime = 8000;
storage.maxOperationRetryTime = 8000;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<'connected' | 'offline'> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'offline';
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return 'connected';
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      return 'offline';
    }
    return 'connected';
  }
}

void testFirestoreConnection();

export async function signInWithGoogleFirebase(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

let activeRecaptchaVerifier: RecaptchaVerifier | null = null;
let activeRecaptchaHost: HTMLDivElement | null = null;

export function clearPhoneRecaptcha(containerId = 'zapei-recaptcha-container'): void {
  if (activeRecaptchaVerifier) {
    try {
      activeRecaptchaVerifier.clear();
    } catch {
      // verifier already cleared
    }
    activeRecaptchaVerifier = null;
  }

  if (activeRecaptchaHost) {
    try {
      activeRecaptchaHost.remove();
    } catch {
      // already detached
    }
    activeRecaptchaHost = null;
  }

  if (typeof document !== 'undefined') {
    const wrapper = document.getElementById(containerId);
    if (wrapper) {
      wrapper.replaceChildren();
    }
  }
}

export async function sendWhatsAppStyleSmsCode(
  e164Phone: string,
  recaptchaContainerId: string
): Promise<ConfirmationResult> {
  clearPhoneRecaptcha(recaptchaContainerId);
  auth.languageCode = 'pt-BR';

  let wrapper = document.getElementById(recaptchaContainerId);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = recaptchaContainerId;
    document.body.appendChild(wrapper);
  }
  wrapper.replaceChildren();

  const freshHost = document.createElement('div');
  freshHost.id = `zapei-recaptcha-host-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  wrapper.appendChild(freshHost);
  activeRecaptchaHost = freshHost;

  const verifier = new RecaptchaVerifier(auth, freshHost, {
    size: 'invisible',
  });
  activeRecaptchaVerifier = verifier;

  try {
    return await signInWithPhoneNumber(auth, e164Phone, verifier);
  } catch (error) {
    clearPhoneRecaptcha(recaptchaContainerId);
    throw error;
  }
}

export async function verifyWhatsAppStyleSmsCode(
  confirmationResult: ConfirmationResult,
  smsCode: string
): Promise<User> {
  const credential = await confirmationResult.confirm(smsCode);
  clearPhoneRecaptcha();
  return credential.user;
}

export async function signOutFirebase(): Promise<void> {
  clearPhoneRecaptcha();
  await signOut(auth);
}

export function subscribeFirebaseAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

function formatTimestampShort(ts: Timestamp | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  const d = ts.toDate();
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}`;
}

function timestampToMs(ts: Timestamp | undefined): number {
  if (!ts || typeof ts.toMillis !== 'function') return 0;
  return ts.toMillis();
}

export function getDeterministicChatId(uid1: string, uid2: string): string {
  return [uid1, uid2].sort().join('__');
}

export const DEFAULT_CATEGORY_MARGINS: Record<string, CategoryMargin> = buildDefaultMarginsMap();

// --- USER PROFILE & PHONE / VIRTUAL LINE HASH INDEX ---

export async function computeContactLookupHash(rawIdentifier: string): Promise<string> {
  const trimmed = rawIdentifier.trim().toUpperCase();
  if (isVirtualLinePrefix(trimmed)) {
    const data = new TextEncoder().encode(`zapei-vline-v1:${trimmed}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return hashPhoneNumber(rawIdentifier);
}

export async function registerOrUpdateUserProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  virtualLine?: string;
  authMethod?: 'phone' | 'cpf';
  cpfHash?: string;
  cpfVerified?: boolean;
  statusMessage?: string;
  avatarColor?: string;
  avatarUrl?: string;
  commercialMode?: CommercialMode;
  manufacturerActivated?: boolean;
  resellerActivated?: boolean;
  storefrontName?: string;
  storefrontPrivacy?: 'open' | 'approved';
  factoryName?: string;
  asaasWalletId?: string;
  anchorDiscountPercent?: number;
  factoryPolicy?: MinimumDeliveryPolicy;
  subscriptionStatus?: SubscriptionStatus;
  trialEndsAt?: number;
  favoriteGrades?: FavoriteGrade[];
  showOnlineStatus?: boolean;
  showLastSeen?: boolean;
  primaryDevice?: LocalDeviceInfo;
}): Promise<{ isNewProfile: boolean }> {
  const userRef = doc(db, 'users', params.uid);
  const existingUser = await getDoc(userRef);
  const isNewProfile = !existingUser.exists();
  const existingPubData = existingUser.exists()
    ? (existingUser.data() as Record<string, unknown>)
    : null;

  const privateRef = doc(db, 'users', params.uid, 'private', 'info');
  const existingPrivate = await getDoc(privateRef);
  const existingPrivData = existingPrivate.exists()
    ? (existingPrivate.data() as Record<string, unknown>)
    : null;

  const resolvedVirtualLine =
    params.virtualLine ||
    (existingPubData?.virtualLine ? String(existingPubData.virtualLine) : '') ||
    (existingPrivData?.virtualLine ? String(existingPrivData.virtualLine) : '');
  const resolvedAuthMethod: 'phone' | 'cpf' =
    params.authMethod ||
    (existingPubData?.authMethod === 'cpf' || existingPrivData?.authMethod === 'cpf'
      ? 'cpf'
      : 'phone');
  const resolvedCpfHash =
    params.cpfHash ||
    (existingPrivData?.cpfHash ? String(existingPrivData.cpfHash) : '');
  const resolvedCpfVerified =
    Boolean(params.cpfVerified) ||
    Boolean(existingPubData?.cpfVerified) ||
    resolvedCpfHash.length === 64;

  const rawIdentifier = params.phone.trim() || resolvedVirtualLine;
  const isVirtualLineValue = isVirtualLinePrefix(rawIdentifier);
  const cleanPhone = isVirtualLineValue
    ? rawIdentifier.toUpperCase()
    : formatPhoneDisplay(rawIdentifier);
  const phoneHash = await computeContactLookupHash(cleanPhone);

  const existingBanned = Boolean(existingPubData?.commercialBanned);
  const initials = getInitials(params.displayName);
  const requestedMode = params.commercialMode ?? 'buyer';
  const mode: CommercialMode = existingBanned
    ? 'buyer'
    : requestedMode !== 'buyer' && !resolvedCpfVerified
      ? 'buyer'
      : requestedMode;
  const subStatus = params.subscriptionStatus ?? 'free';
  const hasStorefront =
    !existingBanned &&
    (mode === 'manufacturer' || mode === 'reseller') &&
    subStatus !== 'expired';
  const policy = params.factoryPolicy ?? {
    type: 'pieces',
    value: 1,
    allowCounterPickup: false,
    label: '',
  };

  const resolvedShowOnline =
    params.showOnlineStatus ??
    (existingPubData?.showOnlineStatus !== undefined
      ? Boolean(existingPubData.showOnlineStatus)
      : true);
  const resolvedShowLastSeen =
    params.showLastSeen ??
    (existingPubData?.showLastSeen !== undefined
      ? Boolean(existingPubData.showLastSeen)
      : true);
  const cleanStatusMessage = sanitizeStatusMessage(
    params.statusMessage ?? (existingPubData?.statusMessage ? String(existingPubData.statusMessage) : '')
  ).slice(0, 160);
  const resolvedWalletId = (
    params.asaasWalletId !== undefined
      ? params.asaasWalletId
      : existingPubData?.asaasWalletId
        ? String(existingPubData.asaasWalletId)
        : ''
  )
    .trim()
    .slice(0, 128);
  const resolvedAnchorDiscount = Math.min(
    80,
    Math.max(
      0,
      Math.round(
        params.anchorDiscountPercent !== undefined
          ? params.anchorDiscountPercent
          : Number(existingPubData?.anchorDiscountPercent ?? 0) || 0
      )
    )
  );
  const nowMs = Date.now();

  const publicData: Record<string, unknown> = {
    uid: params.uid,
    displayName: params.displayName.slice(0, 80),
    initials,
    statusMessage: cleanStatusMessage,
    avatarColor: (params.avatarColor ?? '#0E7A34').slice(0, 20),
    avatarUrl: (params.avatarUrl ?? '').slice(0, 450000),
    commercialMode: mode,
    manufacturerActivated: Boolean(params.manufacturerActivated),
    resellerActivated: Boolean(params.resellerActivated),
    hasStorefront,
    storefrontName: (params.storefrontName ?? `Vitrine ${params.displayName}`).slice(0, 80),
    storefrontPrivacy: params.storefrontPrivacy ?? 'open',
    factoryName: (params.factoryName ?? params.displayName).slice(0, 80),
    asaasWalletId: resolvedWalletId,
    anchorDiscountPercent: resolvedAnchorDiscount,
    deliveryPolicyType: policy.type,
    deliveryPolicyValue: policy.value,
    deliveryPolicyPickup: policy.allowCounterPickup,
    deliveryPolicyLabel: policy.label.slice(0, 160),
    subscriptionStatus: subStatus,
    trialEndsAt: params.trialEndsAt ?? 0,
    authMethod: resolvedAuthMethod,
    showOnlineStatus: resolvedShowOnline,
    showLastSeen: resolvedShowLastSeen,
    isOnline: resolvedShowOnline,
    lastSeenAt: resolvedShowLastSeen ? nowMs : 0,
    updatedAt: serverTimestamp(),
  };
  if (resolvedCpfVerified) {
    publicData.cpfVerified = true;
  }
  if (resolvedVirtualLine) {
    publicData.virtualLine = resolvedVirtualLine.slice(0, 24);
  }
  if (existingBanned) {
    publicData.commercialBanned = true;
  }

  if (isNewProfile && params.primaryDevice) {
    await registerPrimaryDeviceForAccount(params.uid, params.primaryDevice);
  }

  try {
    if (existingUser.exists()) {
      await updateDoc(userRef, publicData);
    } else {
      await setDoc(userRef, {
        ...publicData,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${params.uid}`);
  }

  const privateData: Record<string, unknown> = {
    ownerId: params.uid,
    phone: cleanPhone.slice(0, 32),
    phoneHash,
    authMethod: resolvedAuthMethod,
    email: params.email.slice(0, 120),
    favoriteGrades: params.favoriteGrades ?? DEFAULT_FAVORITE_GRADES,
    updatedAt: serverTimestamp(),
  };
  if (resolvedVirtualLine) {
    privateData.virtualLine = resolvedVirtualLine.slice(0, 24);
  }
  if (resolvedCpfHash && resolvedCpfHash.length === 64) {
    privateData.cpfHash = resolvedCpfHash;
  }

  try {
    if (existingPrivate.exists()) {
      await updateDoc(privateRef, privateData);
    } else {
      await setDoc(privateRef, { ...privateData, createdAt: serverTimestamp() });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${params.uid}/private/info`);
  }

  // Sync non-PII SHA-256 identity hashes for cross-identifier compliance enforcement
  void syncCommercialIdentityHashes({
    uid: params.uid,
    cpfHash: resolvedCpfHash || undefined,
    phoneHash,
    virtualLine: resolvedVirtualLine || undefined,
  });

  const indexRole: 'normal' | 'reseller' | 'manufacturer' =
    existingBanned
      ? 'normal'
      : mode === 'manufacturer'
        ? 'manufacturer'
        : mode === 'reseller'
          ? 'reseller'
          : 'normal';
  const resolvedStorefrontName = (
    mode === 'manufacturer'
      ? params.factoryName ?? params.displayName
      : params.storefrontName ?? `Vitrine ${params.displayName}`
  ).slice(0, 80);

  const existingRatingAvg = Number(existingPubData?.ratingAverage ?? 0) || 0;
  const existingRatingCnt = Math.max(0, Math.round(Number(existingPubData?.ratingCount ?? 0) || 0));

  if (phoneHash) {
    const indexRef = doc(db, 'phone_index', phoneHash);
    const indexPayload: Record<string, unknown> = {
      ownerId: params.uid,
      displayName: params.displayName.slice(0, 80),
      initials,
      avatarColor: (params.avatarColor ?? '#0E7A34').slice(0, 20),
      avatarUrl: (params.avatarUrl ?? '').slice(0, 450000),
      role: indexRole,
      hasStorefront,
      storefrontName: resolvedStorefrontName,
      deliveryPolicyType: policy.type,
      deliveryPolicyValue: policy.value,
      deliveryPolicyPickup: policy.allowCounterPickup,
      deliveryPolicyLabel: policy.label.slice(0, 160),
      updatedAt: serverTimestamp(),
    };
    if (existingRatingCnt > 0 || existingRatingAvg > 0) {
      indexPayload.ratingAverage = existingRatingAvg;
      indexPayload.ratingCount = existingRatingCnt;
    }
    if (existingBanned) {
      indexPayload.commercialBanned = true;
    }
    try {
      await setDoc(indexRef, indexPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `phone_index/${phoneHash}`);
    }
  }

  // Also index Virtual Line hash if user has both a phone and a virtualLine
  if (resolvedVirtualLine && cleanPhone !== resolvedVirtualLine) {
    const vlineHash = await computeContactLookupHash(resolvedVirtualLine);
    if (vlineHash && vlineHash !== phoneHash) {
      const vlinePayload: Record<string, unknown> = {
        ownerId: params.uid,
        displayName: params.displayName.slice(0, 80),
        initials,
        avatarColor: (params.avatarColor ?? '#0E7A34').slice(0, 20),
        avatarUrl: (params.avatarUrl ?? '').slice(0, 450000),
        role: indexRole,
        hasStorefront,
        storefrontName: resolvedStorefrontName,
        deliveryPolicyType: policy.type,
        deliveryPolicyValue: policy.value,
        deliveryPolicyPickup: policy.allowCounterPickup,
        deliveryPolicyLabel: policy.label.slice(0, 160),
        updatedAt: serverTimestamp(),
      };
      if (existingRatingCnt > 0 || existingRatingAvg > 0) {
        vlinePayload.ratingAverage = existingRatingAvg;
        vlinePayload.ratingCount = existingRatingCnt;
      }
      if (existingBanned) {
        vlinePayload.commercialBanned = true;
      }
      try {
        await setDoc(doc(db, 'phone_index', vlineHash), vlinePayload);
      } catch {
        // Secondary index best-effort
      }
    }
  }

  const directoryRef = doc(db, 'public_directory', params.uid);
  let existingDir = await getDoc(directoryRef).catch(() => null);
  if (!existingDir?.exists()) {
    existingDir = await getDocFromServer(directoryRef).catch(() => existingDir);
  }
  const existingDirData = existingDir?.exists()
    ? (existingDir.data() as Record<string, unknown>)
    : null;
  const dirBanned = existingBanned || Boolean(existingDirData?.commercialBanned);

  const directoryPayload: Record<string, unknown> = {
    uid: params.uid,
    displayName: params.displayName.slice(0, 80),
    displayNameLower: params.displayName.trim().toLowerCase().slice(0, 80),
    initials,
    statusMessage: cleanStatusMessage,
    avatarColor: (params.avatarColor ?? '#0E7A34').slice(0, 20),
    avatarUrl: (params.avatarUrl ?? '').slice(0, 450000),
    role: dirBanned ? 'normal' : indexRole,
    hasStorefront: dirBanned ? false : hasStorefront,
    storefrontName: resolvedStorefrontName,
    deliveryPolicyLabel: policy.label.slice(0, 160),
    isDiscoverable: true,
    showOnlineStatus: resolvedShowOnline,
    showLastSeen: resolvedShowLastSeen,
    isOnline: resolvedShowOnline,
    lastSeenAt: resolvedShowLastSeen ? nowMs : 0,
    updatedAt: serverTimestamp(),
  };
  if (resolvedVirtualLine) {
    directoryPayload.virtualLine = resolvedVirtualLine.slice(0, 24);
  }
  if (dirBanned) {
    directoryPayload.commercialBanned = true;
  }

  try {
    if (existingDir?.exists()) {
      await updateDoc(directoryRef, directoryPayload);
    } else {
      const createDirPayload: Record<string, unknown> = { ...directoryPayload };
      if (existingRatingCnt > 0 || existingRatingAvg > 0) {
        createDirPayload.ratingAverage = existingRatingAvg;
        createDirPayload.ratingCount = existingRatingCnt;
      }
      try {
        await setDoc(directoryRef, createDirPayload);
      } catch (setErr) {
        if (getErrorCodeString(setErr) === 'permission-denied') {
          await updateDoc(directoryRef, directoryPayload);
        } else {
          throw setErr;
        }
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `public_directory/${params.uid}`);
  }

  return { isNewProfile };
}

function buildUserProfileFromDocs(
  uid: string,
  email: string,
  publicData: Record<string, unknown> | null,
  privateData: Record<string, unknown> | null
): UserProfile | null {
  if (!publicData || !privateData) return null;

  const trialEndsAt = Number(publicData.trialEndsAt ?? 0);
  const daysLeft =
    trialEndsAt > 0
      ? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;
  const rawSub = (publicData.subscriptionStatus as SubscriptionStatus) ?? 'free';
  const effectiveSub: SubscriptionStatus =
    rawSub === 'trial' && trialEndsAt > 0 && Date.now() > trialEndsAt ? 'expired' : rawSub;

  const virtualLine = publicData.virtualLine
    ? String(publicData.virtualLine)
    : privateData.virtualLine
      ? String(privateData.virtualLine)
      : undefined;
  const authMethod: 'phone' | 'cpf' =
    publicData.authMethod === 'cpf' || privateData.authMethod === 'cpf' ? 'cpf' : 'phone';
  const cpfVerified =
    Boolean(publicData.cpfVerified) ||
    (typeof privateData.cpfHash === 'string' && privateData.cpfHash.length === 64);
  const commercialBanned = Boolean(publicData.commercialBanned);

  const rawStatusMessage = String(publicData.statusMessage ?? '');
  const sanitizedStatus = sanitizeStatusMessage(rawStatusMessage);

  return {
    uid,
    name: String(publicData.displayName ?? ''),
    initials: String(publicData.initials ?? getInitials(String(publicData.displayName ?? 'CF'))),
    phone: String(privateData.phone ?? virtualLine ?? ''),
    phoneHash: String(privateData.phoneHash ?? ''),
    virtualLine,
    authMethod,
    cpfVerified,
    email: String(privateData.email ?? email),
    statusMessage: sanitizedStatus,
    isOnline: Boolean(publicData.isOnline),
    lastSeenAt: Number(publicData.lastSeenAt ?? 0),
    showOnlineStatus: publicData.showOnlineStatus !== false,
    showLastSeen: publicData.showLastSeen !== false,
    avatarBg: String(publicData.avatarColor ?? '#0E7A34'),
    avatarUrl: publicData.avatarUrl ? String(publicData.avatarUrl) : undefined,
    commercialMode: commercialBanned
      ? 'buyer'
      : ((publicData.commercialMode as CommercialMode) ?? 'buyer'),
    manufacturerActivated: Boolean(publicData.manufacturerActivated),
    resellerActivated: Boolean(publicData.resellerActivated),
    hasStorefront: commercialBanned ? false : Boolean(publicData.hasStorefront),
    subscriptionStatus: effectiveSub,
    trialEndsAt,
    trialDaysLeft: daysLeft,
    storefrontName: String(publicData.storefrontName ?? ''),
    storefrontPrivacy: (publicData.storefrontPrivacy as 'open' | 'approved') ?? 'open',
    factoryName: String(publicData.factoryName ?? ''),
    asaasWalletId: publicData.asaasWalletId ? String(publicData.asaasWalletId) : '',
    anchorDiscountPercent: Math.min(
      80,
      Math.max(0, Math.round(Number(publicData.anchorDiscountPercent ?? 0) || 0))
    ),
    factoryPolicy: {
      type: (publicData.deliveryPolicyType as MinimumDeliveryPolicy['type']) ?? 'pieces',
      value: Number(publicData.deliveryPolicyValue ?? 1),
      allowCounterPickup: Boolean(publicData.deliveryPolicyPickup ?? false),
      label: String(publicData.deliveryPolicyLabel ?? ''),
    },
    favoriteGrades:
      Array.isArray(privateData.favoriteGrades) && privateData.favoriteGrades.length > 0
        ? (privateData.favoriteGrades as FavoriteGrade[])
        : DEFAULT_FAVORITE_GRADES,
    ratingAverage: Number(publicData.ratingAverage ?? 0) || 0,
    ratingCount: Math.max(0, Math.round(Number(publicData.ratingCount ?? 0) || 0)),
    commercialBanned,
    commercialBanReason: publicData.commercialBanReason
      ? String(publicData.commercialBanReason)
      : undefined,
    commercialBanAtMs: publicData.commercialBanAtMs
      ? Number(publicData.commercialBanAtMs)
      : undefined,
  };
}

export async function fetchUserProfileOnce(
  uid: string,
  email: string
): Promise<UserProfile | null> {
  const pubRef = doc(db, 'users', uid);
  const privRef = doc(db, 'users', uid, 'private', 'info');
  const [pubSnap, privSnap] = await Promise.all([getDoc(pubRef), getDoc(privRef)]);
  return buildUserProfileFromDocs(
    uid,
    email,
    pubSnap.exists() ? (pubSnap.data() as Record<string, unknown>) : null,
    privSnap.exists() ? (privSnap.data() as Record<string, unknown>) : null
  );
}

export function subscribeUserProfile(
  uid: string,
  email: string,
  callback: (profile: UserProfile | null) => void
): () => void {
  let active = true;
  let publicData: Record<string, unknown> | null = null;
  let privateData: Record<string, unknown> | null = null;
  let publicLoaded = false;
  let privateLoaded = false;
  let migratedLegacyStatus = false;
  let hasEmittedOnce = false;
  let retriedAfterError = false;

  const pubRef = doc(db, 'users', uid);
  const privRef = doc(db, 'users', uid, 'private', 'info');

  const maybeMigrateLegacyStatus = (data: Record<string, unknown> | null) => {
    if (
      !migratedLegacyStatus &&
      data &&
      typeof data.statusMessage === 'string' &&
      /zapei/i.test(data.statusMessage)
    ) {
      migratedLegacyStatus = true;
      const clean = sanitizeStatusMessage(data.statusMessage);
      void updateDoc(pubRef, {
        statusMessage: clean,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  };

  const emit = () => {
    if (!active || !publicLoaded || !privateLoaded) return;
    hasEmittedOnce = true;
    callback(buildUserProfileFromDocs(uid, email, publicData, privateData));
  };

  const bootstrapViaGetDoc = async (forceTokenRefresh = false) => {
    try {
      if (forceTokenRefresh && auth.currentUser) {
        await auth.currentUser.getIdToken(true).catch(() => {});
      }
      const [pubRes, privRes] = await Promise.allSettled([getDoc(pubRef), getDoc(privRef)]);
      if (!active) return;
      if (pubRes.status === 'fulfilled') {
        publicLoaded = true;
        publicData = pubRes.value.exists()
          ? (pubRes.value.data() as Record<string, unknown>)
          : null;
        maybeMigrateLegacyStatus(publicData);
      }
      if (privRes.status === 'fulfilled') {
        privateLoaded = true;
        privateData = privRes.value.exists()
          ? (privRes.value.data() as Record<string, unknown>)
          : null;
      }
      emit();
    } catch {
      // Handled by safety fallback timer if both listeners and direct fetch fail
    }
  };

  const handleListenerError = (path: string, error: unknown) => {
    console.error(`Firestore profile listener error (${path}):`, error);
    if (!active) return;
    if (!retriedAfterError) {
      retriedAfterError = true;
      // On mobile fresh SMS/CPF login, retry once after refreshing the Firebase ID token
      window.setTimeout(() => {
        if (active && !hasEmittedOnce) {
          void bootstrapViaGetDoc(true);
        }
      }, 650);
    }
  };

  // Parallel direct getDoc bootstrap so mobile 4G/5G networks never stall waiting solely on WebChannel streams
  void bootstrapViaGetDoc(false);

  // Safety fallback timer: if neither onSnapshot nor initial getDoc resolves within 4s, retry once with a refreshed ID token
  const fallbackTimer = window.setTimeout(() => {
    if (!active || hasEmittedOnce) return;
    void bootstrapViaGetDoc(true);
  }, 4000);

  const unsubPub = onSnapshot(
    pubRef,
    (snap) => {
      publicLoaded = true;
      publicData = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      maybeMigrateLegacyStatus(publicData);
      emit();
    },
    (error) => handleListenerError(`users/${uid}`, error)
  );

  const unsubPriv = onSnapshot(
    privRef,
    (snap) => {
      privateLoaded = true;
      privateData = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      emit();
    },
    (error) => handleListenerError(`users/${uid}/private/info`, error)
  );

  return () => {
    active = false;
    window.clearTimeout(fallbackTimer);
    unsubPub();
    unsubPriv();
  };
}

// --- REAL PHONEBOOK CONTACTS, NAME DIRECTORY & PHONE HASH DISCOVERY ---

export interface PublicDirectoryUser {
  uid: string;
  displayName: string;
  initials: string;
  statusMessage: string;
  avatarColor: string;
  avatarUrl?: string;
  role: 'normal' | 'reseller' | 'manufacturer';
  hasStorefront: boolean;
  storefrontName: string;
  deliveryPolicyLabel: string;
  virtualLine?: string;
  ratingAverage?: number;
  ratingCount?: number;
  commercialBanned?: boolean;
  isOnline?: boolean;
  lastSeenAt?: number;
  showOnlineStatus?: boolean;
  showLastSeen?: boolean;
}

export async function syncPublicDirectoryEntry(profile: UserProfile): Promise<void> {
  if (!profile.uid || !profile.name.trim()) return;
  const dirRef = doc(db, 'public_directory', profile.uid);
  let existing = await getDoc(dirRef).catch(() => null);
  if (!existing?.exists()) {
    existing = await getDocFromServer(dirRef).catch(() => existing);
  }
  const existingData = existing?.exists()
    ? (existing.data() as Record<string, unknown>)
    : null;
  const banned = Boolean(profile.commercialBanned) || Boolean(existingData?.commercialBanned);
  const role: 'normal' | 'reseller' | 'manufacturer' = banned
    ? 'normal'
    : profile.commercialMode === 'manufacturer'
      ? 'manufacturer'
      : profile.commercialMode === 'reseller'
        ? 'reseller'
        : 'normal';
  const storefrontName = (
    profile.commercialMode === 'manufacturer'
      ? profile.factoryName || profile.name
      : profile.storefrontName || `Vitrine ${profile.name}`
  ).slice(0, 80);

  const showOnline = profile.showOnlineStatus !== false;
  const showLastSeen = profile.showLastSeen !== false;
  const nowMs = Date.now();

  const payload: Record<string, unknown> = {
    uid: profile.uid,
    displayName: profile.name.slice(0, 80),
    displayNameLower: profile.name.trim().toLowerCase().slice(0, 80),
    initials: (profile.initials || getInitials(profile.name)).slice(0, 4),
    statusMessage: sanitizeStatusMessage(profile.statusMessage).slice(0, 160),
    avatarColor: (profile.avatarBg || '#0E7A34').slice(0, 20),
    avatarUrl: (profile.avatarUrl || '').slice(0, 450000),
    role,
    hasStorefront: banned ? false : Boolean(profile.hasStorefront),
    storefrontName,
    deliveryPolicyLabel: (profile.factoryPolicy?.label || '').slice(0, 160),
    isDiscoverable: true,
    showOnlineStatus: showOnline,
    showLastSeen,
    isOnline:
      showOnline && typeof document !== 'undefined'
        ? document.visibilityState === 'visible'
        : showOnline,
    lastSeenAt: showLastSeen ? nowMs : 0,
    updatedAt: serverTimestamp(),
  };
  if (profile.virtualLine) {
    payload.virtualLine = profile.virtualLine.slice(0, 24);
  }
  if (banned) {
    payload.commercialBanned = true;
  }

  try {
    if (existing?.exists()) {
      const prev = existing.data() as Record<string, unknown>;
      const unchanged =
        prev.displayName === payload.displayName &&
        prev.initials === payload.initials &&
        prev.statusMessage === payload.statusMessage &&
        prev.avatarColor === payload.avatarColor &&
        (prev.avatarUrl || '') === payload.avatarUrl &&
        prev.role === payload.role &&
        Boolean(prev.hasStorefront) === Boolean(payload.hasStorefront) &&
        (prev.storefrontName || '') === payload.storefrontName &&
        (prev.deliveryPolicyLabel || '') === payload.deliveryPolicyLabel &&
        (prev.virtualLine || '') === (payload.virtualLine || '') &&
        Boolean(prev.commercialBanned) === Boolean(payload.commercialBanned) &&
        prev.showOnlineStatus === payload.showOnlineStatus &&
        prev.showLastSeen === payload.showLastSeen;
      if (unchanged) {
        return;
      }
      await updateDoc(dirRef, payload);
    } else {
      const ratingAverage = Number(profile.ratingAverage ?? 0) || 0;
      const ratingCount = Math.max(0, Math.round(Number(profile.ratingCount ?? 0) || 0));
      const createPayload: Record<string, unknown> = { ...payload };
      if (ratingCount > 0 || ratingAverage > 0) {
        createPayload.ratingAverage = ratingAverage;
        createPayload.ratingCount = ratingCount;
      }
      try {
        await setDoc(dirRef, createPayload);
      } catch (setErr) {
        if (getErrorCodeString(setErr) === 'permission-denied') {
          await updateDoc(dirRef, payload);
        } else {
          throw setErr;
        }
      }
    }
  } catch {
    // Non-fatal background directory sync (same pattern as updateUserPresenceHeartbeat)
  }
}

/**
 * Publishes lightweight WhatsApp-style presence ("online" / "visto por último") to
 * `public_directory/{uid}` without touching `users/{uid}` (so the local session never flickers).
 * Respects user privacy at the data layer: never publishes online=true or timestamps when disabled.
 */
let presenceQuotaBackoffUntilMs = 0;

export async function updateUserPresenceHeartbeat(
  uid: string,
  opts: {
    isOnline: boolean;
    showOnlineStatus: boolean;
    showLastSeen: boolean;
  }
): Promise<void> {
  if (!uid) return;
  if (Date.now() < presenceQuotaBackoffUntilMs) return;
  const showOnline = opts.showOnlineStatus !== false;
  const showLastSeen = opts.showLastSeen !== false;
  const effectiveOnline = showOnline ? opts.isOnline : false;
  const effectiveLastSeen = showLastSeen ? Date.now() : 0;

  try {
    await updateDoc(doc(db, 'public_directory', uid), {
      isOnline: effectiveOnline,
      lastSeenAt: effectiveLastSeen,
      showOnlineStatus: showOnline,
      showLastSeen,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    if (getErrorCodeString(err) === 'resource-exhausted') {
      // Pause background heartbeats for 15 minutes when daily write quota is hit
      presenceQuotaBackoffUntilMs = Date.now() + 15 * 60 * 1000;
    }
    // Non-fatal: directory entry may not exist yet or network is temporarily offline
  }
}

/**
 * Persists user's WhatsApp-style presence privacy choice ("online" and "visto por último")
 * to both `users/{uid}` and `public_directory/{uid}` immediately.
 */
export async function updateUserPresencePrivacy(
  uid: string,
  opts: {
    showOnlineStatus: boolean;
    showLastSeen: boolean;
    currentlyOnline: boolean;
  }
): Promise<void> {
  if (!uid) return;
  const effectiveOnline = opts.showOnlineStatus ? opts.currentlyOnline : false;
  const effectiveLastSeen = opts.showLastSeen ? Date.now() : 0;

  const patch = {
    showOnlineStatus: opts.showOnlineStatus,
    showLastSeen: opts.showLastSeen,
    isOnline: effectiveOnline,
    lastSeenAt: effectiveLastSeen,
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, 'users', uid), patch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }

  try {
    await updateDoc(doc(db, 'public_directory', uid), patch);
  } catch {
    // Directory doc will sync on next profile sync if not created yet
  }
}

export function subscribePublicDirectory(
  myUid: string,
  callback: (users: PublicDirectoryUser[]) => void
): () => void {
  const qDir = query(
    collection(db, 'public_directory'),
    where('isDiscoverable', '==', true)
  );
  const qUsers = query(
    collection(db, 'users'),
    where('commercialMode', 'in', ['buyer', 'manufacturer', 'reseller'])
  );

  let dirList: PublicDirectoryUser[] = [];
  let userList: PublicDirectoryUser[] = [];

  const mergeAndEmit = () => {
    const merged = new Map<string, PublicDirectoryUser>();

    for (const u of userList) {
      if (u.uid === myUid || !u.displayName) continue;
      merged.set(u.uid, u);
    }

    for (const d of dirList) {
      if (d.uid === myUid || !d.displayName) continue;
      const prev = merged.get(d.uid);
      const showOnline =
        d.showOnlineStatus !== undefined
          ? d.showOnlineStatus
          : prev?.showOnlineStatus !== undefined
            ? prev.showOnlineStatus
            : true;
      const showLastSeen =
        d.showLastSeen !== undefined
          ? d.showLastSeen
          : prev?.showLastSeen !== undefined
            ? prev.showLastSeen
            : true;

      const isBanned = Boolean(d.commercialBanned || prev?.commercialBanned);
      merged.set(d.uid, {
        ...prev,
        ...d,
        role: isBanned ? 'normal' : d.role || prev?.role || 'normal',
        hasStorefront: isBanned ? false : Boolean(d.hasStorefront ?? prev?.hasStorefront),
        commercialBanned: isBanned,
        ratingAverage: Math.max(
          Number(d.ratingAverage ?? 0) || 0,
          Number(prev?.ratingAverage ?? 0) || 0
        ),
        ratingCount: Math.max(
          Math.round(Number(d.ratingCount ?? 0) || 0),
          Math.round(Number(prev?.ratingCount ?? 0) || 0)
        ),
        avatarUrl: d.avatarUrl || prev?.avatarUrl,
        storefrontName: d.storefrontName || prev?.storefrontName || '',
        statusMessage: sanitizeStatusMessage(d.statusMessage || prev?.statusMessage),
        virtualLine: d.virtualLine || prev?.virtualLine,
        showOnlineStatus: showOnline,
        showLastSeen,
        isOnline: showOnline ? Boolean(d.isOnline ?? prev?.isOnline) : false,
        lastSeenAt: showLastSeen
          ? Math.max(Number(d.lastSeenAt || 0), Number(prev?.lastSeenAt || 0))
          : 0,
      });
    }

    const sorted = Array.from(merged.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'pt-BR')
    );
    callback(sorted);
  };

  const unsubDir = onSnapshot(
    qDir,
    (snap) => {
      dirList = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const displayName = String(d.displayName || '');
        const showOnline = d.showOnlineStatus !== false;
        const showLastSeen = d.showLastSeen !== false;
        const isBanned = Boolean(d.commercialBanned);
        return {
          uid: String(d.uid || docSnap.id),
          displayName,
          initials: String(d.initials || getInitials(displayName || 'CF')),
          statusMessage: sanitizeStatusMessage(String(d.statusMessage || '')),
          avatarColor: String(d.avatarColor || '#0E7A34'),
          avatarUrl: d.avatarUrl ? String(d.avatarUrl) : undefined,
          role: isBanned
            ? 'normal'
            : ((d.role as 'normal' | 'reseller' | 'manufacturer') ?? 'normal'),
          hasStorefront: isBanned ? false : Boolean(d.hasStorefront),
          storefrontName: String(d.storefrontName || ''),
          deliveryPolicyLabel: String(d.deliveryPolicyLabel || ''),
          virtualLine: d.virtualLine ? String(d.virtualLine) : undefined,
          ratingAverage: Number(d.ratingAverage ?? 0) || 0,
          ratingCount: Math.max(0, Math.round(Number(d.ratingCount ?? 0) || 0)),
          commercialBanned: isBanned,
          showOnlineStatus: showOnline,
          showLastSeen,
          isOnline: showOnline ? Boolean(d.isOnline) : false,
          lastSeenAt: showLastSeen ? Number(d.lastSeenAt || 0) : 0,
        };
      });
      mergeAndEmit();
    },
    (error) => {
      console.error('Directory listener error (public_directory):', error);
    }
  );

  const unsubUsers = onSnapshot(
    qUsers,
    (snap) => {
      userList = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const displayName = String(d.displayName || '');
        const isBanned = Boolean(d.commercialBanned);
        const mode = isBanned ? 'buyer' : String(d.commercialMode || 'buyer');
        const role: 'normal' | 'reseller' | 'manufacturer' =
          mode === 'manufacturer'
            ? 'manufacturer'
            : mode === 'reseller'
              ? 'reseller'
              : 'normal';
        const storefrontName =
          mode === 'manufacturer'
            ? String(d.factoryName || d.storefrontName || displayName)
            : String(d.storefrontName || '');
        const showOnline = d.showOnlineStatus !== false;
        const showLastSeen = d.showLastSeen !== false;
        return {
          uid: String(d.uid || docSnap.id),
          displayName,
          initials: String(d.initials || getInitials(displayName || 'CF')),
          statusMessage: sanitizeStatusMessage(String(d.statusMessage || '')),
          avatarColor: String(d.avatarColor || '#0E7A34'),
          avatarUrl: d.avatarUrl ? String(d.avatarUrl) : undefined,
          role,
          hasStorefront:
            !isBanned &&
            Boolean(d.hasStorefront) &&
            String(d.subscriptionStatus || '') !== 'expired',
          storefrontName,
          deliveryPolicyLabel: String(d.deliveryPolicyLabel || ''),
          virtualLine: d.virtualLine ? String(d.virtualLine) : undefined,
          ratingAverage: Number(d.ratingAverage ?? 0) || 0,
          ratingCount: Math.max(0, Math.round(Number(d.ratingCount ?? 0) || 0)),
          commercialBanned: isBanned,
          showOnlineStatus: showOnline,
          showLastSeen,
          isOnline: showOnline ? Boolean(d.isOnline) : false,
          lastSeenAt: showLastSeen ? Number(d.lastSeenAt || 0) : 0,
        };
      });
      mergeAndEmit();
    },
    (error) => {
      console.error('Directory listener error (users):', error);
    }
  );

  return () => {
    unsubDir();
    unsubUsers();
  };
}

export interface PhoneLookupResult {
  uid: string;
  displayName: string;
  initials: string;
  avatarColor: string;
  avatarUrl?: string;
  role: 'normal' | 'reseller' | 'manufacturer';
  hasStorefront: boolean;
  storefrontName: string;
  deliveryPolicy: MinimumDeliveryPolicy;
  ratingAverage?: number;
  ratingCount?: number;
  commercialBanned?: boolean;
}

export async function lookupRegisteredUserByPhone(
  rawPhone: string
): Promise<PhoneLookupResult | null> {
  const phoneHash = await computeContactLookupHash(rawPhone);
  if (!phoneHash) return null;
  try {
    const snap = await getDoc(doc(db, 'phone_index', phoneHash));
    if (!snap.exists()) return null;
    const d = snap.data();
    const isBanned = Boolean(d.commercialBanned);
    return {
      uid: String(d.ownerId),
      displayName: String(d.displayName),
      initials: String(d.initials || getInitials(String(d.displayName))),
      avatarColor: String(d.avatarColor || '#0E7A34'),
      avatarUrl: d.avatarUrl ? String(d.avatarUrl) : undefined,
      role: isBanned
        ? 'normal'
        : ((d.role as 'normal' | 'reseller' | 'manufacturer') ?? 'normal'),
      hasStorefront: isBanned ? false : Boolean(d.hasStorefront),
      storefrontName: String(d.storefrontName || d.displayName),
      deliveryPolicy: {
        type: (d.deliveryPolicyType as MinimumDeliveryPolicy['type']) ?? 'pieces',
        value: Number(d.deliveryPolicyValue ?? 1),
        allowCounterPickup: Boolean(d.deliveryPolicyPickup ?? false),
        label: String(d.deliveryPolicyLabel || ''),
      },
      ratingAverage: Number(d.ratingAverage ?? 0) || 0,
      ratingCount: Math.max(0, Math.round(Number(d.ratingCount ?? 0) || 0)),
      commercialBanned: isBanned,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `phone_index/${phoneHash}`);
  }
}

export async function saveRealContactToPhonebook(params: {
  ownerId: string;
  name: string;
  phone: string;
}): Promise<{ matched: boolean; matchedName?: string }> {
  const isVline = isVirtualLinePrefix(params.phone);
  const cleanPhone = isVline ? params.phone.trim().toUpperCase() : formatPhoneDisplay(params.phone);
  const phoneHash = await computeContactLookupHash(params.phone);
  if (!phoneHash) return { matched: false };

  const match = await lookupRegisteredUserByPhone(params.phone);
  const contactId = `c_${phoneHash.slice(0, 24)}`;
  const ref = doc(db, 'users', params.ownerId, 'contacts', contactId);
  const existing = await getDoc(ref);

  const payload = {
    ownerId: params.ownerId,
    name: params.name.trim().slice(0, 80),
    phone: cleanPhone.slice(0, 32),
    phoneHash,
    matchedUid: match && match.uid !== params.ownerId ? match.uid : '',
    matchedRole: match ? match.role : 'normal',
    matchedHasStorefront: Boolean(match && match.uid !== params.ownerId && match.hasStorefront),
    matchedStorefrontName: match ? match.storefrontName.slice(0, 80) : '',
    matchedDeliveryPolicyLabel: match ? match.deliveryPolicy.label.slice(0, 160) : '',
    avatarColor: match ? match.avatarColor : '#64748B',
    invited: existing.exists() ? Boolean(existing.data().invited) : false,
    updatedAt: serverTimestamp(),
  };

  try {
    if (existing.exists()) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${params.ownerId}/contacts/${contactId}`);
  }

  return {
    matched: Boolean(match && match.uid !== params.ownerId),
    matchedName: match?.displayName,
  };
}

export async function resyncAllPhonebookContacts(
  ownerId: string,
  contacts: Contact[]
): Promise<number> {
  let matchedCount = 0;
  for (const c of contacts) {
    const res = await saveRealContactToPhonebook({
      ownerId,
      name: c.name,
      phone: c.phone,
    });
    if (res.matched) matchedCount += 1;
  }
  return matchedCount;
}

export async function markContactInvited(ownerId: string, contactId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', ownerId, 'contacts', contactId), {
      invited: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${ownerId}/contacts/${contactId}`);
  }
}

export async function deletePhonebookContact(ownerId: string, contactId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', ownerId, 'contacts', contactId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${ownerId}/contacts/${contactId}`);
  }
}

export function subscribeUserContacts(
  uid: string,
  callback: (contacts: Contact[]) => void
): () => void {
  const q = query(
    collection(db, 'users', uid, 'contacts'),
    where('ownerId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: Contact[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const matchedUid = String(d.matchedUid || '');
        const onZapei = Boolean(matchedUid);
        return {
          id: docSnap.id,
          name: String(d.name || ''),
          phone: String(d.phone || ''),
          phoneHash: String(d.phoneHash || ''),
          initials: getInitials(String(d.name || 'CF')),
          avatarBg: String(d.avatarColor || (onZapei ? '#0E7A34' : '#64748B')),
          onZapei,
          matchedUid: matchedUid || undefined,
          role: (d.matchedRole as 'normal' | 'reseller' | 'manufacturer') ?? 'normal',
          hasStorefront: Boolean(d.matchedHasStorefront),
          storefrontName: d.matchedStorefrontName ? String(d.matchedStorefrontName) : undefined,
          deliveryPolicyLabel: d.matchedDeliveryPolicyLabel
            ? String(d.matchedDeliveryPolicyLabel)
            : undefined,
          invited: Boolean(d.invited),
        };
      });
      list.sort((a, b) => Number(b.onZapei) - Number(a.onZapei) || a.name.localeCompare(b.name));
      callback(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/contacts`)
  );
}

// --- REAL-TIME MULTI-USER CHATS & MESSAGES ---

export function subscribeUserChats(
  uid: string,
  callback: (chats: ChatThreadSummary[]) => void
): () => void {
  const qA = query(collection(db, 'chats'), where('userA', '==', uid));
  const qB = query(collection(db, 'chats'), where('userB', '==', uid));

  let listA: ChatThreadSummary[] = [];
  let listB: ChatThreadSummary[] = [];

  const mergeAndEmit = () => {
    const map = new Map<string, ChatThreadSummary>();
    for (const item of [...listA, ...listB]) {
      map.set(item.id, item);
    }
    const sorted = Array.from(map.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    callback(sorted);
  };

  const mapDoc = (docSnap: { id: string; data: () => Record<string, unknown> }): ChatThreadSummary => {
    const d = docSnap.data();
    const userA = String(d.userA);
    const userB = String(d.userB);
    const userAName = String(d.userAName || 'Contato');
    const userBName = String(d.userBName || 'Contato');
    const isA = userA === uid;
    return {
      id: docSnap.id,
      userA,
      userB,
      userAName,
      userBName,
      otherUid: isA ? userB : userA,
      otherName: isA ? userBName : userAName,
      lastMessage: String(d.lastMessage || ''),
      lastSenderId: d.lastSenderId ? String(d.lastSenderId) : undefined,
      updatedAtLabel: formatTimestampShort(d.updatedAt as Timestamp | undefined),
      updatedAtMs: timestampToMs(d.updatedAt as Timestamp | undefined),
    };
  };

  const unsubA = onSnapshot(
    qA,
    (snap) => {
      listA = snap.docs.map((ds) => mapDoc({ id: ds.id, data: () => ds.data() }));
      mergeAndEmit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'chats')
  );

  const unsubB = onSnapshot(
    qB,
    (snap) => {
      listB = snap.docs.map((ds) => mapDoc({ id: ds.id, data: () => ds.data() }));
      mergeAndEmit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'chats')
  );

  return () => {
    unsubA();
    unsubB();
  };
}

export function subscribeChatMessages(
  chatId: string,
  uid: string,
  callback: (messages: ChatMessage[]) => void
): () => void {
  const qA = query(
    collection(db, 'chats', chatId, 'messages'),
    where('userA', '==', uid)
  );
  const qB = query(
    collection(db, 'chats', chatId, 'messages'),
    where('userB', '==', uid)
  );

  let msgsA: Array<{ msg: ChatMessage; ms: number }> = [];
  let msgsB: Array<{ msg: ChatMessage; ms: number }> = [];

  const emit = () => {
    const map = new Map<string, { msg: ChatMessage; ms: number }>();
    for (const entry of [...msgsA, ...msgsB]) {
      map.set(entry.msg.id, entry);
    }
    const sorted = Array.from(map.values())
      .sort((a, b) => a.ms - b.ms)
      .map((entry) => entry.msg);
    callback(sorted);
  };

  const parseMsg = (docSnap: {
    id: string;
    data: () => Record<string, unknown>;
  }): { msg: ChatMessage; ms: number } => {
    const d = docSnap.data();
    const ms = timestampToMs(d.createdAt as Timestamp | undefined) || Date.now();
    return {
      ms,
      msg: {
        id: docSnap.id,
        chatId,
        senderId: String(d.senderId),
        senderName: String(d.senderName || ''),
        type: (d.type as ChatMessage['type']) ?? 'text',
        text: String(d.text || ''),
        timestamp: formatTimestampShort(d.createdAt as Timestamp | undefined) || 'Agora',
        createdAtMs: ms,
        mediaUrl: d.mediaUrl ? String(d.mediaUrl) : undefined,
        audioDuration: d.audioDuration ? String(d.audioDuration) : undefined,
        videoDuration: d.videoDuration ? String(d.videoDuration) : undefined,
        mediaTransitPath: d.mediaTransitPath ? String(d.mediaTransitPath) : undefined,
        mediaDelivered: typeof d.mediaDelivered === 'boolean' ? d.mediaDelivered : undefined,
        mediaSizeBytes: typeof d.mediaSizeBytes === 'number' ? d.mediaSizeBytes : undefined,
        mediaMimeType: d.mediaMimeType ? String(d.mediaMimeType) : undefined,
        mediaExpiresAtMs: typeof d.mediaExpiresAtMs === 'number' ? d.mediaExpiresAtMs : undefined,
        orderId: d.orderId ? String(d.orderId) : undefined,
        orderCode: d.orderCode ? String(d.orderCode) : undefined,
        orderSummary: d.orderSummary ? String(d.orderSummary) : undefined,
        orderTotal: typeof d.orderTotal === 'number' ? d.orderTotal : undefined,
        orderStatusLabel: d.orderStatusLabel ? String(d.orderStatusLabel) : undefined,
        deletedForAll: Boolean(d.deletedForAll),
        deletedAtMs: typeof d.deletedAtMs === 'number' ? Number(d.deletedAtMs) : undefined,
      },
    };
  };

  const unsubA = onSnapshot(
    qA,
    (snap) => {
      msgsA = snap.docs.map((ds) => parseMsg({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, `chats/${chatId}/messages`)
  );

  const unsubB = onSnapshot(
    qB,
    (snap) => {
      msgsB = snap.docs.map((ds) => parseMsg({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, `chats/${chatId}/messages`)
  );

  return () => {
    unsubA();
    unsubB();
  };
}

const knownExistingChatIds = new Set<string>();

export async function sendRealChatMessage(params: {
  myUid: string;
  myName: string;
  otherUid: string;
  otherName: string;
  type: ChatMessage['type'];
  text: string;
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
  customMessageId?: string;
}): Promise<string> {
  const safeMyName = (params.myName || '').trim().slice(0, 80) || 'Usuário';
  const safeOtherName = (params.otherName || '').trim().slice(0, 80) || 'Contato';
  const [userA, userB] = [params.myUid, params.otherUid].sort();
  const userAName = userA === params.myUid ? safeMyName : safeOtherName;
  const userBName = userB === params.myUid ? safeMyName : safeOtherName;
  const chatId = `${userA}__${userB}`;
  const chatRef = doc(db, 'chats', chatId);

  const msgId =
    params.customMessageId && params.customMessageId.trim()
      ? params.customMessageId.trim().slice(0, 96)
      : `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const payload: Record<string, unknown> = {
    chatId,
    userA,
    userB,
    senderId: params.myUid,
    senderName: safeMyName,
    type: params.type,
    text: ((params.text || '').trim() || 'Mensagem').slice(0, 1000),
    createdAt: serverTimestamp(),
  };
  if (typeof params.mediaUrl === 'string' && params.mediaUrl.length > 0) {
    payload.mediaUrl = params.mediaUrl;
  }
  if (params.audioDuration) payload.audioDuration = params.audioDuration.slice(0, 16);
  if (params.videoDuration) payload.videoDuration = params.videoDuration.slice(0, 16);
  if (params.mediaTransitPath) payload.mediaTransitPath = params.mediaTransitPath.slice(0, 260);
  payload.mediaDelivered =
    typeof params.mediaDelivered === 'boolean' ? params.mediaDelivered : false;
  if (typeof params.mediaSizeBytes === 'number' && params.mediaSizeBytes >= 0) {
    payload.mediaSizeBytes = Math.round(params.mediaSizeBytes);
  }
  if (params.mediaMimeType) payload.mediaMimeType = params.mediaMimeType.slice(0, 80);
  if (typeof params.mediaExpiresAtMs === 'number' && params.mediaExpiresAtMs >= 0) {
    payload.mediaExpiresAtMs = Math.round(params.mediaExpiresAtMs);
  }
  if (params.orderId) payload.orderId = params.orderId.slice(0, 128);
  if (params.orderCode) payload.orderCode = params.orderCode.slice(0, 32);
  if (params.orderSummary) payload.orderSummary = params.orderSummary.slice(0, 240);
  if (typeof params.orderTotal === 'number') payload.orderTotal = params.orderTotal;
  if (params.orderStatusLabel) payload.orderStatusLabel = params.orderStatusLabel.slice(0, 120);

  const chatUpdateFields = {
    userAName,
    userBName,
    lastMessage: (params.text || '').slice(0, 400),
    lastSenderId: params.myUid,
    updatedAt: serverTimestamp(),
  };

  // Fast path: if this chat thread already exists, skip the extra getDoc() round-trip
  // and write the message + chat summary in parallel!
  if (knownExistingChatIds.has(chatId)) {
    try {
      await Promise.all([
        setDoc(doc(db, 'chats', chatId, 'messages', msgId), payload),
        updateDoc(chatRef, chatUpdateFields),
      ]);
      return chatId;
    } catch {
      knownExistingChatIds.delete(chatId);
      // Fall through to full check-and-create path below
    }
  }

  let chatExists = false;
  try {
    const existingChat = await getDoc(chatRef);
    chatExists = existingChat.exists();
  } catch {
    chatExists = false;
  }

  try {
    if (chatExists) {
      knownExistingChatIds.add(chatId);
      await Promise.all([
        setDoc(doc(db, 'chats', chatId, 'messages', msgId), payload),
        updateDoc(chatRef, chatUpdateFields),
      ]);
      return chatId;
    }

    await setDoc(chatRef, {
      userA,
      userB,
      ...chatUpdateFields,
      createdAt: serverTimestamp(),
    });
    knownExistingChatIds.add(chatId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `chats/${chatId}`);
  }

  try {
    await setDoc(doc(db, 'chats', chatId, 'messages', msgId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `chats/${chatId}/messages/${msgId}`);
  }

  return chatId;
}

/**
 * Called by the recipient immediately after persisting incoming media into local IndexedDB.
 * Marks the message as mediaDelivered: true (blue double checks for sender) and clears
 * any temporary inline URL from Firestore.
 */
export async function markChatMessageMediaDelivered(
  chatId: string,
  messageId: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
      mediaDelivered: true,
      mediaUrl: '',
    });
  } catch {
    // Ignore if already delivered or offline
  }
}

export async function markChatMessagesDelivered(
  chatId: string,
  messageIds: string[]
): Promise<void> {
  if (!chatId || messageIds.length === 0) return;
  const uniqueIds = Array.from(new Set(messageIds.filter(Boolean))).slice(0, 40);
  await Promise.all(
    uniqueIds.map(async (messageId) => {
      try {
        await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
          mediaDelivered: true,
        });
      } catch {
        // Ignore if already delivered or offline
      }
    })
  );
}

export async function confirmIncomingThreadMessagesDelivered(
  chatId: string,
  myUid: string,
  otherUid: string
): Promise<void> {
  if (!chatId || !myUid || !otherUid) return;
  try {
    const [uA] = [myUid, otherUid].sort();
    const roleField = uA === myUid ? 'userA' : 'userB';
    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      where(roleField, '==', myUid)
    );
    const snap = await getDocs(q);
    const toAckIds: string[] = [];
    snap.forEach((ds) => {
      const d = ds.data();
      const msgType = String(d.type || 'text');
      if (
        d.senderId === otherUid &&
        d.mediaDelivered === false &&
        msgType !== 'image' &&
        msgType !== 'audio' &&
        msgType !== 'video'
      ) {
        toAckIds.push(ds.id);
      }
    });
    if (toAckIds.length > 0) {
      await markChatMessagesDelivered(chatId, toAckIds);
    }
  } catch {
    // Ignore offline / transient errors
  }
}

export interface ServerDeletedForAllEntry {
  chatId: string;
  messageId: string;
  senderId: string;
  deletedAtMs: number;
}

export async function fetchDeletedMessagesState(authUser: User): Promise<{
  deletedForMeIds: string[];
  deletedForAll: ServerDeletedForAllEntry[];
}> {
  try {
    const token = await authUser.getIdToken();
    const res = await fetch('/api/chats/deleted-state', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { deletedForMeIds: [], deletedForAll: [] };
    const data = (await res.json()) as {
      deletedForMeIds?: string[];
      deletedForAll?: ServerDeletedForAllEntry[];
    };
    return {
      deletedForMeIds: Array.isArray(data.deletedForMeIds) ? data.deletedForMeIds : [],
      deletedForAll: Array.isArray(data.deletedForAll) ? data.deletedForAll : [],
    };
  } catch {
    return { deletedForMeIds: [], deletedForAll: [] };
  }
}

export async function persistDeletedForMeOnServer(
  authUser: User,
  messageIds: string[]
): Promise<void> {
  if (messageIds.length === 0) return;
  try {
    const token = await authUser.getIdToken();
    await fetch('/api/chats/delete-for-me', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messageIds }),
    });
  } catch {
    // Local cache still guarantees deletion on this device
  }
}

export async function deleteChatMessagesForAll(params: {
  chatId: string;
  messages: ChatMessage[];
  myUid: string;
  authUser: User | null;
  isLatestInThread?: boolean;
}): Promise<{ deletedIds: string[]; deletedAtMs: number }> {
  const { chatId, messages, myUid, authUser, isLatestInThread } = params;
  const targets = messages.filter((m) => m.senderId === myUid && !m.deletedForAll);
  if (targets.length === 0) {
    return { deletedIds: [], deletedAtMs: Date.now() };
  }

  const nowMs = Date.now();
  const idToken = authUser ? await authUser.getIdToken().catch(() => '') : '';

  // 1. Clean up any temporary cloud transit media (Firebase Storage or same-origin server)
  await Promise.all(
    targets.map(async (m) => {
      if (m.mediaTransitPath) {
        await deleteObject(ref(storage, m.mediaTransitPath)).catch(() => {});
      }
      if (m.mediaUrl && m.mediaUrl.startsWith('/api/media/transit/') && idToken) {
        await fetch(m.mediaUrl, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` },
        }).catch(() => {});
      }
    })
  );

  // 2. Try updating Firestore message docs directly when security rules permit
  const firestoreUpdates = await Promise.all(
    targets.map(async (m) => {
      try {
        await updateDoc(doc(db, 'chats', chatId, 'messages', m.id), {
          deletedForAll: true,
          deletedAtMs: nowMs,
          text: 'Mensagem apagada',
          mediaUrl: '',
          mediaTransitPath: '',
          audioDuration: '',
          videoDuration: '',
        });
        return true;
      } catch {
        return false;
      }
    })
  );

  // 3. Always record on server ledger as well (handles pending rules deployment seamlessly)
  if (idToken) {
    await fetch('/api/chats/delete-for-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        chatId,
        messageIds: targets.map((m) => m.id),
      }),
    }).catch(() => {});
  }

  // 4. Refresh thread preview if the latest message was erased for everyone
  if (isLatestInThread || firestoreUpdates.some(Boolean)) {
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: 'Mensagem apagada',
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  return {
    deletedIds: targets.map((m) => m.id),
    deletedAtMs: nowMs,
  };
}

// --- REAL CALL HISTORY & INCOMING CALLS SUBSCRIPTION ---

export function subscribeUserCalls(
  uid: string,
  callback: (calls: CallSessionRecord[]) => void
): () => void {
  const qCaller = query(collection(db, 'calls'), where('callerId', '==', uid));
  const qCallee = query(collection(db, 'calls'), where('calleeId', '==', uid));

  let listCaller: CallSessionRecord[] = [];
  let listCallee: CallSessionRecord[] = [];

  const emit = () => {
    const map = new Map<string, CallSessionRecord>();
    for (const c of [...listCaller, ...listCallee]) {
      map.set(c.id, c);
    }
    const sorted = Array.from(map.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
    callback(sorted);
  };

  const mapCall = (docSnap: { id: string; data: () => Record<string, unknown> }): CallSessionRecord => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      callerId: String(d.callerId),
      callerName: String(d.callerName || ''),
      callerInitials: String(d.callerInitials || getInitials(String(d.callerName || 'CF'))),
      callerAvatarColor: String(d.callerAvatarColor || '#0E7A34'),
      calleeId: String(d.calleeId),
      calleeName: String(d.calleeName || ''),
      calleeInitials: String(d.calleeInitials || getInitials(String(d.calleeName || 'CF'))),
      calleeAvatarColor: String(d.calleeAvatarColor || '#0D2B3E'),
      callType: (d.callType as 'audio' | 'video') ?? 'audio',
      status: (d.status as CallSessionRecord['status']) ?? 'ended',
      offerSdp: d.offerSdp ? String(d.offerSdp) : undefined,
      answerSdp: d.answerSdp ? String(d.answerSdp) : undefined,
      durationLabel: d.durationLabel ? String(d.durationLabel) : undefined,
      timestamp: formatTimestampShort(d.createdAt as Timestamp | undefined) || 'Agora',
      createdAtMs: timestampToMs(d.createdAt as Timestamp | undefined),
    };
  };

  const unsub1 = onSnapshot(
    qCaller,
    (snap) => {
      listCaller = snap.docs.map((ds) => mapCall({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'calls')
  );

  const unsub2 = onSnapshot(
    qCallee,
    (snap) => {
      listCallee = snap.docs.map((ds) => mapCall({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'calls')
  );

  return () => {
    unsub1();
    unsub2();
  };
}

const dismissedCallStorageKey = (uid: string) => `chatfi_dismissed_calls_v1_${uid}`;

export function getDismissedCallIds(uid: string): Set<string> {
  if (!uid || typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(dismissedCallStorageKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedCallId(uid: string, callId: string): void {
  if (!uid || !callId || typeof window === 'undefined') return;
  try {
    const next = getDismissedCallIds(uid);
    next.add(callId);
    const trimmed = Array.from(next).slice(-300);
    window.localStorage.setItem(dismissedCallStorageKey(uid), JSON.stringify(trimmed));
  } catch {
    // Ignore storage restriction
  }
}

export async function deleteCallHistoryRecord(
  callId: string,
  myUid?: string
): Promise<void> {
  if (!callId.trim()) return;
  if (myUid) {
    saveDismissedCallId(myUid, callId);
  }
  try {
    await deleteDoc(doc(db, 'calls', callId));
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (code === 'permission-denied' || code === 'not-found') {
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, `calls/${callId}`);
    throw error;
  }
}

// --- REAL PRODUCTS, CONNECTIONS, ORDERS, SUB_ORDERS, PAYMENTS ---

export function subscribeProducts(
  uid: string,
  callback: (products: Product[]) => void
): () => void {
  const qMine = query(collection(db, 'products'), where('factoryId', '==', uid));
  const qApproved = query(
    collection(db, 'products'),
    where('moderationStatus', '==', 'approved')
  );

  let mine: Product[] = [];
  let approved: Product[] = [];

  const emit = () => {
    const map = new Map<string, Product>();
    for (const p of [...approved, ...mine]) {
      map.set(p.id, p);
    }
    callback(Array.from(map.values()));
  };

  const parse = (docSnap: { id: string; data: () => Record<string, unknown> }): Product => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      factoryId: String(d.factoryId),
      factoryName: String(d.factoryName || ''),
      name: String(d.name || ''),
      sku: String(d.sku || ''),
      category: (d.category as ProductCategory) ?? 'Calçados & Acessórios',
      subcategory: d.subcategory ? String(d.subcategory) : undefined,
      unitType:
        d.unitType === 'par' || d.unitType === 'unidade' || d.unitType === 'kit'
          ? (d.unitType as ProductUnitType)
          : undefined,
      quantityPerPack:
        typeof d.quantityPerPack === 'number' && Number.isFinite(d.quantityPerPack)
          ? Number(d.quantityPerPack)
          : undefined,
      packLabel: d.packLabel ? String(d.packLabel) : undefined,
      specsSummary: d.specsSummary ? String(d.specsSummary) : undefined,
      factoryPrice: Number(d.factoryPrice ?? 0),
      stockBoxes: Number(d.stockBoxes ?? 0),
      gradeRaw: String(d.gradeRaw || ''),
      imageUrl: String(d.imageUrl || ''),
      imageUrls: Array.isArray(d.imageUrls)
        ? (d.imageUrls as unknown[])
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .slice(0, 3)
        : d.imageUrl
          ? [String(d.imageUrl)]
          : [],
      isSoldOutToday: Boolean(d.isSoldOutToday),
      moderationStatus: (d.moderationStatus as 'approved' | 'flagged') ?? 'approved',
      createdAt: formatTimestampShort(d.createdAt as Timestamp | undefined) || 'Agora',
    };
  };

  const unsubMine = onSnapshot(
    qMine,
    (snap) => {
      mine = snap.docs.map((ds) => parse({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'products')
  );

  const unsubApproved = onSnapshot(
    qApproved,
    (snap) => {
      approved = snap.docs.map((ds) => parse({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'products')
  );

  return () => {
    unsubMine();
    unsubApproved();
  };
}

export async function createRealProduct(params: {
  factoryId: string;
  factoryName: string;
  name: string;
  sku: string;
  category: ProductCategory;
  subcategory?: string;
  unitType?: ProductUnitType;
  quantityPerPack?: number;
  packLabel?: string;
  specsSummary?: string;
  factoryPrice: number;
  stockBoxes: number;
  gradeRaw: string;
  imageUrl: string;
  imageUrls?: string[];
}): Promise<void> {
  const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const sanitizedImages = (
    Array.isArray(params.imageUrls) && params.imageUrls.length > 0
      ? params.imageUrls
      : [params.imageUrl]
  )
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .slice(0, 3)
    .map((u, idx) => u.slice(0, idx === 0 ? 350000 : 240000));
  const coverImage = sanitizedImages[0] || params.imageUrl.slice(0, 350000);
  const payload: Record<string, unknown> = {
    factoryId: params.factoryId,
    factoryName: params.factoryName.slice(0, 100),
    name: params.name.slice(0, 120),
    sku: params.sku.slice(0, 40),
    category: params.category,
    factoryPrice: params.factoryPrice,
    stockBoxes: params.stockBoxes,
    gradeRaw: params.gradeRaw.slice(0, 200),
    imageUrl: coverImage,
    imageUrls: sanitizedImages.length > 0 ? sanitizedImages : [coverImage],
    isSoldOutToday: false,
    moderationStatus: 'approved',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (params.subcategory && params.subcategory.trim()) {
    payload.subcategory = params.subcategory.trim().slice(0, 60);
  }
  if (params.unitType) {
    payload.unitType = params.unitType;
  }
  if (
    typeof params.quantityPerPack === 'number' &&
    Number.isFinite(params.quantityPerPack) &&
    params.quantityPerPack >= 1
  ) {
    payload.quantityPerPack = Math.min(10000, Math.round(params.quantityPerPack));
  }
  if (params.packLabel && params.packLabel.trim()) {
    payload.packLabel = params.packLabel.trim().slice(0, 30);
  }
  if (params.specsSummary && params.specsSummary.trim()) {
    payload.specsSummary = params.specsSummary.trim().slice(0, 240);
  }
  try {
    await setDoc(doc(db, 'products', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `products/${id}`);
  }
}

export async function updateRealProduct(
  productId: string,
  params: {
    name: string;
    sku: string;
    category: ProductCategory;
    subcategory?: string;
    unitType?: ProductUnitType;
    quantityPerPack?: number;
    packLabel?: string;
    specsSummary?: string;
    factoryPrice: number;
    stockBoxes: number;
    gradeRaw: string;
    imageUrl: string;
    imageUrls?: string[];
    isSoldOutToday?: boolean;
  }
): Promise<void> {
  const safePrice = Number.isFinite(params.factoryPrice)
    ? Math.min(100000000, Math.max(0, Number(params.factoryPrice.toFixed(2))))
    : 0;
  const safeStock = Number.isFinite(params.stockBoxes)
    ? Math.min(100000, Math.max(0, Math.round(params.stockBoxes)))
    : 0;
  const safeQtyPerPack =
    typeof params.quantityPerPack === 'number' &&
    Number.isFinite(params.quantityPerPack) &&
    params.quantityPerPack >= 1
      ? Math.min(10000, Math.round(params.quantityPerPack))
      : 1;

  const sanitizedImages = (
    Array.isArray(params.imageUrls) && params.imageUrls.length > 0
      ? params.imageUrls
      : [params.imageUrl]
  )
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .slice(0, 3)
    .map((u, idx) => u.slice(0, idx === 0 ? 350000 : 240000));
  const coverImage = sanitizedImages[0] || params.imageUrl.slice(0, 350000);

  const payload: Record<string, unknown> = {
    name: params.name.trim().slice(0, 120),
    sku: params.sku.trim().slice(0, 40),
    category: params.category,
    subcategory: (params.subcategory ?? '').trim().slice(0, 60),
    unitType: params.unitType ?? 'unidade',
    quantityPerPack: safeQtyPerPack,
    packLabel: (params.packLabel ?? '').trim().slice(0, 30),
    specsSummary: (params.specsSummary ?? '').trim().slice(0, 240),
    factoryPrice: safePrice,
    stockBoxes: safeStock,
    gradeRaw: (params.gradeRaw.trim() || 'Único:1').slice(0, 200),
    imageUrl: coverImage,
    imageUrls: sanitizedImages.length > 0 ? sanitizedImages : [coverImage],
    updatedAt: serverTimestamp(),
  };

  if (typeof params.isSoldOutToday === 'boolean') {
    payload.isSoldOutToday = params.isSoldOutToday;
  }

  try {
    await updateDoc(doc(db, 'products', productId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `products/${productId}`);
  }
}

export async function updateRealProductStock(
  productId: string,
  stockBoxes: number,
  isSoldOutToday: boolean
): Promise<void> {
  try {
    await updateDoc(doc(db, 'products', productId), {
      stockBoxes: Math.max(0, stockBoxes),
      isSoldOutToday,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `products/${productId}`);
  }
}

export function subscribeConnections(
  uid: string,
  callback: (connections: FactoryConnection[]) => void
): () => void {
  const qReseller = query(collection(db, 'connections'), where('resellerId', '==', uid));
  const qFactory = query(collection(db, 'connections'), where('factoryId', '==', uid));
  const qApproved = query(
    collection(db, 'connections'),
    where('approvalStatus', '==', 'approved')
  );

  let mineAsReseller: FactoryConnection[] = [];
  let mineAsFactory: FactoryConnection[] = [];
  let publicApproved: FactoryConnection[] = [];

  const emit = () => {
    const map = new Map<string, FactoryConnection>();
    for (const c of [...publicApproved, ...mineAsFactory, ...mineAsReseller]) {
      map.set(c.id, c);
    }
    callback(Array.from(map.values()));
  };

  const parse = (docSnap: {
    id: string;
    data: () => Record<string, unknown>;
  }): FactoryConnection => {
    const d = docSnap.data();
    const rawStatus = d.approvalStatus;
    const approvalStatus: ConnectionApprovalStatus =
      rawStatus === 'pending' || rawStatus === 'approved' || rawStatus === 'rejected'
        ? rawStatus
        : 'approved';
    return {
      id: docSnap.id,
      resellerId: String(d.resellerId),
      resellerName: typeof d.resellerName === 'string' ? d.resellerName : undefined,
      resellerStorefrontName:
        typeof d.resellerStorefrontName === 'string' ? d.resellerStorefrontName : undefined,
      factoryId: String(d.factoryId),
      factoryName: String(d.factoryName || ''),
      approvalStatus,
      deliveryPolicy: {
        type: (d.deliveryPolicyType as MinimumDeliveryPolicy['type']) ?? 'pieces',
        value: Number(d.deliveryPolicyValue ?? 1),
        allowCounterPickup: Boolean(d.deliveryPolicyPickup ?? false),
        label: String(d.deliveryPolicyLabel || ''),
      },
      reviewPhotos: Boolean(d.reviewPhotos),
      paused: Boolean(d.paused),
      margins: (d.margins as Record<string, CategoryMargin>) ?? DEFAULT_CATEGORY_MARGINS,
      approvedProductIds: Array.isArray(d.approvedProductIds)
        ? (d.approvedProductIds as string[])
        : [],
      rejectedProductIds: Array.isArray(d.rejectedProductIds)
        ? (d.rejectedProductIds as string[])
        : [],
    };
  };

  const u1 = onSnapshot(
    qReseller,
    (snap) => {
      mineAsReseller = snap.docs.map((ds) => parse({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'connections')
  );

  const u2 = onSnapshot(
    qFactory,
    (snap) => {
      mineAsFactory = snap.docs.map((ds) => parse({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'connections')
  );

  const u3 = onSnapshot(
    qApproved,
    (snap) => {
      publicApproved = snap.docs.map((ds) => parse({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'connections')
  );

  return () => {
    u1();
    u2();
    u3();
  };
}

export async function createRealFactoryConnection(params: {
  resellerId: string;
  resellerName: string;
  resellerStorefrontName: string;
  factory: PhoneLookupResult;
}): Promise<'created' | 'already_pending' | 'already_approved' | 're_requested'> {
  const connId = `conn_${params.resellerId}_${params.factory.uid}`.slice(0, 128);
  const connRef = doc(db, 'connections', connId);
  const cleanResellerName = (params.resellerName.trim() || 'Revendedor ChatFi').slice(0, 80);
  const cleanStorefrontName = (
    params.resellerStorefrontName.trim() || cleanResellerName
  ).slice(0, 80);
  const cleanFactoryName = (params.factory.displayName.trim() || 'Fabricante ChatFi').slice(0, 100);
  const safeDeliveryValue = Math.max(0, Number(params.factory.deliveryPolicy.value) || 0);

  try {
    const existingSnap = await getDoc(connRef);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      const status = String(existingData.approvalStatus || 'approved');
      if (status === 'approved') {
        return 'already_approved';
      }
      if (status === 'pending') {
        return 'already_pending';
      }
      await updateDoc(connRef, {
        approvalStatus: 'pending',
        resellerName: cleanResellerName,
        resellerStorefrontName: cleanStorefrontName,
        updatedAt: serverTimestamp(),
      });
      return 're_requested';
    }

    await setDoc(connRef, {
      resellerId: params.resellerId,
      resellerName: cleanResellerName,
      resellerStorefrontName: cleanStorefrontName,
      factoryId: params.factory.uid,
      factoryName: cleanFactoryName,
      approvalStatus: 'pending',
      deliveryPolicyType: params.factory.deliveryPolicy.type,
      deliveryPolicyValue: safeDeliveryValue,
      deliveryPolicyPickup: Boolean(params.factory.deliveryPolicy.allowCounterPickup),
      deliveryPolicyLabel: (params.factory.deliveryPolicy.label || '').slice(0, 160),
      reviewPhotos: true,
      paused: false,
      margins: DEFAULT_CATEGORY_MARGINS,
      approvedProductIds: [],
      rejectedProductIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return 'created';
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `connections/${connId}`);
    return 'created';
  }
}

export async function respondToResellerConnection(
  connectionId: string,
  decision: 'approved' | 'rejected'
): Promise<void> {
  try {
    await updateDoc(doc(db, 'connections', connectionId), {
      approvalStatus: decision,
      paused: decision === 'approved' ? false : true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `connections/${connectionId}`);
  }
}

export async function updateRealConnection(
  connectionId: string,
  updates: Partial<{
    approvalStatus: ConnectionApprovalStatus;
    resellerName: string;
    resellerStorefrontName: string;
    reviewPhotos: boolean;
    paused: boolean;
    margins: Record<string, CategoryMargin>;
    approvedProductIds: string[];
    rejectedProductIds: string[];
  }>
): Promise<void> {
  const sanitized: Record<string, unknown> = { ...updates };
  if (typeof updates.resellerName === 'string') {
    sanitized.resellerName = updates.resellerName.trim().slice(0, 80);
  }
  if (typeof updates.resellerStorefrontName === 'string') {
    sanitized.resellerStorefrontName = updates.resellerStorefrontName.trim().slice(0, 80);
  }
  try {
    await updateDoc(doc(db, 'connections', connectionId), {
      ...sanitized,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `connections/${connectionId}`);
  }
}

export function subscribeOrdersAndSubOrders(
  uid: string,
  callback: (orders: MixedOrder[]) => void
): () => void {
  const qBuyerO = query(collection(db, 'orders'), where('buyerId', '==', uid));
  const qResellerO = query(collection(db, 'orders'), where('resellerId', '==', uid));
  const qFactoryO = query(
    collection(db, 'orders'),
    where('factoryIds', 'array-contains', uid)
  );

  const qBuyerS = query(collection(db, 'sub_orders'), where('buyerId', '==', uid));
  const qResellerS = query(collection(db, 'sub_orders'), where('resellerId', '==', uid));
  const qFactoryS = query(collection(db, 'sub_orders'), where('factoryId', '==', uid));

  let o1: MixedOrder[] = [];
  let o2: MixedOrder[] = [];
  let o3: MixedOrder[] = [];
  let s1: SubOrder[] = [];
  let s2: SubOrder[] = [];
  let s3: SubOrder[] = [];

  const emit = () => {
    const subMap = new Map<string, SubOrder>();
    for (const s of [...s1, ...s2, ...s3]) {
      subMap.set(s.id, s);
    }
    const orderMap = new Map<string, MixedOrder>();
    for (const o of [...o1, ...o2, ...o3]) {
      orderMap.set(o.id, {
        ...o,
        subOrders: Array.from(subMap.values()).filter((sub) => sub.parentOrderId === o.id),
      });
    }
    callback(Array.from(orderMap.values()));
  };

  const parseOrder = (docSnap: { id: string; data: () => Record<string, unknown> }): MixedOrder => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      orderCode: String(d.orderCode),
      buyerId: String(d.buyerId),
      buyerName: String(d.buyerName || ''),
      resellerId: String(d.resellerId),
      storefrontName: String(d.storefrontName || ''),
      factoryIds: Array.isArray(d.factoryIds) ? (d.factoryIds as string[]) : [],
      createdAt: formatTimestampShort(d.createdAt as Timestamp | undefined) || 'Agora',
      status: (d.status as OrderStatus) ?? 'pending_inquiry',
      subOrders: [],
      discountMode: (d.discountMode as 'fixed' | 'percent') ?? 'fixed',
      discountValue: Number(d.discountValue ?? 0),
      discountAmount: Number(d.discountAmount ?? 0),
      buyerSubtotal: Number(d.buyerSubtotal ?? 0),
      buyerFinalTotal: Number(d.buyerFinalTotal ?? 0),
      factoryCostTotal: Number(d.factoryCostTotal ?? 0),
      paymentMethod:
        d.paymentMethod === 'credit_card' || d.paymentMethod === 'pix'
          ? d.paymentMethod
          : undefined,
      installments: typeof d.installments === 'number' ? d.installments : undefined,
      buyerChargedTotal: typeof d.buyerChargedTotal === 'number' ? d.buyerChargedTotal : undefined,
      gatewayFee: typeof d.gatewayFee === 'number' ? d.gatewayFee : undefined,
      platformFeeGross: typeof d.platformFeeGross === 'number' ? d.platformFeeGross : undefined,
      platformFeeNet: typeof d.platformFeeNet === 'number' ? d.platformFeeNet : undefined,
      minimumFeeApplied:
        typeof d.minimumFeeApplied === 'boolean' ? d.minimumFeeApplied : undefined,
      splitFactoryNet: typeof d.splitFactoryNet === 'number' ? d.splitFactoryNet : undefined,
      splitResellerNet: typeof d.splitResellerNet === 'number' ? d.splitResellerNet : undefined,
      asaasChargeId: d.asaasChargeId ? String(d.asaasChargeId) : undefined,
      asaasChargeStatus: d.asaasChargeStatus ? String(d.asaasChargeStatus) : undefined,
      asaasInvoiceUrl: d.asaasInvoiceUrl ? String(d.asaasInvoiceUrl) : undefined,
      asaasPixPayload: d.asaasPixPayload ? String(d.asaasPixPayload) : undefined,
      createdAtMs: typeof d.createdAtMs === 'number' ? d.createdAtMs : undefined,
      stockReserved: typeof d.stockReserved === 'boolean' ? d.stockReserved : undefined,
      stockRestored: typeof d.stockRestored === 'boolean' ? d.stockRestored : undefined,
      reservationExpiresAtMs:
        typeof d.reservationExpiresAtMs === 'number' ? d.reservationExpiresAtMs : undefined,
      cancelledAtMs: typeof d.cancelledAtMs === 'number' ? d.cancelledAtMs : undefined,
      cancelReason: d.cancelReason ? String(d.cancelReason) : undefined,
      cancelledByUid: d.cancelledByUid ? String(d.cancelledByUid) : undefined,
    };
  };

  const parseSub = (docSnap: { id: string; data: () => Record<string, unknown> }): SubOrder => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      parentOrderId: String(d.parentOrderId),
      subOrderCode: String(d.subOrderCode),
      factoryId: String(d.factoryId),
      factoryName: String(d.factoryName || ''),
      resellerId: String(d.resellerId),
      buyerId: String(d.buyerId),
      anonymousGroupLabel: String(d.anonymousGroupLabel || 'Lote A'),
      deliveryPolicyLabel: String(d.deliveryPolicyLabel || ''),
      items: Array.isArray(d.items) ? (d.items as SubOrderLineItem[]) : [],
      status: (d.status as OrderStatus) ?? 'pending_inquiry',
      factoryCost: Number(d.factoryCost ?? 0),
      buyerSubtotal: Number(d.buyerSubtotal ?? 0),
      logisticsType: (d.logisticsType as LogisticsType) ?? 'none',
      logisticsCompany: String(d.logisticsCompany || ''),
      logisticsAddress: String(d.logisticsAddress || ''),
      receiptNote: d.receiptNote ? String(d.receiptNote) : undefined,
      receiptUrl: d.receiptUrl ? String(d.receiptUrl) : undefined,
      receiptAttached: Boolean(d.receiptAttached),
      updatedAt: formatTimestampShort(d.updatedAt as Timestamp | undefined) || 'Agora',
    };
  };

  const unsubs = [
    onSnapshot(qBuyerO, (s) => { o1 = s.docs.map((ds) => parseOrder({ id: ds.id, data: () => ds.data() })); emit(); }, (e) => handleFirestoreError(e, OperationType.LIST, 'orders')),
    onSnapshot(qResellerO, (s) => { o2 = s.docs.map((ds) => parseOrder({ id: ds.id, data: () => ds.data() })); emit(); }, (e) => handleFirestoreError(e, OperationType.LIST, 'orders')),
    onSnapshot(qFactoryO, (s) => { o3 = s.docs.map((ds) => parseOrder({ id: ds.id, data: () => ds.data() })); emit(); }, (e) => handleFirestoreError(e, OperationType.LIST, 'orders')),
    onSnapshot(qBuyerS, (s) => { s1 = s.docs.map((ds) => parseSub({ id: ds.id, data: () => ds.data() })); emit(); }, (e) => handleFirestoreError(e, OperationType.LIST, 'sub_orders')),
    onSnapshot(qResellerS, (s) => { s2 = s.docs.map((ds) => parseSub({ id: ds.id, data: () => ds.data() })); emit(); }, (e) => handleFirestoreError(e, OperationType.LIST, 'sub_orders')),
    onSnapshot(qFactoryS, (s) => { s3 = s.docs.map((ds) => parseSub({ id: ds.id, data: () => ds.data() })); emit(); }, (e) => handleFirestoreError(e, OperationType.LIST, 'sub_orders')),
  ];

  return () => unsubs.forEach((u) => u());
}

export async function createRealMixedOrder(params: {
  orderId: string;
  orderCode: string;
  buyerId: string;
  buyerName: string;
  resellerId: string;
  storefrontName: string;
  subOrders: SubOrder[];
  buyerSubtotal: number;
  buyerFinalTotal: number;
  factoryCostTotal: number;
  paymentMethod?: 'pix' | 'credit_card';
  installments?: number;
  buyerChargedTotal?: number;
  gatewayFee?: number;
  platformFeeGross?: number;
  platformFeeNet?: number;
  minimumFeeApplied?: boolean;
  splitFactoryNet?: number;
  splitResellerNet?: number;
}): Promise<void> {
  const factoryIds = Array.from(new Set(params.subOrders.map((s) => s.factoryId)));

  const nowMs = Date.now();
  const reservationExpiresAtMs = nowMs + 2 * 60 * 60 * 1000;

  // Aggregate requested quantities per product so checkout atomically reserves stock for 2h
  const requestedByProduct = new Map<string, { qty: number; name: string }>();
  for (const sub of params.subOrders) {
    for (const item of sub.items) {
      if (!item.productId || item.boxesRequested <= 0) continue;
      const prev = requestedByProduct.get(item.productId);
      requestedByProduct.set(item.productId, {
        qty: (prev?.qty || 0) + item.boxesRequested,
        name: item.productName || prev?.name || 'Produto',
      });
    }
  }

  try {
    const orderDoc: Record<string, unknown> = {
      orderCode: params.orderCode,
      buyerId: params.buyerId,
      buyerName: params.buyerName.slice(0, 80),
      resellerId: params.resellerId,
      storefrontName: params.storefrontName.slice(0, 80),
      factoryIds,
      status: 'pending_inquiry',
      discountMode: 'fixed',
      discountValue: 0,
      discountAmount: 0,
      buyerSubtotal: params.buyerSubtotal,
      buyerFinalTotal: params.buyerFinalTotal,
      factoryCostTotal: params.factoryCostTotal,
      createdAtMs: nowMs,
      stockReserved: true,
      stockRestored: false,
      reservationExpiresAtMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (params.paymentMethod) orderDoc.paymentMethod = params.paymentMethod;
    if (typeof params.installments === 'number') orderDoc.installments = params.installments;
    if (typeof params.buyerChargedTotal === 'number') {
      orderDoc.buyerChargedTotal = params.buyerChargedTotal;
    }
    if (typeof params.gatewayFee === 'number') orderDoc.gatewayFee = params.gatewayFee;
    if (typeof params.platformFeeGross === 'number') {
      orderDoc.platformFeeGross = params.platformFeeGross;
    }
    if (typeof params.platformFeeNet === 'number') orderDoc.platformFeeNet = params.platformFeeNet;
    if (typeof params.minimumFeeApplied === 'boolean') {
      orderDoc.minimumFeeApplied = params.minimumFeeApplied;
    }
    if (typeof params.splitFactoryNet === 'number') {
      orderDoc.splitFactoryNet = params.splitFactoryNet;
    }
    if (typeof params.splitResellerNet === 'number') {
      orderDoc.splitResellerNet = params.splitResellerNet;
    }

    await runTransaction(db, async (tx) => {
      const productUpdates: Array<{
        ref: ReturnType<typeof doc>;
        nextStock: number;
        soldOut: boolean;
      }> = [];

      for (const [productId, reqInfo] of requestedByProduct.entries()) {
        const prodRef = doc(db, 'products', productId);
        const prodSnap = await tx.get(prodRef);
        if (!prodSnap.exists()) {
          throw new Error(`Produto "${reqInfo.name}" não está mais disponível no catálogo.`);
        }
        const pData = prodSnap.data() as Record<string, unknown>;
        const currentStock = Math.max(0, Number(pData.stockBoxes ?? 0));
        if (currentStock < reqInfo.qty) {
          throw new Error(
            `Estoque insuficiente para "${reqInfo.name}". Disponível: ${currentStock}.`
          );
        }
        const nextStock = currentStock - reqInfo.qty;
        productUpdates.push({
          ref: prodRef,
          nextStock,
          soldOut: nextStock <= 0 ? true : Boolean(pData.isSoldOutToday),
        });
      }

      tx.set(doc(db, 'orders', params.orderId), orderDoc);
      for (const pu of productUpdates) {
        tx.update(pu.ref, {
          stockBoxes: pu.nextStock,
          isSoldOutToday: pu.soldOut,
          lastStockOrderId: params.orderId,
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `orders/${params.orderId}`);
  }

  for (const sub of params.subOrders) {
    try {
      await setDoc(doc(db, 'sub_orders', sub.id), {
        parentOrderId: params.orderId,
        subOrderCode: sub.subOrderCode,
        factoryId: sub.factoryId,
        factoryName: sub.factoryName.slice(0, 100),
        resellerId: params.resellerId,
        buyerId: params.buyerId,
        anonymousGroupLabel: sub.anonymousGroupLabel,
        deliveryPolicyLabel: sub.deliveryPolicyLabel.slice(0, 160),
        items: sub.items,
        status: 'pending_inquiry',
        factoryCost: sub.factoryCost,
        buyerSubtotal: sub.buyerSubtotal,
        logisticsType: 'none',
        logisticsCompany: '',
        logisticsAddress: '',
        receiptAttached: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `sub_orders/${sub.id}`);
    }
  }

  // Due date +7 days formatted DD/MM/YYYY
  const due = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const dueDate = `${due.getDate().toString().padStart(2, '0')}/${(due.getMonth() + 1)
    .toString()
    .padStart(2, '0')}/${due.getFullYear()}`;

  // Dual Layer 2: Reseller <-> Buyer
  const payBuyerId = `pay_rb_${params.orderId}`;
  try {
    const payBuyerDoc: Record<string, unknown> = {
      orderId: params.orderId,
      orderCode: params.orderCode,
      layer: 'reseller_buyer',
      ownerId: params.resellerId,
      counterpartyId: params.buyerId,
      buyerId: params.buyerId,
      counterpartyName: params.buyerName.slice(0, 100),
      amount: params.buyerFinalTotal,
      costReference: params.factoryCostTotal,
      method: params.paymentMethod === 'credit_card' ? 'Cartão' : 'À vista',
      status: 'Aguardando',
      dueDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (typeof params.gatewayFee === 'number') payBuyerDoc.gatewayFee = params.gatewayFee;
    if (typeof params.platformFeeGross === 'number') {
      payBuyerDoc.platformFeeGross = params.platformFeeGross;
    }
    if (typeof params.platformFeeNet === 'number') {
      payBuyerDoc.platformFeeNet = params.platformFeeNet;
    }
    if (typeof params.splitResellerNet === 'number') {
      payBuyerDoc.netAmount = params.splitResellerNet;
    }
    await setDoc(doc(db, 'payments', payBuyerId), payBuyerDoc);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `payments/${payBuyerId}`);
  }

  // Dual Layer 1: Factory <-> Reseller
  for (const sub of params.subOrders) {
    const payFactoryId = `pay_fr_${sub.id}`;
    try {
      await setDoc(doc(db, 'payments', payFactoryId), {
        orderId: params.orderId,
        orderCode: params.orderCode,
        subOrderCode: sub.subOrderCode,
        layer: 'factory_reseller',
        ownerId: sub.factoryId,
        counterpartyId: params.resellerId,
        buyerId: params.buyerId,
        counterpartyName: params.storefrontName.slice(0, 100),
        amount: sub.factoryCost,
        method: 'Notinha',
        status: 'Aguardando',
        dueDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `payments/${payFactoryId}`);
    }
  }
}

export async function updateRealOrder(
  orderId: string,
  updates: Partial<{
    status: OrderStatus;
    discountMode: 'fixed' | 'percent';
    discountValue: number;
    discountAmount: number;
    buyerSubtotal: number;
    buyerFinalTotal: number;
    factoryCostTotal: number;
    paymentMethod: 'pix' | 'credit_card';
    installments: number;
    buyerChargedTotal: number;
    gatewayFee: number;
    platformFeeGross: number;
    platformFeeNet: number;
    minimumFeeApplied: boolean;
    splitFactoryNet: number;
    splitResellerNet: number;
    stockReserved: boolean;
    asaasChargeId: string;
    asaasChargeStatus: string;
    asaasInvoiceUrl: string;
    asaasPixPayload: string;
  }>
): Promise<void> {
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
  }
}

export async function updateRealSubOrder(
  subOrderId: string,
  updates: Partial<{
    items: SubOrderLineItem[];
    status: OrderStatus;
    factoryCost: number;
    buyerSubtotal: number;
    logisticsType: LogisticsType;
    logisticsCompany: string;
    logisticsAddress: string;
    receiptNote: string;
    receiptUrl: string;
    receiptAttached: boolean;
  }>
): Promise<void> {
  try {
    await updateDoc(doc(db, 'sub_orders', subOrderId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sub_orders/${subOrderId}`);
  }
}

export function subscribePayments(
  uid: string,
  callback: (payments: DualPaymentRecord[]) => void
): () => void {
  const qOwner = query(collection(db, 'payments'), where('ownerId', '==', uid));
  const qCounter = query(collection(db, 'payments'), where('counterpartyId', '==', uid));

  let p1: DualPaymentRecord[] = [];
  let p2: DualPaymentRecord[] = [];

  const emit = () => {
    const map = new Map<string, DualPaymentRecord>();
    for (const p of [...p1, ...p2]) {
      map.set(p.id, p);
    }
    callback(Array.from(map.values()));
  };

  const parse = (docSnap: { id: string; data: () => Record<string, unknown> }): DualPaymentRecord => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      orderId: String(d.orderId),
      orderCode: String(d.orderCode),
      subOrderCode: d.subOrderCode ? String(d.subOrderCode) : undefined,
      layer: (d.layer as 'factory_reseller' | 'reseller_buyer') ?? 'reseller_buyer',
      ownerId: String(d.ownerId),
      counterpartyId: String(d.counterpartyId),
      buyerId: d.buyerId ? String(d.buyerId) : undefined,
      counterpartyName: String(d.counterpartyName || ''),
      amount: Number(d.amount ?? 0),
      costReference: typeof d.costReference === 'number' ? d.costReference : undefined,
      gatewayFee: typeof d.gatewayFee === 'number' ? d.gatewayFee : undefined,
      platformFeeGross: typeof d.platformFeeGross === 'number' ? d.platformFeeGross : undefined,
      platformFeeNet: typeof d.platformFeeNet === 'number' ? d.platformFeeNet : undefined,
      netAmount: typeof d.netAmount === 'number' ? d.netAmount : undefined,
      asaasChargeId: d.asaasChargeId ? String(d.asaasChargeId) : undefined,
      asaasChargeStatus: d.asaasChargeStatus ? String(d.asaasChargeStatus) : undefined,
      method: (d.method as PaymentMethod) ?? 'À vista',
      status: (d.status as PaymentStatus) ?? 'Aguardando',
      dueDate: String(d.dueDate || ''),
      lastReminderSent: d.lastReminderSent ? String(d.lastReminderSent) : undefined,
    };
  };

  const u1 = onSnapshot(
    qOwner,
    (snap) => {
      p1 = snap.docs.map((ds) => parse({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'payments')
  );

  const u2 = onSnapshot(
    qCounter,
    (snap) => {
      p2 = snap.docs.map((ds) => parse({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'payments')
  );

  return () => {
    u1();
    u2();
  };
}

export async function updateRealPayment(
  paymentId: string,
  updates: Partial<{
    amount: number;
    costReference: number;
    gatewayFee: number;
    platformFeeGross: number;
    platformFeeNet: number;
    netAmount: number;
    asaasChargeId: string;
    asaasChargeStatus: string;
    method: PaymentMethod;
    status: PaymentStatus;
    lastReminderSent: string;
  }>
): Promise<void> {
  try {
    await updateDoc(doc(db, 'payments', paymentId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `payments/${paymentId}`);
  }
}

export async function fetchPublicUserStorefront(uid: string): Promise<{
  uid: string;
  displayName: string;
  commercialMode: CommercialMode;
  hasStorefront: boolean;
  storefrontName: string;
  factoryName: string;
  anchorDiscountPercent: number;
  deliveryPolicy: MinimumDeliveryPolicy;
  subscriptionStatus: SubscriptionStatus;
  ratingAverage: number;
  ratingCount: number;
  commercialBanned: boolean;
} | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    const commercialBanned = Boolean(d.commercialBanned);
    return {
      uid,
      displayName: String(d.displayName || ''),
      commercialMode: commercialBanned
        ? 'buyer'
        : ((d.commercialMode as CommercialMode) ?? 'buyer'),
      hasStorefront: commercialBanned ? false : Boolean(d.hasStorefront),
      storefrontName: String(d.storefrontName || d.factoryName || d.displayName || ''),
      factoryName: String(d.factoryName || d.displayName || ''),
      anchorDiscountPercent: Math.min(
        80,
        Math.max(0, Math.round(Number(d.anchorDiscountPercent ?? 0) || 0))
      ),
      deliveryPolicy: {
        type: (d.deliveryPolicyType as MinimumDeliveryPolicy['type']) ?? 'pieces',
        value: Number(d.deliveryPolicyValue ?? 1),
        allowCounterPickup: Boolean(d.deliveryPolicyPickup ?? false),
        label: String(d.deliveryPolicyLabel || ''),
      },
      subscriptionStatus: (d.subscriptionStatus as SubscriptionStatus) ?? 'free',
      ratingAverage: Number(d.ratingAverage ?? 0) || 0,
      ratingCount: Math.max(0, Math.round(Number(d.ratingCount ?? 0) || 0)),
      commercialBanned,
    };
  } catch {
    return null;
  }
}

// --- UNIFIED CPF + RECOVERY EMAIL AUTHENTICATION (STRICT 1 VIRTUAL LINE PER CPF) ---

export class CpfAuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CpfAuthError';
  }
}

function formatDateTimePtBr(ts: Timestamp | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return 'Agora';
  const d = ts.toDate();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} às ${hh}:${min}`;
}

export async function checkCpfRegistered(
  cpfRaw: string
): Promise<{ exists: boolean; virtualLine?: string }> {
  if (!isValidCpf(cpfRaw)) return { exists: false };
  const cpfHash = await hashCpfSha256(cpfRaw);
  if (!cpfHash) return { exists: false };
  try {
    const snap = await getDoc(doc(db, 'cpf_registry', cpfHash));
    if (!snap.exists()) return { exists: false };
    return {
      exists: true,
      virtualLine: String(snap.data().virtualLine || ''),
    };
  } catch {
    return { exists: false };
  }
}

export async function registerAccountWithCpf(params: {
  name: string;
  cpfRaw: string;
  recoveryEmail: string;
  password: string;
  statusMessage?: string;
  avatarUrl?: string;
  deviceInfo?: LocalDeviceInfo;
}): Promise<{ user: User; virtualLine: string }> {
  const cleanName = params.name.trim();
  const cleanEmail = params.recoveryEmail.trim().toLowerCase();
  if (!cleanName || cleanName.length < 2) {
    throw new CpfAuthError('invalid-name', 'Informe seu nome completo para criar a conta.');
  }
  if (!isValidCpf(params.cpfRaw)) {
    throw new CpfAuthError('invalid-cpf', 'CPF inválido. Confira os 11 dígitos e tente novamente.');
  }
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new CpfAuthError('invalid-email', 'Informe um e-mail de recuperação válido.');
  }
  if (params.password.length < 6) {
    throw new CpfAuthError('weak-password', 'A senha precisa ter pelo menos 6 caracteres.');
  }

  const cpfHash = await hashCpfSha256(params.cpfRaw);
  if (!cpfHash) {
    throw new CpfAuthError('invalid-cpf', 'Não foi possível validar o CPF informado.');
  }

  // Fast pre-check before creating Auth credential
  const cpfRef = doc(db, 'cpf_registry', cpfHash);
  const existingSnap = await getDoc(cpfRef);
  if (existingSnap.exists()) {
    throw new CpfAuthError(
      'cpf-already-exists',
      'Este CPF já possui uma conta e Linha Virtual ativa no ChatFi.'
    );
  }

  // Create Firebase Auth user using recovery email + password
  let newUser: User;
  try {
    const credential = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
    newUser = credential.user;
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code === 'auth/email-already-in-use') {
      throw new CpfAuthError(
        'auth/email-already-in-use',
        'Este e-mail de recuperação já está vinculado a outra conta. Use outro e-mail ou entre na sua conta existente.'
      );
    }
    if (code === 'auth/operation-not-allowed') {
      throw new CpfAuthError(
        'auth/operation-not-allowed',
        'O login por E-mail/Senha ainda precisa ser ativado no Firebase Console (Authentication → Sign-in method → E-mail/senha).'
      );
    }
    if (code === 'auth/weak-password') {
      throw new CpfAuthError('weak-password', 'Escolha uma senha mais forte (mínimo 6 caracteres).');
    }
    throw err;
  }

  const virtualLine = generateVirtualLine();

  // Atomic Firestore transaction guaranteeing strictly 1 Virtual Line per CPF
  try {
    await runTransaction(db, async (tx) => {
      const txSnap = await tx.get(cpfRef);
      if (txSnap.exists()) {
        throw new CpfAuthError(
          'cpf-already-exists',
          'Este CPF já possui uma conta e Linha Virtual ativa no ChatFi.'
        );
      }
      tx.set(cpfRef, {
        ownerId: newUser.uid,
        virtualLine,
        recoveryEmail: cleanEmail,
        createdAt: serverTimestamp(),
      });
    });
  } catch (txErr) {
    // Roll back Auth user if CPF collision happened concurrently
    try {
      await deleteUser(newUser);
    } catch {
      await signOut(auth).catch(() => {});
    }
    if (txErr instanceof CpfAuthError) {
      throw txErr;
    }
    throw new CpfAuthError(
      'cpf-transaction-failed',
      'Não foi possível reservar sua Linha Virtual agora. Tente novamente.'
    );
  }

  // Save primary device BEFORE writing users/{uid} so onSnapshot unlocks directly with zero device-check race
  const resolvedDevice = params.deviceInfo ?? getOrCreateLocalDeviceInfo();
  await registerOrUpdateUserProfile({
    uid: newUser.uid,
    email: cleanEmail,
    displayName: cleanName,
    phone: virtualLine,
    virtualLine,
    authMethod: 'cpf',
    cpfHash,
    statusMessage: sanitizeStatusMessage(params.statusMessage) || DEFAULT_STATUS_MESSAGE,
    avatarUrl: params.avatarUrl || '',
    primaryDevice: resolvedDevice,
  });

  await checkCommercialBanStatus({
    uid: newUser.uid,
    cpfHash,
    virtualLine,
  });

  return { user: newUser, virtualLine };
}

export async function signInWithCpfAndPassword(
  cpfRaw: string,
  password: string
): Promise<{ user: User; virtualLine: string }> {
  if (!isValidCpf(cpfRaw)) {
    throw new CpfAuthError('invalid-cpf', 'CPF inválido. Confira os 11 dígitos digitados.');
  }
  if (!password) {
    throw new CpfAuthError('missing-password', 'Digite sua senha para entrar.');
  }

  const cpfHash = await hashCpfSha256(cpfRaw);
  const snap = await getDoc(doc(db, 'cpf_registry', cpfHash));
  if (!snap.exists()) {
    throw new CpfAuthError(
      'cpf-not-found',
      'Nenhuma conta encontrada com este CPF. Toque em "Criar Conta" para gerar sua Linha Virtual.'
    );
  }

  const data = snap.data();
  const recoveryEmail = String(data.recoveryEmail || '').trim().toLowerCase();
  const virtualLine = String(data.virtualLine || '');
  if (!recoveryEmail) {
    throw new CpfAuthError('cpf-not-found', 'Cadastro de CPF incompleto. Tente novamente.');
  }

  try {
    const credential = await signInWithEmailAndPassword(auth, recoveryEmail, password);
    return { user: credential.user, virtualLine };
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential' ||
      code === 'auth/invalid-login-credentials'
    ) {
      throw new CpfAuthError(
        'wrong-password',
        'Senha incorreta para este CPF. Tente novamente ou use "Esqueci minha senha".'
      );
    }
    if (code === 'auth/too-many-requests') {
      throw new CpfAuthError(
        'too-many-requests',
        'Muitas tentativas seguidas. Aguarde alguns minutos ou redefina sua senha.'
      );
    }
    if (code === 'auth/operation-not-allowed') {
      throw new CpfAuthError(
        'auth/operation-not-allowed',
        'O provedor E-mail/Senha precisa estar ativado no Firebase Console.'
      );
    }
    throw err;
  }
}

export async function sendCpfPasswordReset(
  cpfRaw: string
): Promise<{ maskedEmail: string }> {
  if (!isValidCpf(cpfRaw)) {
    throw new CpfAuthError('invalid-cpf', 'Digite um CPF válido para recuperar sua senha.');
  }
  const cpfHash = await hashCpfSha256(cpfRaw);
  const snap = await getDoc(doc(db, 'cpf_registry', cpfHash));
  if (!snap.exists()) {
    throw new CpfAuthError(
      'cpf-not-found',
      'Nenhuma conta encontrada com este CPF no ChatFi.'
    );
  }
  const recoveryEmail = String(snap.data().recoveryEmail || '').trim().toLowerCase();
  if (!recoveryEmail) {
    throw new CpfAuthError(
      'no-recovery-email',
      'Esta conta não possui e-mail de recuperação cadastrado.'
    );
  }
  auth.languageCode = 'pt-BR';
  await sendPasswordResetEmail(auth, recoveryEmail);
  return { maskedEmail: maskEmailForDisplay(recoveryEmail) };
}

// --- CONNECTED DEVICES & REAL-TIME QR / 6-DIGIT DEVICE AUTHORIZATION ---

export async function createDeviceAuthRequest(
  uid: string,
  deviceInfo: LocalDeviceInfo
): Promise<DeviceAuthRequest> {
  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const requestToken = generateRequestToken();
  const code6 = generateSixDigitCode();
  const expiresAtMs = Date.now() + 10 * 60 * 1000; // 10 minutes validity

  try {
    await setDoc(doc(db, 'auth_requests', requestId), {
      uid,
      requestToken,
      code6,
      deviceId: deviceInfo.deviceId,
      deviceName: deviceInfo.deviceName.slice(0, 100),
      platform: deviceInfo.platform.slice(0, 60),
      status: 'pending',
      expiresAtMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `auth_requests/${requestId}`);
  }

  return {
    id: requestId,
    uid,
    requestToken,
    code6,
    deviceId: deviceInfo.deviceId,
    deviceName: deviceInfo.deviceName,
    platform: deviceInfo.platform,
    status: 'pending',
    expiresAtMs,
    createdAtMs: Date.now(),
  };
}

export async function registerPrimaryDeviceForAccount(
  uid: string,
  deviceInfo: LocalDeviceInfo
): Promise<void> {
  try {
    await setDoc(doc(db, 'users', uid, 'devices', deviceInfo.deviceId), {
      ownerId: uid,
      deviceId: deviceInfo.deviceId,
      deviceName: deviceInfo.deviceName.slice(0, 100),
      platform: deviceInfo.platform.slice(0, 60),
      primary: true,
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `users/${uid}/devices/${deviceInfo.deviceId}`
    );
  }
  try {
    localStorage.setItem(`zapei_device_auth_uid_${deviceInfo.deviceId}`, uid);
  } catch {
    // ignore storage errors
  }
}

export async function ensureCurrentDeviceRegisteredSilently(
  uid: string,
  deviceInfo: LocalDeviceInfo
): Promise<void> {
  try {
    await setDoc(doc(db, 'users', uid, 'devices', deviceInfo.deviceId), {
      ownerId: uid,
      deviceId: deviceInfo.deviceId,
      deviceName: deviceInfo.deviceName.slice(0, 100),
      platform: deviceInfo.platform.slice(0, 60),
      primary: true,
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal background sync for legacy accounts
  }
}

export async function registerOrCheckCurrentDevice(
  uid: string,
  deviceInfo: LocalDeviceInfo
): Promise<
  | { authorized: true; isPrimary: boolean }
  | { authorized: false; request: DeviceAuthRequest; activeDeviceCount: number }
> {
  const devicesCol = collection(db, 'users', uid, 'devices');
  const qDevices = query(devicesCol, where('ownerId', '==', uid));
  let snap;
  try {
    snap = await getDocsFromServer(qDevices);
  } catch {
    snap = await getDocs(qDevices);
  }

  const existingDocs = snap.docs;
  const selfDoc = existingDocs.find((d) => d.id === deviceInfo.deviceId);
  const hasActivePrimaryDevice = existingDocs.some((d) => Boolean(d.data().primary));

  if (selfDoc) {
    let isPrimary = Boolean(selfDoc.data().primary);
    if (!hasActivePrimaryDevice) {
      try {
        await updateDoc(doc(db, 'users', uid, 'devices', deviceInfo.deviceId), {
          deviceName: deviceInfo.deviceName.slice(0, 100),
          platform: deviceInfo.platform.slice(0, 60),
          primary: true,
          lastActiveAt: serverTimestamp(),
        });
        isPrimary = true;
      } catch {
        // Non-fatal promotion fallback
      }
    }
    return { authorized: true, isPrimary };
  }

  // First device OR no active primary device registered yet -> promote this device directly as Aparelho Principal
  if (existingDocs.length === 0 || !hasActivePrimaryDevice) {
    await registerPrimaryDeviceForAccount(uid, deviceInfo);
    return { authorized: true, isPrimary: true };
  }

  // Another device is already active -> reuse an unexpired pending request from this same device if available
  try {
    const qPending = query(collection(db, 'auth_requests'), where('uid', '==', uid));
    const reqSnap = await getDocs(qPending);
    const now = Date.now();
    const reusable = reqSnap.docs
      .map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          uid: String(d.uid),
          requestToken: String(d.requestToken || ''),
          code6: String(d.code6 || ''),
          deviceId: String(d.deviceId || ''),
          deviceName: String(d.deviceName || deviceInfo.deviceName),
          platform: String(d.platform || deviceInfo.platform),
          status: (d.status as DeviceAuthRequest['status']) ?? 'pending',
          approvedByDeviceId: d.approvedByDeviceId ? String(d.approvedByDeviceId) : undefined,
          expiresAtMs: Number(d.expiresAtMs || 0),
          createdAtMs: timestampToMs(d.createdAt as Timestamp | undefined),
        };
      })
      .filter(
        (r) =>
          r.status === 'pending' &&
          r.deviceId === deviceInfo.deviceId &&
          r.expiresAtMs > now + 30_000
      )
      .sort((a, b) => b.createdAtMs - a.createdAtMs)[0];

    if (reusable) {
      return {
        authorized: false,
        request: reusable,
        activeDeviceCount: existingDocs.length,
      };
    }
  } catch {
    // Fall through and create a fresh request
  }

  // Another device is already active -> require real-time QR Code or 6-digit password approval!
  const request = await createDeviceAuthRequest(uid, deviceInfo);
  return {
    authorized: false,
    request,
    activeDeviceCount: existingDocs.length,
  };
}

export function subscribeUserDevices(
  uid: string,
  callback: (devices: ConnectedDevice[], meta: { fromCache: boolean }) => void
): () => void {
  const qDevices = query(
    collection(db, 'users', uid, 'devices'),
    where('ownerId', '==', uid)
  );
  return onSnapshot(
    qDevices,
    (snap) => {
      const list: ConnectedDevice[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const createdAtTs = d.createdAt as Timestamp | undefined;
        const lastActiveTs = d.lastActiveAt as Timestamp | undefined;
        return {
          deviceId: String(d.deviceId || docSnap.id),
          ownerId: String(d.ownerId || uid),
          deviceName: String(d.deviceName || 'Dispositivo'),
          platform: String(d.platform || 'Web'),
          primary: Boolean(d.primary),
          authorizedByDeviceId: d.authorizedByDeviceId
            ? String(d.authorizedByDeviceId)
            : undefined,
          createdAtLabel: formatDateTimePtBr(createdAtTs),
          lastActiveAtLabel: formatDateTimePtBr(lastActiveTs),
          createdAtMs: timestampToMs(createdAtTs),
          lastActiveAtMs: timestampToMs(lastActiveTs),
        };
      });
      list.sort(
        (a, b) =>
          Number(b.primary) - Number(a.primary) || b.lastActiveAtMs - a.lastActiveAtMs
      );
      callback(list, { fromCache: snap.metadata.fromCache });
    },
    (error) => {
      console.error('Connected devices listener error:', error);
    }
  );
}

export function subscribeAuthRequestById(
  requestId: string,
  callback: (request: DeviceAuthRequest | null) => void
): () => void {
  return onSnapshot(
    doc(db, 'auth_requests', requestId),
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      const d = snap.data();
      callback({
        id: snap.id,
        uid: String(d.uid),
        requestToken: String(d.requestToken || ''),
        code6: String(d.code6 || ''),
        deviceId: String(d.deviceId || ''),
        deviceName: String(d.deviceName || 'Novo Aparelho'),
        platform: String(d.platform || 'Web'),
        status: (d.status as DeviceAuthRequest['status']) ?? 'pending',
        approvedByDeviceId: d.approvedByDeviceId
          ? String(d.approvedByDeviceId)
          : undefined,
        expiresAtMs: Number(d.expiresAtMs || 0),
        createdAtMs: timestampToMs(d.createdAt as Timestamp | undefined),
      });
    },
    (error) => {
      console.error('Auth request watch error:', error);
    }
  );
}

export function subscribePendingAuthRequestsForUser(
  uid: string,
  currentDeviceId: string,
  callback: (requests: DeviceAuthRequest[]) => void
): () => void {
  const qReqs = query(collection(db, 'auth_requests'), where('uid', '==', uid));
  return onSnapshot(
    qReqs,
    (snap) => {
      const now = Date.now();
      const sortedPending: DeviceAuthRequest[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            uid: String(d.uid),
            requestToken: String(d.requestToken || ''),
            code6: String(d.code6 || ''),
            deviceId: String(d.deviceId || ''),
            deviceName: String(d.deviceName || 'Novo Aparelho'),
            platform: String(d.platform || 'Web'),
            status: (d.status as DeviceAuthRequest['status']) ?? 'pending',
            approvedByDeviceId: d.approvedByDeviceId
              ? String(d.approvedByDeviceId)
              : undefined,
            expiresAtMs: Number(d.expiresAtMs || 0),
            createdAtMs: timestampToMs(d.createdAt as Timestamp | undefined),
          };
        })
        .filter(
          (req) =>
            req.status === 'pending' &&
            req.deviceId !== currentDeviceId &&
            (req.expiresAtMs === 0 || req.expiresAtMs > now)
        )
        .sort((a, b) => b.createdAtMs - a.createdAtMs);

      // Deduplicate by requesting deviceId so the already-connected device only sees 1 clean prompt per new device
      const seenDevices = new Set<string>();
      const pending: DeviceAuthRequest[] = [];
      for (const req of sortedPending) {
        if (seenDevices.has(req.deviceId)) continue;
        seenDevices.add(req.deviceId);
        pending.push(req);
      }
      callback(pending);
    },
    (error) => {
      console.error('Pending auth_requests listener error:', error);
    }
  );
}

export async function approveDeviceAuthRequest(params: {
  uid: string;
  request: DeviceAuthRequest;
  approverDeviceId: string;
}): Promise<void> {
  const { uid, request, approverDeviceId } = params;
  // 1. Register the newly authorized device under users/{uid}/devices/{deviceId}
  try {
    await setDoc(doc(db, 'users', uid, 'devices', request.deviceId), {
      ownerId: uid,
      deviceId: request.deviceId,
      deviceName: request.deviceName.slice(0, 100),
      platform: request.platform.slice(0, 60),
      primary: false,
      authorizedByDeviceId: approverDeviceId.slice(0, 128),
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `users/${uid}/devices/${request.deviceId}`
    );
  }

  // 2. Mark the request as approved so the waiting device unlocks in real time
  try {
    await updateDoc(doc(db, 'auth_requests', request.id), {
      status: 'approved',
      approvedByDeviceId: approverDeviceId.slice(0, 128),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `auth_requests/${request.id}`);
  }
}

export async function rejectDeviceAuthRequest(
  requestId: string,
  approverDeviceId: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'auth_requests', requestId), {
      status: 'rejected',
      approvedByDeviceId: approverDeviceId.slice(0, 128),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `auth_requests/${requestId}`);
  }
}

export async function disconnectUserDevice(
  uid: string,
  targetDeviceId: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', uid, 'devices', targetDeviceId));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `users/${uid}/devices/${targetDeviceId}`
    );
  }
}

/**
 * Allows an already-authenticated user to transfer Primary Device ownership to the
 * current device when their previously connected device (e.g., a PC) is powered off
 * or unavailable. Disconnects all other registered devices and removes the pending request.
 */
export async function takeOverAsPrimaryDevice(
  uid: string,
  deviceInfo: LocalDeviceInfo,
  pendingRequestId?: string
): Promise<void> {
  const devicesCol = collection(db, 'users', uid, 'devices');
  const qDevices = query(devicesCol, where('ownerId', '==', uid));
  let snap;
  try {
    snap = await getDocsFromServer(qDevices);
  } catch {
    snap = await getDocs(qDevices);
  }

  let selfExists = false;
  const deletePromises: Array<Promise<void>> = [];
  for (const d of snap.docs) {
    if (d.id === deviceInfo.deviceId) {
      selfExists = true;
    } else {
      deletePromises.push(deleteDoc(doc(db, 'users', uid, 'devices', d.id)));
    }
  }

  if (deletePromises.length > 0) {
    await Promise.all(deletePromises);
  }

  const selfRef = doc(db, 'users', uid, 'devices', deviceInfo.deviceId);
  try {
    if (selfExists) {
      await updateDoc(selfRef, {
        deviceName: deviceInfo.deviceName.slice(0, 100),
        platform: deviceInfo.platform.slice(0, 60),
        primary: true,
        lastActiveAt: serverTimestamp(),
      });
    } else {
      await setDoc(selfRef, {
        ownerId: uid,
        deviceId: deviceInfo.deviceId,
        deviceName: deviceInfo.deviceName.slice(0, 100),
        platform: deviceInfo.platform.slice(0, 60),
        primary: true,
        createdAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(
      error,
      selfExists ? OperationType.UPDATE : OperationType.CREATE,
      `users/${uid}/devices/${deviceInfo.deviceId}`
    );
  }

  if (pendingRequestId) {
    await deleteDoc(doc(db, 'auth_requests', pendingRequestId)).catch(() => {});
  }

  try {
    localStorage.setItem(`zapei_device_auth_uid_${deviceInfo.deviceId}`, uid);
  } catch {
    // ignore storage errors
  }
}

export async function sendDeviceTakeoverSmsCode(
  recaptchaContainerId = 'zapei-takeover-recaptcha'
): Promise<ConfirmationResult> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.phoneNumber) {
    throw new Error('Esta conta não possui um telefone verificado por SMS.');
  }

  clearPhoneRecaptcha(recaptchaContainerId);
  auth.languageCode = 'pt-BR';

  let wrapper = document.getElementById(recaptchaContainerId);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = recaptchaContainerId;
    document.body.appendChild(wrapper);
  }
  wrapper.replaceChildren();

  const freshHost = document.createElement('div');
  freshHost.id = `zapei-takeover-host-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  wrapper.appendChild(freshHost);
  activeRecaptchaHost = freshHost;

  const verifier = new RecaptchaVerifier(auth, freshHost, {
    size: 'invisible',
  });
  activeRecaptchaVerifier = verifier;

  try {
    return await reauthenticateWithPhoneNumber(
      currentUser,
      currentUser.phoneNumber,
      verifier
    );
  } catch (error) {
    clearPhoneRecaptcha(recaptchaContainerId);
    throw error;
  }
}

export async function confirmDeviceTakeoverSmsCode(
  confirmationResult: ConfirmationResult,
  smsCode: string,
  recaptchaContainerId = 'zapei-takeover-recaptcha'
): Promise<void> {
  await confirmationResult.confirm(smsCode.trim());
  clearPhoneRecaptcha(recaptchaContainerId);
}

export async function verifyCpfAccountForDeviceTakeover(params: {
  uid: string;
  cpfRaw: string;
  password: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== params.uid) {
    throw new CpfAuthError('not-signed-in', 'Sessão expirada. Entre novamente na sua conta.');
  }
  if (!isValidCpf(params.cpfRaw)) {
    throw new CpfAuthError('invalid-cpf', 'CPF inválido. Confira os 11 dígitos digitados.');
  }
  if (!params.password) {
    throw new CpfAuthError('missing-password', 'Digite a senha da sua conta para confirmar.');
  }

  const cpfHash = await hashCpfSha256(params.cpfRaw);
  const snap = await getDoc(doc(db, 'cpf_registry', cpfHash));
  if (!snap.exists()) {
    throw new CpfAuthError('cpf-not-found', 'O CPF informado não corresponde a esta conta.');
  }

  const data = snap.data();
  if (String(data.ownerId || '') !== params.uid) {
    throw new CpfAuthError(
      'cpf-mismatch',
      'Este CPF pertence a outra conta. Informe o CPF cadastrado nesta conta.'
    );
  }

  const recoveryEmail = String(data.recoveryEmail || currentUser.email || '')
    .trim()
    .toLowerCase();
  if (!recoveryEmail) {
    throw new CpfAuthError(
      'no-recovery-email',
      'Não foi possível localizar o e-mail de recuperação desta conta.'
    );
  }

  try {
    const credential = EmailAuthProvider.credential(recoveryEmail, params.password);
    await reauthenticateWithCredential(currentUser, credential);
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential' ||
      code === 'auth/invalid-login-credentials'
    ) {
      throw new CpfAuthError(
        'wrong-password',
        'Senha incorreta. Tente novamente ou envie o link para seu e-mail de recuperação.'
      );
    }
    if (code === 'auth/too-many-requests') {
      throw new CpfAuthError(
        'too-many-requests',
        'Muitas tentativas seguidas. Aguarde alguns minutos ou use o link de recuperação.'
      );
    }
    throw err;
  }
}

export async function sendRecoveryEmailForSignedInCpfUser(): Promise<{
  maskedEmail: string;
}> {
  const currentUser = auth.currentUser;
  const email = currentUser?.email?.trim().toLowerCase() || '';
  if (!email) {
    throw new CpfAuthError(
      'no-recovery-email',
      'Nenhum e-mail de recuperação vinculado a esta conta.'
    );
  }
  auth.languageCode = 'pt-BR';
  await sendPasswordResetEmail(auth, email);
  return { maskedEmail: maskEmailForDisplay(email) };
}

// --- HELP CENTER & SUPPORT TICKETS (support_tickets) ---

const localSupportStorageKey = (uid: string) => `chatfi_support_tickets_v1_${uid}`;
const localSupportListeners = new Map<string, Set<() => void>>();

function getErrorCodeString(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  const msg = error instanceof Error ? error.message : String(error || '');
  return msg.toLowerCase().includes('permission') ? 'permission-denied' : '';
}

function loadLocalSupportTickets(uid: string): SupportTicket[] {
  if (!uid || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(localSupportStorageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SupportTicket[]) : [];
  } catch {
    return [];
  }
}

function saveLocalSupportTickets(uid: string, list: SupportTicket[]): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      localSupportStorageKey(uid),
      JSON.stringify(list.slice(0, 100))
    );
  } catch {
    // Ignore storage quota errors
  }
  const listeners = localSupportListeners.get(uid);
  if (listeners) {
    listeners.forEach((fn) => fn());
  }
}

function formatNowPtBr(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

export async function createSupportTicket(params: {
  userId: string;
  userName: string;
  userVirtualLine?: string;
  userRole: CommercialMode;
  reason: SupportTicketReason;
  orderId?: string;
  orderCode?: string;
  description: string;
}): Promise<{ id: string; ticketCode: string }> {
  const ticketId = `sup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const ticketCode = `SUP-${Math.floor(1000 + Math.random() * 9000)}`;
  const cleanDescription = params.description.trim().slice(0, 2000);
  const cleanUserName = (params.userName.trim() || 'Usuário ChatFi').slice(0, 80);

  const payload: Record<string, unknown> = {
    ticketCode,
    userId: params.userId,
    userName: cleanUserName,
    userRole: params.userRole,
    reason: params.reason,
    description: cleanDescription,
    status: 'Aberto',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (params.userVirtualLine && params.userVirtualLine.trim()) {
    payload.userVirtualLine = params.userVirtualLine.trim().slice(0, 32);
  }
  if (params.orderId && params.orderId.trim()) {
    payload.orderId = params.orderId.trim().slice(0, 128);
  }
  if (params.orderCode && params.orderCode.trim()) {
    payload.orderCode = params.orderCode.trim().slice(0, 32);
  }

  try {
    await setDoc(doc(db, 'support_tickets', ticketId), payload);
  } catch (error) {
    const code = getErrorCodeString(error);
    if (code !== 'permission-denied') {
      handleFirestoreError(error, OperationType.CREATE, `support_tickets/${ticketId}`);
    }
    const nowLabel = formatNowPtBr();
    const localTicket: SupportTicket = {
      id: ticketId,
      ticketCode,
      userId: params.userId,
      userName: cleanUserName,
      userVirtualLine: params.userVirtualLine?.trim() || undefined,
      userRole: params.userRole,
      reason: params.reason,
      orderId: params.orderId?.trim() || undefined,
      orderCode: params.orderCode?.trim() || undefined,
      description: cleanDescription,
      status: 'Aberto',
      createdAt: nowLabel,
      updatedAt: nowLabel,
      createdAtMs: Date.now(),
    };
    const existing = loadLocalSupportTickets(params.userId);
    saveLocalSupportTickets(params.userId, [localTicket, ...existing]);
  }

  return { id: ticketId, ticketCode };
}

export function subscribeUserSupportTickets(
  uid: string,
  callback: (tickets: SupportTicket[]) => void
): () => void {
  let remoteTickets: SupportTicket[] = [];
  const emitMerged = () => {
    const localTickets = loadLocalSupportTickets(uid);
    const byId = new Map<string, SupportTicket>();
    for (const t of localTickets) byId.set(t.id, t);
    for (const t of remoteTickets) byId.set(t.id, t);
    const merged = Array.from(byId.values()).sort(
      (a, b) => b.createdAtMs - a.createdAtMs
    );
    callback(merged);
  };

  let set = localSupportListeners.get(uid);
  if (!set) {
    set = new Set();
    localSupportListeners.set(uid, set);
  }
  set.add(emitMerged);
  emitMerged();

  const qTickets = query(collection(db, 'support_tickets'), where('userId', '==', uid));
  const unsubRemote = onSnapshot(
    qTickets,
    (snap) => {
      remoteTickets = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const createdAtTs = d.createdAt as Timestamp | undefined;
        const updatedAtTs = d.updatedAt as Timestamp | undefined;
        return {
          id: docSnap.id,
          ticketCode: String(d.ticketCode || docSnap.id),
          userId: String(d.userId || uid),
          userName: String(d.userName || ''),
          userVirtualLine: d.userVirtualLine ? String(d.userVirtualLine) : undefined,
          userRole: (d.userRole as CommercialMode) ?? 'buyer',
          reason: (d.reason as SupportTicketReason) ?? 'Outros',
          orderId: d.orderId ? String(d.orderId) : undefined,
          orderCode: d.orderCode ? String(d.orderCode) : undefined,
          description: String(d.description || ''),
          status: (d.status as SupportTicketStatus) ?? 'Aberto',
          createdAt: formatDateTimePtBr(createdAtTs),
          updatedAt: formatDateTimePtBr(updatedAtTs),
          createdAtMs: timestampToMs(createdAtTs),
        };
      });
      emitMerged();
    },
    (error) => {
      const code = getErrorCodeString(error);
      if (code === 'permission-denied') {
        console.warn('[support_tickets] Using local support fallback while Firestore rules are pending.');
        emitMerged();
        return;
      }
      console.warn('[support_tickets] Listener warning:', error);
    }
  );

  return () => {
    unsubRemote();
    const listeners = localSupportListeners.get(uid);
    if (listeners) {
      listeners.delete(emitMerged);
      if (listeners.size === 0) localSupportListeners.delete(uid);
    }
  };
}

export async function resolveSupportTicket(
  ticketId: string,
  userId?: string
): Promise<void> {
  if (userId) {
    const localList = loadLocalSupportTickets(userId);
    const hasLocal = localList.some((t) => t.id === ticketId);
    if (hasLocal) {
      const nowLabel = formatNowPtBr();
      saveLocalSupportTickets(
        userId,
        localList.map((t) =>
          t.id === ticketId
            ? { ...t, status: 'Resolvido', updatedAt: nowLabel }
            : t
        )
      );
    }
  }
  try {
    await updateDoc(doc(db, 'support_tickets', ticketId), {
      status: 'Resolvido',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    const code = getErrorCodeString(error);
    if (code === 'permission-denied' || code === 'not-found') {
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `support_tickets/${ticketId}`);
  }
}

// --- MANDATORY CPF COMMERCIAL BINDING, STAR RATINGS & EXCLUSIVE COMMERCIAL BAN ---

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return '';
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeVirtualLineSha256(virtualLine?: string): Promise<string> {
  const normalized = (virtualLine || '').trim().toUpperCase();
  if (!normalized || !isVirtualLinePrefix(normalized)) return '';
  return sha256Hex(`chatfi-vline-v1:${normalized}`);
}

export async function syncCommercialIdentityHashes(params: {
  uid: string;
  cpfHash?: string;
  phoneHash?: string;
  virtualLine?: string;
}): Promise<void> {
  if (!params.uid) return;
  const virtualLineHash = await computeVirtualLineSha256(params.virtualLine);
  const payload: Record<string, unknown> = {
    uid: params.uid,
    updatedAt: serverTimestamp(),
  };
  if (params.cpfHash && /^[a-f0-9]{64}$/.test(params.cpfHash)) {
    payload.cpfHash = params.cpfHash;
  }
  if (params.phoneHash && params.phoneHash.trim().length >= 16) {
    payload.phoneHash = params.phoneHash.trim().slice(0, 128);
  }
  if (virtualLineHash && /^[a-f0-9]{64}$/.test(virtualLineHash)) {
    payload.virtualLineHash = virtualLineHash;
  }

  const ref = doc(db, 'commercial_identity_hashes', params.uid);
  try {
    const snap = await getDoc(ref).catch(() => null);
    if (snap?.exists()) {
      const prev = snap.data() as Record<string, unknown>;
      const cpfChanged = Boolean(payload.cpfHash && prev.cpfHash !== payload.cpfHash);
      const phoneChanged = Boolean(payload.phoneHash && prev.phoneHash !== payload.phoneHash);
      const vlineChanged = Boolean(
        payload.virtualLineHash && prev.virtualLineHash !== payload.virtualLineHash
      );
      if (!cpfChanged && !phoneChanged && !vlineChanged) {
        return;
      }
      const updatePayload: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (payload.cpfHash) updatePayload.cpfHash = payload.cpfHash;
      if (payload.phoneHash) updatePayload.phoneHash = payload.phoneHash;
      if (payload.virtualLineHash) updatePayload.virtualLineHash = payload.virtualLineHash;
      await updateDoc(ref, updatePayload);
    } else {
      await setDoc(ref, payload);
    }
  } catch {
    // Non-blocking best-effort compliance hash sync
  }
}

export interface CommercialBanCheckResult {
  banned: boolean;
  reason?: string;
  bannedAtMs?: number;
  matchedBy?: 'uid' | 'cpf' | 'phone' | 'virtualLine';
}

export async function checkCommercialBanStatus(params: {
  uid: string;
  cpfRaw?: string;
  cpfHash?: string;
  phone?: string;
  phoneHash?: string;
  virtualLine?: string;
}): Promise<CommercialBanCheckResult> {
  const keysToCheck: Array<{ key: string; type: 'uid' | 'cpf' | 'phone' | 'virtualLine' }> = [];
  if (params.uid) {
    keysToCheck.push({ key: `uid_${params.uid}`, type: 'uid' });
  }

  let resolvedCpfHash = params.cpfHash || '';
  if (!resolvedCpfHash && params.cpfRaw && isValidCpf(params.cpfRaw)) {
    resolvedCpfHash = await hashCpfSha256(params.cpfRaw);
  }
  if (resolvedCpfHash && /^[a-f0-9]{64}$/.test(resolvedCpfHash)) {
    keysToCheck.push({ key: `cpf_${resolvedCpfHash}`, type: 'cpf' });
  }

  let resolvedPhoneHash = params.phoneHash || '';
  if (!resolvedPhoneHash && params.phone && !isVirtualLinePrefix(params.phone)) {
    resolvedPhoneHash = await computeContactLookupHash(params.phone);
  }
  if (resolvedPhoneHash) {
    keysToCheck.push({ key: `phone_${resolvedPhoneHash}`, type: 'phone' });
  }

  const vlineHash = await computeVirtualLineSha256(params.virtualLine);
  if (vlineHash) {
    keysToCheck.push({ key: `vline_${vlineHash}`, type: 'virtualLine' });
  }

  // Also inspect private/info for cpfHash if not passed
  if (!resolvedCpfHash && params.uid) {
    try {
      const privSnap = await getDoc(doc(db, 'users', params.uid, 'private', 'info'));
      const privCpf = privSnap.exists() ? String(privSnap.data()?.cpfHash || '') : '';
      if (/^[a-f0-9]{64}$/.test(privCpf)) {
        keysToCheck.push({ key: `cpf_${privCpf}`, type: 'cpf' });
      }
    } catch {
      // ignore
    }
  }

  for (const item of keysToCheck) {
    try {
      const snap = await getDoc(doc(db, 'commercial_bans', item.key));
      if (snap.exists()) {
        const d = snap.data();
        if (d.status === 'active') {
          const reason = String(
            d.reason ||
              'Restrição comercial aplicada após ocorrência de entrega. Seu uso pessoal do mensageiro segue ativo.'
          ).slice(0, 240);
          const bannedAtMs = Number(d.bannedAtMs || Date.now());
          // Sync flag onto users/{uid} and public_directory/{uid} if not yet flagged
          if (params.uid) {
            void updateDoc(doc(db, 'users', params.uid), {
              commercialBanned: true,
              commercialBanReason: reason,
              commercialBanAtMs: bannedAtMs,
              commercialMode: 'buyer',
              hasStorefront: false,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
            void updateDoc(doc(db, 'public_directory', params.uid), {
              commercialBanned: true,
              role: 'normal',
              hasStorefront: false,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
          return { banned: true, reason, bannedAtMs, matchedBy: item.type };
        }
      }
    } catch {
      // Continue checking remaining keys
    }
  }

  return { banned: false };
}

export async function verifyAndBindCpfForCommercialRole(params: {
  uid: string;
  cpfRaw: string;
  phone?: string;
  phoneHash?: string;
  virtualLine?: string;
  authMethod?: 'phone' | 'cpf';
}): Promise<{ ok: boolean; cpfHash?: string; banned?: boolean; message?: string }> {
  if (!isValidCpf(params.cpfRaw)) {
    return {
      ok: false,
      message: 'CPF inválido. Confira os 11 dígitos antes de ativar o modo comercial.',
    };
  }
  const cpfHash = await hashCpfSha256(params.cpfRaw);
  if (!cpfHash || cpfHash.length !== 64) {
    return { ok: false, message: 'Não foi possível validar o CPF informado.' };
  }

  // 1. Cross-identifier ban check (CPF + phone + virtualLine + UID)
  const banStatus = await checkCommercialBanStatus({
    uid: params.uid,
    cpfHash,
    phone: params.phone,
    phoneHash: params.phoneHash,
    virtualLine: params.virtualLine,
  });
  if (banStatus.banned) {
    return {
      ok: false,
      banned: true,
      message:
        banStatus.reason ||
        'Os modos Fabricante e Revendedor estão temporariamente suspensos para este CPF/conta. Sua conta pessoal e conversas continuam funcionando normalmente.',
    };
  }

  // 2. Ensure CPF is not bound to a different UID in cpf_registry or cpf_commercial_links
  try {
    const regSnap = await getDoc(doc(db, 'cpf_registry', cpfHash));
    if (regSnap.exists() && String(regSnap.data()?.ownerId || '') !== params.uid) {
      return {
        ok: false,
        message:
          'Este CPF já está vinculado a outra conta no ChatFi. Para operar como Fabricante ou Revendedor, utilize a conta titular do CPF.',
      };
    }
  } catch {
    // ignore read error
  }

  const linkRef = doc(db, 'cpf_commercial_links', cpfHash);
  try {
    const linkSnap = await getDoc(linkRef);
    if (linkSnap.exists()) {
      const ownerId = String(linkSnap.data()?.ownerId || '');
      if (ownerId && ownerId !== params.uid) {
        return {
          ok: false,
          message:
            'Este CPF já foi validado para atuação comercial em outra conta ChatFi.',
        };
      }
    } else {
      const linkPayload: Record<string, unknown> = {
        ownerId: params.uid,
        authMethod: params.authMethod ?? 'phone',
        createdAt: serverTimestamp(),
      };
      if (params.virtualLine) {
        linkPayload.virtualLine = params.virtualLine.slice(0, 24);
      }
      await setDoc(linkRef, linkPayload);
    }
  } catch (error) {
    const code = getErrorCodeString(error);
    if (code === 'permission-denied') {
      return {
        ok: false,
        message:
          'Não foi possível vincular este CPF no momento. Verifique se ele já pertence a outra conta ou tente novamente.',
      };
    }
    throw error;
  }

  // 3. Persist cpfHash into owner-only private/info, cpfVerified on users/{uid}, and non-PII identity hashes
  try {
    await updateDoc(doc(db, 'users', params.uid, 'private', 'info'), {
      cpfHash,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // private/info may already hold cpfHash or update later
  }

  try {
    await updateDoc(doc(db, 'users', params.uid), {
      cpfVerified: true,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // handled gracefully
  }

  await syncCommercialIdentityHashes({
    uid: params.uid,
    cpfHash,
    phoneHash: params.phoneHash,
    virtualLine: params.virtualLine,
  });

  return { ok: true, cpfHash };
}

export async function markOrderCompletedByParticipant(params: {
  orderId: string;
  subOrderId?: string;
}): Promise<void> {
  if (params.subOrderId) {
    try {
      await updateDoc(doc(db, 'sub_orders', params.subOrderId), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Buyer may only update parent order when applicable
    }
  }
  if (params.orderId) {
    try {
      await updateDoc(doc(db, 'orders', params.orderId), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      const code = getErrorCodeString(error);
      if (code !== 'permission-denied') {
        handleFirestoreError(error, OperationType.UPDATE, `orders/${params.orderId}`);
      }
    }
  }
}

export async function submitCommercialReview(params: {
  orderId: string;
  orderCode: string;
  subOrderId?: string;
  reviewerId: string;
  reviewerName: string;
  reviewerRole: 'buyer' | 'reseller';
  targetUid: string;
  targetName: string;
  targetRole: TargetCommercialRole;
  stars: 1 | 2 | 3 | 4 | 5;
  comment: string;
}): Promise<{ reviewId: string; ratingAverage: number; ratingCount: number }> {
  const safeStars = Math.min(5, Math.max(1, Math.round(params.stars))) as 1 | 2 | 3 | 4 | 5;
  const cleanComment = params.comment.trim().slice(0, 500);
  const reviewId = `${params.orderId}_${params.reviewerId}_${params.targetUid}_${params.targetRole}`;

  const reviewRef = doc(db, 'reviews', reviewId);
  const targetUserRef = doc(db, 'users', params.targetUid);
  const targetDirRef = doc(db, 'public_directory', params.targetUid);

  // Gather existing reviews for this targetUid to compute exact ratingAverage & ratingCount
  const existingTargetReviewsSnap = await getDocs(
    query(collection(db, 'reviews'), where('targetUid', '==', params.targetUid))
  ).catch(() => null);
  const existingReviewSnap = await getDoc(reviewRef).catch(() => null);
  const dirSnap = await getDoc(targetDirRef).catch(() => null);
  const userSnap = await getDoc(targetUserRef).catch(() => null);

  let totalStars = safeStars;
  let count = 1;
  if (existingTargetReviewsSnap) {
    const others = existingTargetReviewsSnap.docs.filter((d) => d.id !== reviewId);
    count = others.length + 1;
    totalStars =
      others.reduce((acc, d) => acc + Math.min(5, Math.max(1, Number(d.data()?.stars || 0))), 0) +
      safeStars;
  }
  const ratingAverage = Math.round((totalStars / count) * 10) / 10;

  const reviewPayload: Record<string, unknown> = {
    orderId: params.orderId,
    orderCode: params.orderCode.slice(0, 32),
    subOrderId: (params.subOrderId || '').slice(0, 128),
    reviewerId: params.reviewerId,
    reviewerName: (params.reviewerName.trim() || 'Participante ChatFi').slice(0, 80),
    reviewerRole: params.reviewerRole,
    targetUid: params.targetUid,
    targetName: (params.targetName.trim() || 'Loja ChatFi').slice(0, 80),
    targetRole: params.targetRole,
    stars: safeStars,
    comment: cleanComment,
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  if (existingReviewSnap?.exists()) {
    batch.update(reviewRef, {
      stars: safeStars,
      comment: cleanComment,
      reviewerName: reviewPayload.reviewerName,
      targetName: reviewPayload.targetName,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(reviewRef, {
      ...reviewPayload,
      createdAt: serverTimestamp(),
    });
  }

  if (userSnap?.exists()) {
    batch.update(targetUserRef, {
      ratingAverage,
      ratingCount: count,
      lastRatingReviewId: reviewId,
      updatedAt: serverTimestamp(),
    });
  }
  if (dirSnap?.exists()) {
    batch.update(targetDirRef, {
      ratingAverage,
      ratingCount: count,
      lastRatingReviewId: reviewId,
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return { reviewId, ratingAverage, ratingCount: count };
}

function mapDocToCommercialReview(
  id: string,
  d: Record<string, unknown>
): CommercialReview {
  const createdAtTs = d.createdAt as Timestamp | undefined;
  const updatedAtTs = d.updatedAt as Timestamp | undefined;
  return {
    id,
    orderId: String(d.orderId || ''),
    orderCode: String(d.orderCode || ''),
    subOrderId: d.subOrderId ? String(d.subOrderId) : undefined,
    reviewerId: String(d.reviewerId || ''),
    reviewerName: String(d.reviewerName || 'Participante ChatFi'),
    reviewerRole: d.reviewerRole === 'reseller' ? 'reseller' : 'buyer',
    targetUid: String(d.targetUid || ''),
    targetName: String(d.targetName || ''),
    targetRole: d.targetRole === 'manufacturer' ? 'manufacturer' : 'reseller',
    stars: Math.min(5, Math.max(1, Math.round(Number(d.stars || 5)))) as 1 | 2 | 3 | 4 | 5,
    comment: String(d.comment || ''),
    createdAt: formatDateTimePtBr(createdAtTs),
    updatedAt: formatDateTimePtBr(updatedAtTs),
    createdAtMs: timestampToMs(createdAtTs),
  };
}

export function subscribeReviewsForTarget(
  targetUid: string,
  callback: (reviews: CommercialReview[]) => void
): () => void {
  if (!targetUid) {
    callback([]);
    return () => {};
  }
  const q = query(collection(db, 'reviews'), where('targetUid', '==', targetUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((docSnap) => mapDocToCommercialReview(docSnap.id, docSnap.data()))
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      callback(list);
    },
    () => callback([])
  );
}

export function subscribeMyWrittenReviews(
  reviewerUid: string,
  callback: (reviews: CommercialReview[]) => void
): () => void {
  if (!reviewerUid) {
    callback([]);
    return () => {};
  }
  const q = query(collection(db, 'reviews'), where('reviewerId', '==', reviewerUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((docSnap) => mapDocToCommercialReview(docSnap.id, docSnap.data()))
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      callback(list);
    },
    () => callback([])
  );
}

export async function submitDeliveryBadFaithReport(params: {
  orderId: string;
  orderCode: string;
  subOrderId?: string;
  subOrderCode?: string;
  reporterId: string;
  reporterName: string;
  reporterVirtualLine?: string;
  reporterRole: 'buyer' | 'reseller';
  reportedUid: string;
  reportedName: string;
  reportedRole: TargetCommercialRole;
  reason: string;
  description: string;
}): Promise<{ reportId: string; reportCode: string; ticketCode: string }> {
  const reportId = `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const reportCode = `OCO-${Math.floor(1000 + Math.random() * 9000)}`;
  const cleanReason = params.reason.trim().slice(0, 120);
  const cleanDescription = params.description.trim().slice(0, 2000);

  // Create linked Support Ticket first
  const ticketRes = await createSupportTicket({
    userId: params.reporterId,
    userName: params.reporterName,
    userVirtualLine: params.reporterVirtualLine,
    userRole: params.reporterRole,
    reason: 'Ocorrência de Entrega / Má-fé',
    orderId: params.orderId,
    orderCode: params.orderCode,
    description: `[${reportCode}] Ocorrência contra ${
      params.reportedRole === 'manufacturer' ? 'Fabricante' : 'Revendedor'
    } (${params.reportedName}) — Motivo: ${cleanReason}. Relato: ${cleanDescription}`,
  });

  const payload: Record<string, unknown> = {
    reportCode,
    orderId: params.orderId,
    orderCode: params.orderCode.slice(0, 32),
    subOrderId: (params.subOrderId || '').slice(0, 128),
    subOrderCode: (params.subOrderCode || '').slice(0, 32),
    ticketId: ticketRes.id,
    ticketCode: ticketRes.ticketCode,
    reporterId: params.reporterId,
    reporterName: (params.reporterName.trim() || 'Usuário ChatFi').slice(0, 80),
    reporterRole: params.reporterRole,
    reportedUid: params.reportedUid,
    reportedName: (params.reportedName.trim() || 'Vendedor ChatFi').slice(0, 80),
    reportedRole: params.reportedRole,
    reason: cleanReason,
    description: cleanDescription,
    status: 'Aberto',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'delivery_reports', reportId), payload);
  return { reportId, reportCode, ticketCode: ticketRes.ticketCode };
}

function mapDocToDeliveryReport(
  id: string,
  d: Record<string, unknown>
): DeliveryReport {
  const createdAtTs = d.createdAt as Timestamp | undefined;
  const updatedAtTs = d.updatedAt as Timestamp | undefined;
  return {
    id,
    reportCode: String(d.reportCode || id),
    orderId: String(d.orderId || ''),
    orderCode: String(d.orderCode || ''),
    subOrderId: d.subOrderId ? String(d.subOrderId) : undefined,
    subOrderCode: d.subOrderCode ? String(d.subOrderCode) : undefined,
    ticketId: d.ticketId ? String(d.ticketId) : undefined,
    ticketCode: d.ticketCode ? String(d.ticketCode) : undefined,
    reporterId: String(d.reporterId || ''),
    reporterName: String(d.reporterName || ''),
    reporterRole: d.reporterRole === 'reseller' ? 'reseller' : 'buyer',
    reportedUid: String(d.reportedUid || ''),
    reportedName: String(d.reportedName || ''),
    reportedRole: d.reportedRole === 'manufacturer' ? 'manufacturer' : 'reseller',
    reason: String(d.reason || ''),
    description: String(d.description || ''),
    status: (d.status as DeliveryReportStatus) ?? 'Aberto',
    resolvedByUid: d.resolvedByUid ? String(d.resolvedByUid) : undefined,
    resolutionNote: d.resolutionNote ? String(d.resolutionNote) : undefined,
    createdAt: formatDateTimePtBr(createdAtTs),
    updatedAt: formatDateTimePtBr(updatedAtTs),
    createdAtMs: timestampToMs(createdAtTs),
  };
}

export function subscribeDeliveryReports(
  uid: string,
  isAdminUser: boolean,
  callback: (reports: DeliveryReport[]) => void
): () => void {
  if (!uid) {
    callback([]);
    return () => {};
  }

  if (isAdminUser) {
    return onSnapshot(
      collection(db, 'delivery_reports'),
      (snap) => {
        const list = snap.docs
          .map((docSnap) => mapDocToDeliveryReport(docSnap.id, docSnap.data()))
          .sort((a, b) => b.createdAtMs - a.createdAtMs);
        callback(list);
      },
      () => callback([])
    );
  }

  let asReporter: DeliveryReport[] = [];
  let asReported: DeliveryReport[] = [];
  const emitMerged = () => {
    const byId = new Map<string, DeliveryReport>();
    for (const r of asReporter) byId.set(r.id, r);
    for (const r of asReported) byId.set(r.id, r);
    callback(Array.from(byId.values()).sort((a, b) => b.createdAtMs - a.createdAtMs));
  };

  const u1 = onSnapshot(
    query(collection(db, 'delivery_reports'), where('reporterId', '==', uid)),
    (snap) => {
      asReporter = snap.docs.map((docSnap) => mapDocToDeliveryReport(docSnap.id, docSnap.data()));
      emitMerged();
    },
    () => {}
  );
  const u2 = onSnapshot(
    query(collection(db, 'delivery_reports'), where('reportedUid', '==', uid)),
    (snap) => {
      asReported = snap.docs.map((docSnap) => mapDocToDeliveryReport(docSnap.id, docSnap.data()));
      emitMerged();
    },
    () => {}
  );

  return () => {
    u1();
    u2();
  };
}

export function subscribeAllSupportTicketsForAdmin(
  enabled: boolean,
  callback: (tickets: SupportTicket[]) => void
): () => void {
  if (!enabled) {
    callback([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, 'support_tickets'),
    (snap) => {
      const list = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          const createdAtTs = d.createdAt as Timestamp | undefined;
          const updatedAtTs = d.updatedAt as Timestamp | undefined;
          return {
            id: docSnap.id,
            ticketCode: String(d.ticketCode || docSnap.id),
            userId: String(d.userId || ''),
            userName: String(d.userName || ''),
            userVirtualLine: d.userVirtualLine ? String(d.userVirtualLine) : undefined,
            userRole: (d.userRole as CommercialMode) ?? 'buyer',
            reason: (d.reason as SupportTicketReason) ?? 'Outros',
            orderId: d.orderId ? String(d.orderId) : undefined,
            orderCode: d.orderCode ? String(d.orderCode) : undefined,
            description: String(d.description || ''),
            status: (d.status as SupportTicketStatus) ?? 'Aberto',
            createdAt: formatDateTimePtBr(createdAtTs),
            updatedAt: formatDateTimePtBr(updatedAtTs),
            createdAtMs: timestampToMs(createdAtTs),
          };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      callback(list);
    },
    () => callback([])
  );
}

export function subscribeCommercialBansForAdmin(
  enabled: boolean,
  callback: (bans: CommercialBanRecord[]) => void
): () => void {
  if (!enabled) {
    callback([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, 'commercial_bans'),
    (snap) => {
      const list: CommercialBanRecord[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const createdAtTs = d.createdAt as Timestamp | undefined;
        const updatedAtTs = d.updatedAt as Timestamp | undefined;
        return {
          banKey: String(d.banKey || docSnap.id),
          identifierType:
            (d.identifierType as CommercialBanRecord['identifierType']) ?? 'uid',
          targetUid: String(d.targetUid || ''),
          targetName: String(d.targetName || ''),
          cpfHash: d.cpfHash ? String(d.cpfHash) : undefined,
          phoneHash: d.phoneHash ? String(d.phoneHash) : undefined,
          virtualLineHash: d.virtualLineHash ? String(d.virtualLineHash) : undefined,
          status: d.status === 'lifted' ? 'lifted' : 'active',
          reason: String(d.reason || ''),
          reportId: d.reportId ? String(d.reportId) : undefined,
          ticketId: d.ticketId ? String(d.ticketId) : undefined,
          orderCode: d.orderCode ? String(d.orderCode) : undefined,
          bannedByUid: String(d.bannedByUid || ''),
          bannedAtMs: Number(d.bannedAtMs || 0),
          liftedAtMs: d.liftedAtMs ? Number(d.liftedAtMs) : undefined,
          liftedByUid: d.liftedByUid ? String(d.liftedByUid) : undefined,
          liftNote: d.liftNote ? String(d.liftNote) : undefined,
          createdAt: formatDateTimePtBr(createdAtTs),
          updatedAt: formatDateTimePtBr(updatedAtTs),
        };
      });
      callback(list.sort((a, b) => b.bannedAtMs - a.bannedAtMs));
    },
    () => callback([])
  );
}

export async function updateDeliveryReportStatus(params: {
  reportId: string;
  status: DeliveryReportStatus;
  adminUid: string;
  resolutionNote?: string;
}): Promise<void> {
  await updateDoc(doc(db, 'delivery_reports', params.reportId), {
    status: params.status,
    resolvedByUid: params.adminUid,
    resolutionNote: (params.resolutionNote || '').trim().slice(0, 500),
    updatedAt: serverTimestamp(),
  });
}

export async function banUserCommercialRoles(params: {
  targetUid: string;
  targetName: string;
  reason: string;
  adminUid: string;
  reportId?: string;
  ticketId?: string;
  orderCode?: string;
}): Promise<void> {
  const nowMs = Date.now();
  const cleanReason = params.reason.trim().slice(0, 240);
  const cleanName = (params.targetName.trim() || 'Usuário ChatFi').slice(0, 80);

  // Fetch non-PII identity hashes if available so ban follows CPF + phone + virtualLine
  let cpfHash = '';
  let phoneHash = '';
  let virtualLineHash = '';
  try {
    const idSnap = await getDoc(doc(db, 'commercial_identity_hashes', params.targetUid));
    if (idSnap.exists()) {
      const d = idSnap.data();
      if (typeof d.cpfHash === 'string' && /^[a-f0-9]{64}$/.test(d.cpfHash)) cpfHash = d.cpfHash;
      if (typeof d.phoneHash === 'string' && d.phoneHash.length >= 16) phoneHash = d.phoneHash;
      if (typeof d.virtualLineHash === 'string' && /^[a-f0-9]{64}$/.test(d.virtualLineHash)) {
        virtualLineHash = d.virtualLineHash;
      }
    }
  } catch {
    // Proceed with UID ban at minimum
  }

  const identifiers: Array<{
    banKey: string;
    identifierType: 'uid' | 'cpf' | 'phone' | 'virtualLine';
  }> = [{ banKey: `uid_${params.targetUid}`, identifierType: 'uid' }];
  if (cpfHash) identifiers.push({ banKey: `cpf_${cpfHash}`, identifierType: 'cpf' });
  if (phoneHash) identifiers.push({ banKey: `phone_${phoneHash}`, identifierType: 'phone' });
  if (virtualLineHash) {
    identifiers.push({ banKey: `vline_${virtualLineHash}`, identifierType: 'virtualLine' });
  }

  for (const ident of identifiers) {
    const banRef = doc(db, 'commercial_bans', ident.banKey);
    const existing = await getDoc(banRef).catch(() => null);
    const payload: Record<string, unknown> = {
      banKey: ident.banKey,
      identifierType: ident.identifierType,
      targetUid: params.targetUid,
      targetName: cleanName,
      status: 'active',
      reason: cleanReason,
      bannedByUid: params.adminUid,
      bannedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    };
    if (cpfHash) payload.cpfHash = cpfHash;
    if (phoneHash) payload.phoneHash = phoneHash;
    if (virtualLineHash) payload.virtualLineHash = virtualLineHash;
    if (params.reportId) payload.reportId = params.reportId.slice(0, 128);
    if (params.ticketId) payload.ticketId = params.ticketId.slice(0, 128);
    if (params.orderCode) payload.orderCode = params.orderCode.slice(0, 32);

    if (existing?.exists()) {
      await updateDoc(banRef, payload);
    } else {
      await setDoc(banRef, { ...payload, createdAt: serverTimestamp() });
    }
  }

  // Suspend ONLY commercial modes & storefront while keeping personal account/chat active
  await updateDoc(doc(db, 'users', params.targetUid), {
    commercialBanned: true,
    commercialBanReason: cleanReason,
    commercialBanAtMs: nowMs,
    commercialMode: 'buyer',
    hasStorefront: false,
    updatedAt: serverTimestamp(),
  });

  const dirSnap = await getDoc(doc(db, 'public_directory', params.targetUid)).catch(() => null);
  if (dirSnap?.exists()) {
    await updateDoc(doc(db, 'public_directory', params.targetUid), {
      commercialBanned: true,
      role: 'normal',
      hasStorefront: false,
      updatedAt: serverTimestamp(),
    });
  }

  if (params.reportId) {
    await updateDeliveryReportStatus({
      reportId: params.reportId,
      status: 'Banido',
      adminUid: params.adminUid,
      resolutionNote: `Bloqueio comercial aplicado: ${cleanReason}`.slice(0, 500),
    });
  }
  if (params.ticketId) {
    await updateDoc(doc(db, 'support_tickets', params.ticketId), {
      status: 'Em análise',
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}

export async function liftCommercialBan(params: {
  targetUid: string;
  adminUid: string;
  liftNote: string;
  reportId?: string;
  ticketId?: string;
}): Promise<void> {
  const nowMs = Date.now();
  const cleanNote = (params.liftNote.trim() || 'Liberado após apuração pelo Suporte ChatFi.').slice(
    0,
    500
  );

  // Lift all ban keys belonging to this targetUid (UID, CPF hash, phone hash, virtual line hash)
  const bansSnap = await getDocs(
    query(collection(db, 'commercial_bans'), where('targetUid', '==', params.targetUid))
  );
  for (const banDoc of bansSnap.docs) {
    await updateDoc(banDoc.ref, {
      status: 'lifted',
      liftedAtMs: nowMs,
      liftedByUid: params.adminUid,
      liftNote: cleanNote,
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(doc(db, 'users', params.targetUid), {
    commercialBanned: false,
    commercialBanReason: '',
    commercialBanAtMs: 0,
    updatedAt: serverTimestamp(),
  });

  const dirSnap = await getDoc(doc(db, 'public_directory', params.targetUid)).catch(() => null);
  if (dirSnap?.exists()) {
    await updateDoc(doc(db, 'public_directory', params.targetUid), {
      commercialBanned: false,
      updatedAt: serverTimestamp(),
    });
  }

  if (params.reportId) {
    await updateDeliveryReportStatus({
      reportId: params.reportId,
      status: 'Resolvido',
      adminUid: params.adminUid,
      resolutionNote: cleanNote,
    }).catch(() => {});
  }
  if (params.ticketId) {
    await updateDoc(doc(db, 'support_tickets', params.ticketId), {
      status: 'Resolvido',
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}




