import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
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
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import appletConfig from '../../firebase-applet-config.json';
import type {
  CallSessionRecord,
  CategoryMargin,
  ChatMessage,
  ChatThreadSummary,
  CommercialMode,
  Contact,
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
  SubOrder,
  SubOrderLineItem,
  SubscriptionStatus,
  UserProfile,
} from '../types/zapei';
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

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage: FirebaseStorage = getStorage(app);

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
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return 'connected';
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
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

export function clearPhoneRecaptcha(): void {
  if (activeRecaptchaVerifier) {
    try {
      activeRecaptchaVerifier.clear();
    } catch {
      // verifier already cleared
    }
    activeRecaptchaVerifier = null;
  }
}

export async function sendWhatsAppStyleSmsCode(
  e164Phone: string,
  recaptchaContainerId: string
): Promise<ConfirmationResult> {
  clearPhoneRecaptcha();
  auth.languageCode = 'pt-BR';
  const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
    size: 'invisible',
  });
  activeRecaptchaVerifier = verifier;
  try {
    return await signInWithPhoneNumber(auth, e164Phone, verifier);
  } catch (error) {
    clearPhoneRecaptcha();
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

export const DEFAULT_CATEGORY_MARGINS: Record<ProductCategory, CategoryMargin> = {
  Calçados: { mode: 'fixed', value: 100 },
  Bolsas: { mode: 'percent', value: 25 },
  Sapatos: { mode: 'fixed', value: 120 },
  Joias: { mode: 'percent', value: 35 },
  Acessórios: { mode: 'percent', value: 30 },
};

// --- USER PROFILE & PHONE HASH INDEX ---

export async function registerOrUpdateUserProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  statusMessage?: string;
  avatarColor?: string;
  avatarUrl?: string;
  commercialMode?: CommercialMode;
  manufacturerActivated?: boolean;
  resellerActivated?: boolean;
  storefrontName?: string;
  storefrontPrivacy?: 'open' | 'approved';
  factoryName?: string;
  factoryPolicy?: MinimumDeliveryPolicy;
  subscriptionStatus?: SubscriptionStatus;
  trialEndsAt?: number;
  favoriteGrades?: FavoriteGrade[];
}): Promise<void> {
  const cleanPhone = formatPhoneDisplay(params.phone);
  const phoneHash = await hashPhoneNumber(params.phone);
  const initials = getInitials(params.displayName);
  const mode = params.commercialMode ?? 'buyer';
  const subStatus = params.subscriptionStatus ?? 'free';
  const hasStorefront =
    (mode === 'manufacturer' || mode === 'reseller') && subStatus !== 'expired';
  const policy = params.factoryPolicy ?? {
    type: 'boxes',
    value: 1,
    allowCounterPickup: true,
    label: 'Mínimo 1 caixa · Retirada no balcão',
  };

  const userRef = doc(db, 'users', params.uid);
  const existingUser = await getDoc(userRef);

  const publicData = {
    uid: params.uid,
    displayName: params.displayName.slice(0, 80),
    initials,
    statusMessage: (params.statusMessage ?? 'Disponível no Zapei').slice(0, 160),
    avatarColor: (params.avatarColor ?? '#0F5132').slice(0, 20),
    avatarUrl: (params.avatarUrl ?? '').slice(0, 150000),
    commercialMode: mode,
    manufacturerActivated: Boolean(params.manufacturerActivated),
    resellerActivated: Boolean(params.resellerActivated),
    hasStorefront,
    storefrontName: (params.storefrontName ?? `Vitrine ${params.displayName}`).slice(0, 80),
    storefrontPrivacy: params.storefrontPrivacy ?? 'open',
    factoryName: (params.factoryName ?? params.displayName).slice(0, 80),
    deliveryPolicyType: policy.type,
    deliveryPolicyValue: policy.value,
    deliveryPolicyPickup: policy.allowCounterPickup,
    deliveryPolicyLabel: policy.label.slice(0, 160),
    subscriptionStatus: subStatus,
    trialEndsAt: params.trialEndsAt ?? 0,
    updatedAt: serverTimestamp(),
  };

  try {
    if (existingUser.exists()) {
      await updateDoc(userRef, publicData);
    } else {
      await setDoc(userRef, { ...publicData, createdAt: serverTimestamp() });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${params.uid}`);
  }

  const privateRef = doc(db, 'users', params.uid, 'private', 'info');
  const existingPrivate = await getDoc(privateRef);
  const privateData = {
    ownerId: params.uid,
    phone: cleanPhone.slice(0, 32),
    phoneHash,
    email: params.email.slice(0, 120),
    favoriteGrades: params.favoriteGrades ?? DEFAULT_FAVORITE_GRADES,
    updatedAt: serverTimestamp(),
  };

  try {
    if (existingPrivate.exists()) {
      await updateDoc(privateRef, privateData);
    } else {
      await setDoc(privateRef, { ...privateData, createdAt: serverTimestamp() });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${params.uid}/private/info`);
  }

  if (phoneHash) {
    const indexRole: 'normal' | 'reseller' | 'manufacturer' =
      mode === 'manufacturer' ? 'manufacturer' : mode === 'reseller' ? 'reseller' : 'normal';
    const indexRef = doc(db, 'phone_index', phoneHash);
    try {
      await setDoc(indexRef, {
        ownerId: params.uid,
        displayName: params.displayName.slice(0, 80),
        initials,
        avatarColor: (params.avatarColor ?? '#0F5132').slice(0, 20),
        avatarUrl: (params.avatarUrl ?? '').slice(0, 150000),
        role: indexRole,
        hasStorefront,
        storefrontName: (
          mode === 'manufacturer'
            ? params.factoryName ?? params.displayName
            : params.storefrontName ?? `Vitrine ${params.displayName}`
        ).slice(0, 80),
        deliveryPolicyType: policy.type,
        deliveryPolicyValue: policy.value,
        deliveryPolicyPickup: policy.allowCounterPickup,
        deliveryPolicyLabel: policy.label.slice(0, 160),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `phone_index/${phoneHash}`);
    }
  }
}

export function subscribeUserProfile(
  uid: string,
  email: string,
  callback: (profile: UserProfile | null) => void
): () => void {
  let publicData: Record<string, unknown> | null = null;
  let privateData: Record<string, unknown> | null = null;
  let publicLoaded = false;
  let privateLoaded = false;

  const emit = () => {
    if (!publicLoaded || !privateLoaded) return;
    if (!publicData || !privateData) {
      callback(null);
      return;
    }
    const trialEndsAt = Number(publicData.trialEndsAt ?? 0);
    const daysLeft =
      trialEndsAt > 0
        ? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0;
    const rawSub = (publicData.subscriptionStatus as SubscriptionStatus) ?? 'free';
    const effectiveSub: SubscriptionStatus =
      rawSub === 'trial' && trialEndsAt > 0 && Date.now() > trialEndsAt ? 'expired' : rawSub;

    callback({
      uid,
      name: String(publicData.displayName ?? ''),
      initials: String(publicData.initials ?? getInitials(String(publicData.displayName ?? 'ZP'))),
      phone: String(privateData.phone ?? ''),
      phoneHash: String(privateData.phoneHash ?? ''),
      email: String(privateData.email ?? email),
      statusMessage: String(publicData.statusMessage ?? 'Disponível no Zapei'),
      avatarBg: String(publicData.avatarColor ?? '#0F5132'),
      avatarUrl: publicData.avatarUrl ? String(publicData.avatarUrl) : undefined,
      commercialMode: (publicData.commercialMode as CommercialMode) ?? 'buyer',
      manufacturerActivated: Boolean(publicData.manufacturerActivated),
      resellerActivated: Boolean(publicData.resellerActivated),
      hasStorefront: Boolean(publicData.hasStorefront),
      subscriptionStatus: effectiveSub,
      trialEndsAt,
      trialDaysLeft: daysLeft,
      storefrontName: String(publicData.storefrontName ?? ''),
      storefrontPrivacy: (publicData.storefrontPrivacy as 'open' | 'approved') ?? 'open',
      factoryName: String(publicData.factoryName ?? ''),
      factoryPolicy: {
        type: (publicData.deliveryPolicyType as MinimumDeliveryPolicy['type']) ?? 'boxes',
        value: Number(publicData.deliveryPolicyValue ?? 1),
        allowCounterPickup: Boolean(publicData.deliveryPolicyPickup ?? true),
        label: String(publicData.deliveryPolicyLabel ?? 'Mínimo 1 caixa'),
      },
      favoriteGrades:
        Array.isArray(privateData.favoriteGrades) && privateData.favoriteGrades.length > 0
          ? (privateData.favoriteGrades as FavoriteGrade[])
          : DEFAULT_FAVORITE_GRADES,
    });
  };

  const unsubPub = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      publicLoaded = true;
      publicData = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.GET, `users/${uid}`)
  );

  const unsubPriv = onSnapshot(
    doc(db, 'users', uid, 'private', 'info'),
    (snap) => {
      privateLoaded = true;
      privateData = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.GET, `users/${uid}/private/info`)
  );

  return () => {
    unsubPub();
    unsubPriv();
  };
}

// --- REAL PHONEBOOK CONTACTS & REAL PHONE HASH DISCOVERY ---

export interface PhoneLookupResult {
  uid: string;
  displayName: string;
  initials: string;
  avatarColor: string;
  role: 'normal' | 'reseller' | 'manufacturer';
  hasStorefront: boolean;
  storefrontName: string;
  deliveryPolicy: MinimumDeliveryPolicy;
}

export async function lookupRegisteredUserByPhone(
  rawPhone: string
): Promise<PhoneLookupResult | null> {
  const phoneHash = await hashPhoneNumber(rawPhone);
  if (!phoneHash) return null;
  try {
    const snap = await getDoc(doc(db, 'phone_index', phoneHash));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid: String(d.ownerId),
      displayName: String(d.displayName),
      initials: String(d.initials || getInitials(String(d.displayName))),
      avatarColor: String(d.avatarColor || '#0F5132'),
      role: (d.role as 'normal' | 'reseller' | 'manufacturer') ?? 'normal',
      hasStorefront: Boolean(d.hasStorefront),
      storefrontName: String(d.storefrontName || d.displayName),
      deliveryPolicy: {
        type: (d.deliveryPolicyType as MinimumDeliveryPolicy['type']) ?? 'boxes',
        value: Number(d.deliveryPolicyValue ?? 1),
        allowCounterPickup: Boolean(d.deliveryPolicyPickup ?? true),
        label: String(d.deliveryPolicyLabel || 'Mínimo 1 caixa'),
      },
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
  const cleanPhone = formatPhoneDisplay(params.phone);
  const phoneHash = await hashPhoneNumber(params.phone);
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
          initials: getInitials(String(d.name || 'ZP')),
          avatarBg: String(d.avatarColor || (onZapei ? '#0F5132' : '#64748B')),
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
        mediaUrl: d.mediaUrl ? String(d.mediaUrl) : undefined,
        audioDuration: d.audioDuration ? String(d.audioDuration) : undefined,
        orderId: d.orderId ? String(d.orderId) : undefined,
        orderCode: d.orderCode ? String(d.orderCode) : undefined,
        orderSummary: d.orderSummary ? String(d.orderSummary) : undefined,
        orderTotal: typeof d.orderTotal === 'number' ? d.orderTotal : undefined,
        orderStatusLabel: d.orderStatusLabel ? String(d.orderStatusLabel) : undefined,
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

export async function sendRealChatMessage(params: {
  myUid: string;
  myName: string;
  otherUid: string;
  otherName: string;
  type: ChatMessage['type'];
  text: string;
  mediaUrl?: string;
  audioDuration?: string;
  orderId?: string;
  orderCode?: string;
  orderSummary?: string;
  orderTotal?: number;
  orderStatusLabel?: string;
}): Promise<string> {
  const [userA, userB] = [params.myUid, params.otherUid].sort();
  const userAName = userA === params.myUid ? params.myName : params.otherName;
  const userBName = userB === params.myUid ? params.myName : params.otherName;
  const chatId = `${userA}__${userB}`;
  const chatRef = doc(db, 'chats', chatId);
  const existingChat = await getDoc(chatRef);

  try {
    if (existingChat.exists()) {
      await updateDoc(chatRef, {
        userAName: userAName.slice(0, 80),
        userBName: userBName.slice(0, 80),
        lastMessage: params.text.slice(0, 400),
        lastSenderId: params.myUid,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(chatRef, {
        userA,
        userB,
        userAName: userAName.slice(0, 80),
        userBName: userBName.slice(0, 80),
        lastMessage: params.text.slice(0, 400),
        lastSenderId: params.myUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `chats/${chatId}`);
  }

  const msgId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const payload: Record<string, unknown> = {
    chatId,
    userA,
    userB,
    senderId: params.myUid,
    senderName: params.myName.slice(0, 80),
    type: params.type,
    text: params.text.slice(0, 1000),
    createdAt: serverTimestamp(),
  };
  if (params.mediaUrl) payload.mediaUrl = params.mediaUrl;
  if (params.audioDuration) payload.audioDuration = params.audioDuration.slice(0, 16);
  if (params.orderId) payload.orderId = params.orderId.slice(0, 128);
  if (params.orderCode) payload.orderCode = params.orderCode.slice(0, 32);
  if (params.orderSummary) payload.orderSummary = params.orderSummary.slice(0, 240);
  if (typeof params.orderTotal === 'number') payload.orderTotal = params.orderTotal;
  if (params.orderStatusLabel) payload.orderStatusLabel = params.orderStatusLabel.slice(0, 120);

  try {
    await setDoc(doc(db, 'chats', chatId, 'messages', msgId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `chats/${chatId}/messages/${msgId}`);
  }

  return chatId;
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
      callerInitials: String(d.callerInitials || getInitials(String(d.callerName || 'ZP'))),
      callerAvatarColor: String(d.callerAvatarColor || '#0F5132'),
      calleeId: String(d.calleeId),
      calleeName: String(d.calleeName || ''),
      calleeInitials: String(d.calleeInitials || getInitials(String(d.calleeName || 'ZP'))),
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
      category: (d.category as ProductCategory) ?? 'Calçados',
      factoryPrice: Number(d.factoryPrice ?? 0),
      stockBoxes: Number(d.stockBoxes ?? 0),
      gradeRaw: String(d.gradeRaw || ''),
      imageUrl: String(d.imageUrl || ''),
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
  factoryPrice: number;
  stockBoxes: number;
  gradeRaw: string;
  imageUrl: string;
}): Promise<void> {
  const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await setDoc(doc(db, 'products', id), {
      factoryId: params.factoryId,
      factoryName: params.factoryName.slice(0, 100),
      name: params.name.slice(0, 120),
      sku: params.sku.slice(0, 40),
      category: params.category,
      factoryPrice: params.factoryPrice,
      stockBoxes: params.stockBoxes,
      gradeRaw: params.gradeRaw.slice(0, 200),
      imageUrl: params.imageUrl,
      isSoldOutToday: false,
      moderationStatus: 'approved',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `products/${id}`);
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
  const qActive = query(collection(db, 'connections'), where('paused', '==', false));

  let mine: FactoryConnection[] = [];
  let active: FactoryConnection[] = [];

  const emit = () => {
    const map = new Map<string, FactoryConnection>();
    for (const c of [...active, ...mine]) {
      map.set(c.id, c);
    }
    callback(Array.from(map.values()));
  };

  const parse = (docSnap: { id: string; data: () => Record<string, unknown> }): FactoryConnection => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      resellerId: String(d.resellerId),
      factoryId: String(d.factoryId),
      factoryName: String(d.factoryName || ''),
      deliveryPolicy: {
        type: (d.deliveryPolicyType as MinimumDeliveryPolicy['type']) ?? 'boxes',
        value: Number(d.deliveryPolicyValue ?? 1),
        allowCounterPickup: Boolean(d.deliveryPolicyPickup ?? true),
        label: String(d.deliveryPolicyLabel || 'Mínimo 1 caixa'),
      },
      reviewPhotos: Boolean(d.reviewPhotos),
      paused: Boolean(d.paused),
      margins: (d.margins as Record<ProductCategory, CategoryMargin>) ?? DEFAULT_CATEGORY_MARGINS,
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
      mine = snap.docs.map((ds) => parse({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'connections')
  );

  const u2 = onSnapshot(
    qActive,
    (snap) => {
      active = snap.docs.map((ds) => parse({ id: ds.id, data: () => ds.data() }));
      emit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'connections')
  );

  return () => {
    u1();
    u2();
  };
}

export async function createRealFactoryConnection(params: {
  resellerId: string;
  factory: PhoneLookupResult;
}): Promise<void> {
  const connId = `conn_${params.resellerId}_${params.factory.uid}`.slice(0, 128);
  try {
    await setDoc(doc(db, 'connections', connId), {
      resellerId: params.resellerId,
      factoryId: params.factory.uid,
      factoryName: params.factory.displayName.slice(0, 100),
      deliveryPolicyType: params.factory.deliveryPolicy.type,
      deliveryPolicyValue: params.factory.deliveryPolicy.value,
      deliveryPolicyPickup: params.factory.deliveryPolicy.allowCounterPickup,
      deliveryPolicyLabel: params.factory.deliveryPolicy.label.slice(0, 160),
      reviewPhotos: true,
      paused: false,
      margins: DEFAULT_CATEGORY_MARGINS,
      approvedProductIds: [],
      rejectedProductIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `connections/${connId}`);
  }
}

export async function updateRealConnection(
  connectionId: string,
  updates: Partial<{
    reviewPhotos: boolean;
    paused: boolean;
    margins: Record<ProductCategory, CategoryMargin>;
    approvedProductIds: string[];
    rejectedProductIds: string[];
  }>
): Promise<void> {
  try {
    await updateDoc(doc(db, 'connections', connectionId), {
      ...updates,
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
}): Promise<void> {
  const factoryIds = Array.from(new Set(params.subOrders.map((s) => s.factoryId)));

  try {
    await setDoc(doc(db, 'orders', params.orderId), {
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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
    await setDoc(doc(db, 'payments', payBuyerId), {
      orderId: params.orderId,
      orderCode: params.orderCode,
      layer: 'reseller_buyer',
      ownerId: params.resellerId,
      counterpartyId: params.buyerId,
      buyerId: params.buyerId,
      counterpartyName: params.buyerName.slice(0, 100),
      amount: params.buyerFinalTotal,
      costReference: params.factoryCostTotal,
      method: 'À vista',
      status: 'Aguardando',
      dueDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
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
  deliveryPolicy: MinimumDeliveryPolicy;
  subscriptionStatus: SubscriptionStatus;
} | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid,
      displayName: String(d.displayName || ''),
      commercialMode: (d.commercialMode as CommercialMode) ?? 'buyer',
      hasStorefront: Boolean(d.hasStorefront),
      storefrontName: String(d.storefrontName || d.factoryName || d.displayName || ''),
      factoryName: String(d.factoryName || d.displayName || ''),
      deliveryPolicy: {
        type: (d.deliveryPolicyType as MinimumDeliveryPolicy['type']) ?? 'boxes',
        value: Number(d.deliveryPolicyValue ?? 1),
        allowCounterPickup: Boolean(d.deliveryPolicyPickup ?? true),
        label: String(d.deliveryPolicyLabel || 'Mínimo 1 caixa'),
      },
      subscriptionStatus: (d.subscriptionStatus as SubscriptionStatus) ?? 'free',
    };
  } catch {
    return null;
  }
}
