import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  Briefcase,
  Check,
  CheckSquare,
  Clock,
  Eraser,
  Factory,
  FileText,
  Link2,
  ListPlus,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  Mic,
  Moon,
  MoreVertical,
  Phone,
  Pin,
  PinOff,
  Search,
  Settings,
  Star,
  Store,
  Sun,
  Trash2,
  User as UserIcon,
  Users,
  Video,
  WifiOff,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  approveDeviceAuthRequest,
  auth,
  banUserCommercialRoles,
  checkCommercialBanStatus,
  confirmDeviceTakeoverSmsCode,
  createDeviceAuthRequest,
  createRealFactoryConnection,
  createRealMixedOrder,
  createRealProduct,
  createSupportTicket,
  db,
  deleteCallHistoryRecord,
  deleteChatMessagesForAll,
  deletePhonebookContact,
  disconnectUserDevice,
  ensureCurrentDeviceRegisteredSilently,
  fetchDeletedMessagesState,
  fetchPublicUserStorefront,
  fetchUserProfileOnce,
  getDeterministicChatId,
  getDismissedCallIds,
  liftCommercialBan,
  lookupRegisteredUserByPhone,
  markContactInvited,
  markOrderCompletedByParticipant,
  persistDeletedForMeOnServer,
  registerOrCheckCurrentDevice,
  registerOrUpdateUserProfile,
  rejectDeviceAuthRequest,
  respondToResellerConnection,
  resyncAllPhonebookContacts,
  resolveSupportTicket,
  saveRealContactToPhonebook,
  sendDeviceTakeoverSmsCode,
  sendRealChatMessage,
  sendRecoveryEmailForSignedInCpfUser,
  signOutFirebase,
  submitCommercialReview,
  submitDeliveryBadFaithReport,
  subscribeAllSupportTicketsForAdmin,
  subscribeAuthRequestById,
  subscribeChatMessages,
  subscribeCommercialBansForAdmin,
  subscribeConnections,
  subscribeDeliveryReports,
  subscribeFirebaseAuth,
  subscribeMyWrittenReviews,
  subscribeOrdersAndSubOrders,
  subscribePayments,
  subscribePendingAuthRequestsForUser,
  subscribeProducts,
  subscribePublicDirectory,
  subscribeReviewsForTarget,
  subscribeUserCalls,
  subscribeUserChats,
  subscribeUserContacts,
  subscribeUserDevices,
  subscribeUserProfile,
  subscribeUserSupportTickets,
  syncCommercialIdentityHashes,
  syncPublicDirectoryEntry,
  takeOverAsPrimaryDevice,
  updateDeliveryReportStatus,
  updateRealConnection,
  updateRealOrder,
  updateRealPayment,
  updateRealProduct,
  updateRealProductStock,
  updateRealSubOrder,
  updateUserPresenceHeartbeat,
  updateUserPresencePrivacy,
  verifyAndBindCpfForCommercialRole,
  verifyCpfAccountForDeviceTakeover,
  type PublicDirectoryUser,
} from './lib/firebase';
import {
  DEFAULT_STATUS_MESSAGE,
  getContactPresenceDisplay,
  isUserEffectivelyOnline,
  sanitizeStatusMessage,
} from './lib/presenceUtils';
import { getOrCreateLocalDeviceInfo, isVirtualLineFormat } from './lib/cpfAndDeviceUtils';
import {
  answerRealIncomingCall,
  installAudioUnlockListeners,
  playMessageNotificationSound,
  queryMediaPermissionSnapshot,
  startRealOutgoingCall,
  updateRealCallStatus,
  type RealWebRTCSessionHandle,
  type VideoQualityMode,
} from './lib/webrtcService';
import {
  enableRealBackgroundCallPush,
  syncActiveChatPresence,
  syncExistingPushSubscriptionWithRetry,
  triggerRemoteCallPush,
} from './lib/pushService';
import {
  formatPacketTimeLabel,
  installConnectivitySyncListeners,
  isDeviceOnline,
  packetToChatMessage,
  removeOutboxPackets,
  sendOrQueueMessage,
  subscribeOutbox,
  type ZapeiMessagePacket,
} from './lib/messageTransport';
import {
  checkPeerReachability,
  sendChatActivity,
  setPresenceSubscribedPeers,
  startRealtimeClient,
  subscribeHiddenPresenceUids,
  subscribePeerChatActivityMap,
  updateActiveChatWs,
  updateLivePresenceState,
  type PeerChatActivity,
} from './lib/realtimeClient';
import {
  subscribeLocalChatMessages,
  subscribeLocalChatThreads,
} from './lib/localChatStore';
import {
  deleteLocalMediaItems,
  getLocalMedia,
  getLocalMediaByChat,
} from './lib/localMediaCache';
import {
  DEFAULT_CHAT_PREFS,
  fetchServerChatPrefs,
  hashChatLockPin,
  loadLocalChatPrefs,
  pickNewerChatPrefs,
  saveLocalChatPrefs,
  saveServerChatPrefs,
  verifyChatLockPin,
} from './lib/chatPreferences';
import {
  IMAGE_JPEG_QUALITY,
  MAX_IMAGE_WIDTH,
  sendMediaWithTransitBridge,
} from './lib/mediaTransitService';
import {
  clearPendingSharedPayloads,
  getPendingSharedPayloads,
  type StoredSharedPayload,
} from './lib/shareTargetInbox';
import {
  authorizeAllZapeiResourcesOnce,
  getPolicyConsentRecord,
  savePolicyConsentRecord,
  type PolicyConsentRecord,
} from './lib/policyConsent';
import { formatBRL, getInitials } from './lib/gradeParser';
import {
  APPEARANCE_EVENT,
  readAppearancePrefs,
  toggleThemeMode,
  type ThemeMode,
} from './lib/appearancePrefs';
import { BACK_PRIORITY, useSystemBackHandler } from './lib/backNavigation';
import { calculateOrderSplit } from './lib/splitCalculator';
import {
  canCancelUnpaidOrder,
  cancelOrderAndReleaseStock,
  createAsaasSplitCharge,
  fetchAsaasOrderStatus,
  fetchCancelledOrderOverrides,
  getOrderReservationDeadlineMs,
  type AsaasOrderStatusResult,
  type CancelledOrderOverride,
  type CancelOrderResult,
  type CreateAsaasChargeResult,
  type OrderCancelReason,
} from './lib/asaasService';
import {
  isSupportAdminEmail,
  OFFICIAL_SUPPORT_NAME,
  OFFICIAL_SUPPORT_UID,
  OFFICIAL_SUPPORT_VIRTUAL_LINE,
} from './lib/supportConfig';
import {
  blobToDataUrl,
  compressImageFileToBlob,
  dataUrlToBlob,
  formatPhoneDisplay,
  normalizePhoneDigits,
} from './lib/phoneUtils';
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
  DeviceAuthRequest,
  DualPaymentRecord,
  FactoryConnection,
  FavoriteGrade,
  LogisticsType,
  MinimumDeliveryPolicy,
  MixedOrder,
  OrderSplitBreakdown,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductCategory,
  SplitPaymentMethod,
  SubOrder,
  SupportTicket,
  TargetCommercialRole,
  UserChatPreferences,
  UserProfile,
} from './types/zapei';
import { ActiveCallModal, type ActiveCallUIState } from './components/ActiveCallModal';
import {
  AvatarLightboxModal,
  type AvatarPreviewTarget,
} from './components/AvatarLightboxModal';
import { CallsView } from './components/CallsView';
import { ChatFiLogo } from './components/ChatFiLogo';
import {
  AddToListModal,
  ChatActionConfirmModal,
  ChatLockPinModal,
  ChatShortcutModal,
  ContactInfoModal,
  type ContactDetailsTarget,
} from './components/ChatActionsModals';
import {
  ChatThreadView,
  type ActiveChatPeer,
  type ForwardTarget,
} from './components/ChatThreadView';
import { ContactsView } from './components/ContactsView';
import { DeviceApprovalModal } from './components/DeviceApprovalModal';
import { DeviceAuthorizationGate } from './components/DeviceAuthorizationGate';
import {
  HelpCenterModal,
  type HelpCenterContext,
} from './components/HelpCenterModal';
import { ManufacturerPanel } from './components/ManufacturerPanel';
import { PhoneOnboardingModal } from './components/PhoneOnboardingModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import {
  PublicStorefrontView,
  type PublicStorefrontOwner,
} from './components/PublicStorefrontView';
import { ResellerPanel } from './components/ResellerPanel';
import { SettingsView } from './components/SettingsView';
import {
  ShareTargetModal,
  type PreparedShareItem,
  type ShareTargetRecipient,
} from './components/ShareTargetModal';
import {
  BillingManageModal,
  CommercialTrialModal,
} from './components/SubscriptionModals';
import { TermsAndPermissionsModal } from './components/TermsAndPermissionsModal';

type MainTab = 'chats' | 'calls' | 'contacts' | 'commercial' | 'settings';

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function App() {
  // Real Firebase Auth & Profile State
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileRetryTick, setProfileRetryTick] = useState(0);
  const [bootSlow, setBootSlow] = useState(false);

  // Connected Devices & Primary Session Authorization State
  const localDeviceInfo = useMemo(() => getOrCreateLocalDeviceInfo(), []);
  const [deviceAuthState, setDeviceAuthState] = useState<
    'idle' | 'checking' | 'authorized' | 'pending_approval'
  >('idle');
  const [activeAuthRequest, setActiveAuthRequest] = useState<DeviceAuthRequest | null>(null);
  const [regeneratingAuthReq, setRegeneratingAuthReq] = useState(false);
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([]);
  const [pendingIncomingAuthRequests, setPendingIncomingAuthRequests] = useState<
    DeviceAuthRequest[]
  >([]);
  const hasSeenSelfInDevicesRef = useRef(false);
  const checkedDeviceUidRef = useRef<string | null>(null);
  const lastAuthUidRef = useRef<string | null>(null);
  const ensuredDeviceSelfRef = useRef<string | null>(null);
  const [pendingSharedPayloads, setPendingSharedPayloads] = useState<StoredSharedPayload[]>([]);

  // Navigation & UI Modals
  const [activeTab, setActiveTab] = useState<MainTab>('chats');
  const [chatSearch, setChatSearch] = useState('');
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [trialPromptRole, setTrialPromptRole] = useState<
    Extract<CommercialMode, 'manufacturer' | 'reseller'> | null
  >(null);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [activeStorefrontOwner, setActiveStorefrontOwner] =
    useState<PublicStorefrontOwner | null>(null);
  const [activeStorefrontInitialTab, setActiveStorefrontInitialTab] = useState<
    'catalog' | 'cart' | 'orders'
  >('catalog');
  const [toastMessage, setToastMessage] = useState('');

  // Real-time Firestore Collections
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<PublicDirectoryUser[]>([]);
  const [chats, setChats] = useState<ChatThreadSummary[]>([]);
  const [calls, setCalls] = useState<CallSessionRecord[]>([]);
  const [dismissedCallIds, setDismissedCallIds] = useState<Set<string>>(() => new Set());
  const [products, setProducts] = useState<Product[]>([]);
  const [connections, setConnections] = useState<FactoryConnection[]>([]);
  const [orders, setOrders] = useState<MixedOrder[]>([]);
  const [localCancelledOrders, setLocalCancelledOrders] = useState<
    Record<string, CancelledOrderOverride>
  >({});
  const [payments, setPayments] = useState<DualPaymentRecord[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [writtenReviews, setWrittenReviews] = useState<CommercialReview[]>([]);
  const [receivedReviews, setReceivedReviews] = useState<CommercialReview[]>([]);
  const [deliveryReports, setDeliveryReports] = useState<DeliveryReport[]>([]);
  const [adminTickets, setAdminTickets] = useState<SupportTicket[]>([]);
  const [commercialBans, setCommercialBans] = useState<CommercialBanRecord[]>([]);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [helpModalContext, setHelpModalContext] = useState<HelpCenterContext | null>(null);
  const [chatPrefilledDraft, setChatPrefilledDraft] = useState<{
    id: string;
    text: string;
  } | null>(null);

  // Active Chat Thread & Messages
  const [selectedPeer, setSelectedPeer] = useState<ActiveChatPeer | null>(null);
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [localThreads, setLocalThreads] = useState<ChatThreadSummary[]>([]);
  const [localActiveMessages, setLocalActiveMessages] = useState<ChatMessage[]>([]);
  const [deletedForMeIds, setDeletedForMeIds] = useState<Set<string>>(() => new Set());
  const [deletedForAllMap, setDeletedForAllMap] = useState<Map<string, number>>(() => new Map());
  const [peerActivityMap, setPeerActivityMap] = useState<Map<string, PeerChatActivity>>(
    () => new Map()
  );
  const [hiddenPresenceUids, setHiddenPresenceUids] = useState<Set<string>>(() => new Set());

  // WhatsApp-style Chat Organization, Selection Mode & Privacy State
  const [chatPrefs, setChatPrefs] = useState<UserChatPreferences>(() => ({
    ...DEFAULT_CHAT_PREFS,
  }));
  const [chatListFilter, setChatListFilter] = useState<string>('all');
  const [lockedFolderUnlocked, setLockedFolderUnlocked] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(() => new Set());
  const [showChatListMenu, setShowChatListMenu] = useState(false);
  const [contactModalTarget, setContactModalTarget] = useState<ContactDetailsTarget | null>(null);
  const [shortcutModalTarget, setShortcutModalTarget] = useState<{
    chatId: string;
    peerUid: string;
    peerName: string;
  } | null>(null);
  const [lockPinModal, setLockPinModal] = useState<{
    mode: 'create_and_lock' | 'verify_unlock' | 'verify_to_remove';
    chatIds: string[];
    targetLabel?: string;
    onAfterUnlock?: () => void;
  } | null>(null);
  const [addToListTarget, setAddToListTarget] = useState<{
    chatIds: string[];
    title: string;
  } | null>(null);
  const [chatConfirmModal, setChatConfirmModal] = useState<{
    kind: 'clear' | 'delete_chat' | 'block' | 'unblock';
    chatIds: string[];
    peerUids: string[];
    targetName?: string;
  } | null>(null);
  const chatRowLongPressTimerRef = useRef<number | null>(null);
  const chatRowSuppressClickRef = useRef<boolean>(false);

  // Real WebRTC Call State
  const [activeCall, setActiveCall] = useState<ActiveCallUIState | null>(null);
  const webrtcHandleRef = useRef<RealWebRTCSessionHandle | null>(null);
  const stealthCallTimersRef = useRef<number[]>([]);
  const ignoredCallIdsRef = useRef<Set<string>>(new Set());
  const seenCallIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedInitialCallsRef = useRef(false);

  // Real Closed-App / Locked-Screen Web Push Sync Trackers
  const autoPushPromptedRef = useRef(false);
  const processedWakeCallIdsRef = useRef<Set<string>>(new Set());
  const lastPushSyncMsRef = useRef<number>(0);

  // Terms of Responsibility, Privacy Policy & One-Time Permissions Consent State
  const [policyConsent, setPolicyConsent] = useState<PolicyConsentRecord | null>(null);
  const [policyCheckedUid, setPolicyCheckedUid] = useState<string | null>(null);
  const [showPoliciesModal, setShowPoliciesModal] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<AvatarPreviewTarget | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readAppearancePrefs().theme);

  useEffect(() => {
    const syncAppearance = () => {
      setThemeMode(readAppearancePrefs().theme);
    };
    window.addEventListener(APPEARANCE_EVENT, syncAppearance);
    window.addEventListener('storage', syncAppearance);
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, syncAppearance);
      window.removeEventListener('storage', syncAppearance);
    };
  }, []);

  // WhatsApp-style in-app incoming message notification banner & live chime trackers
  const [incomingMsgBanner, setIncomingMsgBanner] = useState<{
    senderId: string;
    senderName: string;
    initials: string;
    avatarBg: string;
    avatarUrl?: string;
    preview: string;
  } | null>(null);
  const seenChatSigRef = useRef<Map<string, string>>(new Map());
  const chatsSubStartedAtRef = useRef<number>(0);
  const chatsHydratedRef = useRef(false);
  const seenActiveMsgIdsRef = useRef<Set<string>>(new Set());
  const activeChatHydratedRef = useRef(false);
  const activeChatOpenedAtRef = useRef<number>(0);
  const lastIncomingChimeKeyRef = useRef<{ key: string; at: number }>({
    key: '',
    at: 0,
  });
  const incomingBannerTimerRef = useRef<number | null>(null);

  const showIncomingMsgBanner = useCallback(
    (payload: {
      senderId: string;
      senderName: string;
      initials: string;
      avatarBg: string;
      avatarUrl?: string;
      preview: string;
    }) => {
      setIncomingMsgBanner(payload);
      if (incomingBannerTimerRef.current) {
        window.clearTimeout(incomingBannerTimerRef.current);
      }
      incomingBannerTimerRef.current = window.setTimeout(() => {
        setIncomingMsgBanner((curr) =>
          curr && curr.senderId === payload.senderId && curr.preview === payload.preview
            ? null
            : curr
        );
      }, 5500);
    },
    []
  );

  // Smart Offline Mode & Local Outbox Queue State (Phase 1 Mesh-Ready Transport)
  const [isOnline, setIsOnline] = useState<boolean>(() => isDeviceOnline());
  const [outboxPackets, setOutboxPackets] = useState<ZapeiMessagePacket[]>([]);
  const authUserRef = useRef<User | null>(null);
  authUserRef.current = authUser;
  const expiringOrderAttemptRef = useRef<Map<string, number>>(new Map());

  // Unlock mobile browser audio on first touch/click so incoming calls & messages always ring loudly
  useEffect(() => {
    return installAudioUnlockListeners();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? '' : curr));
    }, 4000);
  }, []);

  // Subscribe to persistent offline outbox + automatic online/offline sync listeners
  useEffect(() => {
    const unsubOutbox = subscribeOutbox(setOutboxPackets);
    const unsubConnectivity = installConnectivitySyncListeners({
      getAuthUser: () => authUserRef.current,
      onOnlineStatusChange: (online) => {
        setIsOnline(online);
      },
      onOutboxFlushed: (sentCount) => {
        showToast(
          sentCount === 1
            ? 'Sinal restaurado! 1 mensagem pendente enviada.'
            : `Sinal restaurado! ${sentCount} mensagens pendentes enviadas.`
        );
      },
    });
    return () => {
      unsubOutbox();
      unsubConnectivity();
    };
  }, [showToast]);

  // Also trigger outbox flush as soon as authUser finishes restoring session while online
  useEffect(() => {
    if (!authUser || !isOnline) return;
    if (outboxPackets.some((p) => p.senderId === authUser.uid && p.deliveryStatus === 'pending')) {
      void import('./lib/messageTransport').then(({ flushOfflineOutbox }) => {
        void flushOfflineOutbox(authUser).then(({ sentCount }) => {
          if (sentCount > 0) {
            showToast(
              sentCount === 1
                ? '1 mensagem pendente sincronizada.'
                : `${sentCount} mensagens pendentes sincronizadas.`
            );
          }
        });
      });
    }
  }, [authUser, isOnline, outboxPackets, showToast]);

  // 1. Subscribe to Firebase Auth (keep already-connected session completely intact on token refreshes)
  useEffect(() => {
    let authSettled = false;
    const authSafetyTimer = window.setTimeout(() => {
      if (!authSettled) {
        authSettled = true;
        setAuthReady(true);
        if (auth.currentUser) {
          lastAuthUidRef.current = auth.currentUser.uid;
          setAuthUser(auth.currentUser);
        } else {
          setProfileLoaded(true);
        }
      }
    }, 5000);

    const unsub = subscribeFirebaseAuth((user) => {
      authSettled = true;
      window.clearTimeout(authSafetyTimer);
      setAuthReady(true);
      if (!user) {
        lastAuthUidRef.current = null;
        ensuredDeviceSelfRef.current = null;
        setAuthUser(null);
        setProfile(null);
        setProfileLoaded(true);
        setDeviceAuthState('idle');
        setActiveAuthRequest(null);
        setConnectedDevices([]);
        setPendingIncomingAuthRequests([]);
        hasSeenSelfInDevicesRef.current = false;
        checkedDeviceUidRef.current = null;
        setContacts([]);
        setChats([]);
        setDeletedForMeIds(new Set());
        setDeletedForAllMap(new Map());
        setCalls([]);
        setProducts([]);
        setConnections([]);
        setOrders([]);
        setLocalCancelledOrders({});
        setPayments([]);
        setSupportTickets([]);
        setWrittenReviews([]);
        setReceivedReviews([]);
        setDeliveryReports([]);
        setAdminTickets([]);
        setCommercialBans([]);
        setHelpModalOpen(false);
        setHelpModalContext(null);
        setChatPrefilledDraft(null);
        setSelectedPeer(null);
        setActiveMessages([]);
        setLocalThreads([]);
        setLocalActiveMessages([]);
        setHiddenPresenceUids(new Set());
        setActiveStorefrontOwner(null);
        expiringOrderAttemptRef.current.clear();
        stealthCallTimersRef.current.forEach((tid) => window.clearTimeout(tid));
        stealthCallTimersRef.current = [];
        webrtcHandleRef.current?.cleanup();
        webrtcHandleRef.current = null;
        setActiveCall(null);
      } else {
        const isDifferentUser = lastAuthUidRef.current !== user.uid;
        lastAuthUidRef.current = user.uid;
        setAuthUser(user);
        if (isDifferentUser) {
          // Hydrate cached profile immediately if available on this device while live Firestore sync runs
          let hydratedFromCache = false;
          try {
            const raw = localStorage.getItem(`chatfi_profile_cache_v1_${user.uid}`);
            if (raw) {
              const parsed = JSON.parse(raw) as UserProfile;
              if (parsed && parsed.uid === user.uid && parsed.name) {
                setProfile(parsed);
                setProfileLoaded(true);
                hydratedFromCache = true;
              }
            }
          } catch {
            // ignore storage errors
          }
          if (!hydratedFromCache) {
            setProfileLoaded(false);
          }
        }
      }
    });
    return () => {
      window.clearTimeout(authSafetyTimer);
      unsub();
    };
  }, []);

  const authUid = authUser?.uid ?? null;
  const profileUid = profile?.uid ?? null;

  // 2. Subscribe to User Profile (keyed strictly by authUid so token refreshes never re-subscribe)
  useEffect(() => {
    if (!authUid) return undefined;
    return subscribeUserProfile(authUid, authUserRef.current?.email || '', (loaded) => {
      if (loaded) {
        setProfile(loaded);
        try {
          localStorage.setItem(`chatfi_profile_cache_v1_${authUid}`, JSON.stringify(loaded));
        } catch {
          // ignore storage quota errors
        }
      } else {
        setProfile(null);
      }
      setProfileLoaded(true);
    });
  }, [authUid, profileRetryTick]);

  // 2b. Track if the initial "Conectando ao ChatFi..." splash takes too long so the user can retry or switch account
  const isBootingSplash = !authReady || (Boolean(authUser) && !profileLoaded);
  useEffect(() => {
    if (!isBootingSplash) {
      setBootSlow(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setBootSlow(true), 6000);
    return () => window.clearTimeout(timer);
  }, [isBootingSplash, profileRetryTick]);

  // 2a. Connected Devices Gate: already-authorized devices unlock IMMEDIATELY with zero checking screen;
  // only brand-new devices check Firestore once and request QR Code or 6-digit password approval.
  useEffect(() => {
    if (!authUid || !profileUid) return undefined;
    if (checkedDeviceUidRef.current === authUid) {
      return undefined;
    }

    let cancelled = false;
    let settled = false;
    checkedDeviceUidRef.current = authUid;
    hasSeenSelfInDevicesRef.current = false;
    const localAuthCacheKey = `zapei_device_auth_uid_${localDeviceInfo.deviceId}`;

    // If this device is already authorized for this account, keep it 100% intact immediately (online or offline).
    try {
      if (localStorage.getItem(localAuthCacheKey) === authUid) {
        settled = true;
        setActiveAuthRequest(null);
        setDeviceAuthState('authorized');
        return undefined;
      }
    } catch {
      // ignore storage errors
    }

    setDeviceAuthState('checking');

    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error('device-check-timeout'));
      }, 8000);
    });

    void Promise.race([
      registerOrCheckCurrentDevice(authUid, localDeviceInfo),
      timeoutPromise,
    ])
      .then((res) => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        if (cancelled) return;
        settled = true;
        if (res.authorized) {
          try {
            localStorage.setItem(localAuthCacheKey, authUid);
          } catch {
            // ignore
          }
          setActiveAuthRequest(null);
          setDeviceAuthState('authorized');
        } else {
          setActiveAuthRequest(res.request);
          setDeviceAuthState('pending_approval');
        }
      })
      .catch((err) => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        console.error('Device registration check failed:', err);
        if (cancelled) return;
        settled = true;
        // Fallback for offline/slow startup so the loading gate never freezes indefinitely
        try {
          if (localStorage.getItem(localAuthCacheKey) === authUid) {
            setDeviceAuthState('authorized');
            return;
          }
        } catch {
          // ignore
        }
        setDeviceAuthState('authorized');
      });

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (!settled) {
        checkedDeviceUidRef.current = null;
      }
    };
  }, [authUid, profileUid, localDeviceInfo]);

  // 2a-ii. Real-time watch on activeAuthRequest while this new device waits for approval
  useEffect(() => {
    if (deviceAuthState !== 'pending_approval' || !activeAuthRequest || !authUid) {
      return undefined;
    }
    const localAuthCacheKey = `zapei_device_auth_uid_${localDeviceInfo.deviceId}`;
    return subscribeAuthRequestById(activeAuthRequest.id, (updated) => {
      if (!updated) return;
      setActiveAuthRequest(updated);
      if (updated.status === 'approved') {
        try {
          localStorage.setItem(localAuthCacheKey, authUid);
        } catch {
          // ignore
        }
        setDeviceAuthState('authorized');
        setActiveAuthRequest(null);
        showToast('Acesso liberado pelo aparelho principal! Bem-vindo ao ChatFi.');
      }
    });
  }, [deviceAuthState, activeAuthRequest?.id, authUid, localDeviceInfo.deviceId, showToast]);

  // 2a-iii. Passive real-time Connected Devices list (never writes or refreshes the active device;
  // only revokes if the server explicitly confirms this device was manually disconnected elsewhere)
  useEffect(() => {
    if (!authUid || deviceAuthState !== 'authorized') return undefined;
    const localAuthCacheKey = `zapei_device_auth_uid_${localDeviceInfo.deviceId}`;

    return subscribeUserDevices(authUid, (devices, { fromCache }) => {
      setConnectedDevices(devices);
      if (fromCache) return;

      const stillPresent = devices.some((d) => d.deviceId === localDeviceInfo.deviceId);
      if (stillPresent) {
        hasSeenSelfInDevicesRef.current = true;
        return;
      }

      if (devices.length === 0) {
        // Legacy account with no devices recorded yet: register silently once in background
        if (ensuredDeviceSelfRef.current !== authUid) {
          ensuredDeviceSelfRef.current = authUid;
          void ensureCurrentDeviceRegisteredSilently(authUid, localDeviceInfo);
        }
        return;
      }

      // Server confirms other active devices exist and this device was explicitly removed
      hasSeenSelfInDevicesRef.current = false;
      try {
        localStorage.removeItem(localAuthCacheKey);
      } catch {
        // ignore
      }
      showToast('Este aparelho foi desconectado remotamente.');
      void signOutFirebase();
    });
  }, [authUid, deviceAuthState, localDeviceInfo, showToast]);

  // 2a-iv. Passive real-time listener on already-authorized devices: opens the 2-option modal
  // (QR Code or Password) ONLY when another device attempts to connect to this same account/number
  useEffect(() => {
    if (!authUid || deviceAuthState !== 'authorized') return undefined;
    return subscribePendingAuthRequestsForUser(
      authUid,
      localDeviceInfo.deviceId,
      (pending) => {
        setPendingIncomingAuthRequests(pending);
      }
    );
  }, [authUid, deviceAuthState, localDeviceInfo.deviceId]);

  const handleApproveIncomingDevice = useCallback(
    async (req: DeviceAuthRequest) => {
      if (!authUid) return;
      await approveDeviceAuthRequest({
        uid: authUid,
        request: req,
        approverDeviceId: localDeviceInfo.deviceId,
      });
      showToast(`Acesso autorizado para ${req.deviceName}.`);
    },
    [authUid, localDeviceInfo.deviceId, showToast]
  );

  const handleRejectIncomingDevice = useCallback(
    async (req: DeviceAuthRequest) => {
      await rejectDeviceAuthRequest(req.id, localDeviceInfo.deviceId);
      showToast(`Solicitação de ${req.deviceName} recusada.`);
    },
    [localDeviceInfo.deviceId, showToast]
  );

  // 2b. Sync existing browser/PWA Web Push subscription with ChatFi server on login & app resume
  useEffect(() => {
    if (!authUid || deviceAuthState !== 'authorized') return undefined;
    const runSync = (force = false) => {
      const currentUser = authUserRef.current;
      if (!currentUser) return;
      const now = Date.now();
      if (!force && now - lastPushSyncMsRef.current < 45000) return;
      lastPushSyncMsRef.current = now;
      void syncExistingPushSubscriptionWithRetry(currentUser).catch(() => {});
    };
    const clearBadge = () => {
      try {
        const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
        if (typeof nav.clearAppBadge === 'function') {
          void nav.clearAppBadge().catch(() => {});
        }
      } catch {
        // Ignore on unsupported browsers
      }
    };
    runSync(true);
    clearBadge();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        runSync(false);
        clearBadge();
      }
    };
    const onFocus = () => runSync(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    // For accounts that already accepted Terms previously, silently trigger native OS notification
    // permission on first click (iOS WebKit requires a real click gesture, not touchend) so background push activates seamlessly.
    const onFirstInteraction = () => {
      if (autoPushPromptedRef.current) return;
      const currentUser = authUserRef.current;
      if (!currentUser) return;
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'default') {
        autoPushPromptedRef.current = true;
        return;
      }
      autoPushPromptedRef.current = true;
      void enableRealBackgroundCallPush(currentUser)
        .then(() => {
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            autoPushPromptedRef.current = false;
          }
        })
        .catch(() => {
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            autoPushPromptedRef.current = false;
          }
        });
    };

    if (
      policyConsent &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default' &&
      !autoPushPromptedRef.current
    ) {
      window.addEventListener('click', onFirstInteraction, { capture: true });
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('click', onFirstInteraction, { capture: true });
    };
  }, [authUid, deviceAuthState, policyConsent]);

  // 3. Subscribe to all real Firestore collections once authenticated, registered & device authorized
  useEffect(() => {
    if (!authUid || !profileUid || deviceAuthState !== 'authorized') return undefined;
    const uid = authUid;
    chatsSubStartedAtRef.current = Date.now();
    chatsHydratedRef.current = false;
    seenChatSigRef.current.clear();
    setDismissedCallIds(getDismissedCallIds(uid));
    const unsubs = [
      subscribeUserContacts(uid, setContacts),
      subscribePublicDirectory(uid, setDirectoryUsers),
      subscribeUserChats(uid, setChats),
      subscribeLocalChatThreads(uid, setLocalThreads),
      subscribeUserCalls(uid, setCalls),
      subscribeProducts(uid, setProducts),
      subscribeConnections(uid, setConnections),
      subscribeOrdersAndSubOrders(uid, setOrders),
      subscribePayments(uid, setPayments),
      subscribeUserSupportTickets(uid, setSupportTickets),
      subscribeMyWrittenReviews(uid, setWrittenReviews),
      subscribeReviewsForTarget(uid, setReceivedReviews),
    ];

    const storageKey = `chatfi_cancelled_orders_v1_${uid}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, CancelledOrderOverride>;
        if (parsed && typeof parsed === 'object') {
          setLocalCancelledOrders(parsed);
        }
      }
    } catch {
      // ignore invalid cache
    }
    void fetchCancelledOrderOverrides().then((overrides) => {
      if (overrides.length === 0) return;
      setLocalCancelledOrders((prev) => {
        const next = { ...prev };
        for (const ov of overrides) {
          next[ov.orderId] = ov;
        }
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore storage quota
        }
        return next;
      });
    });

    const deletedMeKey = `chatfi_deleted_for_me_v1_${uid}`;
    try {
      const rawDel = localStorage.getItem(deletedMeKey);
      if (rawDel) {
        const parsedDel = JSON.parse(rawDel) as unknown;
        if (Array.isArray(parsedDel)) {
          setDeletedForMeIds(new Set(parsedDel.filter((v): v is string => typeof v === 'string')));
        }
      }
    } catch {
      // ignore invalid deletion cache
    }
    const syncServerDeletions = () => {
      const curUser = authUserRef.current;
      if (!curUser) return;
      void fetchDeletedMessagesState(curUser).then(({ deletedForMeIds: srvMe, deletedForAll }) => {
        if (srvMe.length > 0) {
          setDeletedForMeIds((prev) => {
            const next = new Set(prev);
            for (const id of srvMe) next.add(id);
            try {
              localStorage.setItem(deletedMeKey, JSON.stringify(Array.from(next).slice(-5000)));
            } catch {
              // ignore storage quota
            }
            return next;
          });
        }
        if (deletedForAll.length > 0) {
          setDeletedForAllMap((prev) => {
            const next = new Map(prev);
            for (const entry of deletedForAll) {
              next.set(`${entry.chatId}__${entry.messageId}`, entry.deletedAtMs);
            }
            return next;
          });
        }
      });
    };
    syncServerDeletions();
    const deletionPollId = window.setInterval(syncServerDeletions, 8000);

    // Load per-user chat organization preferences (local cache + server sync)
    const localPrefs = loadLocalChatPrefs(uid);
    setChatPrefs(localPrefs);
    const curAuth = authUserRef.current;
    if (curAuth) {
      void fetchServerChatPrefs(curAuth).then((srvPrefs) => {
        if (!srvPrefs) return;
        const winner = pickNewerChatPrefs(loadLocalChatPrefs(uid), srvPrefs);
        setChatPrefs(winner);
        saveLocalChatPrefs(uid, winner);
        if ((winner.updatedAtMs || 0) > (srvPrefs.updatedAtMs || 0)) {
          void saveServerChatPrefs(curAuth, winner);
        }
      });
    }

    const onVisibilityRelock = () => {
      if (document.visibilityState === 'hidden') {
        setLockedFolderUnlocked(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityRelock);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityRelock);
      window.clearInterval(deletionPollId);
      unsubs.forEach((u) => u());
    };
  }, [authUid, profileUid, deviceAuthState]);

  const isSupportAdmin = isSupportAdminEmail(profile?.email || authUser?.email);

  // 3b. Delivery bad-faith reports & Support/Admin moderation subscriptions
  useEffect(() => {
    if (!authUid || !profileUid || deviceAuthState !== 'authorized') return undefined;
    const unsubs = [
      subscribeDeliveryReports(authUid, isSupportAdmin, setDeliveryReports),
      subscribeAllSupportTicketsForAdmin(isSupportAdmin, setAdminTickets),
      subscribeCommercialBansForAdmin(isSupportAdmin, setCommercialBans),
    ];
    return () => unsubs.forEach((u) => u());
  }, [authUid, profileUid, deviceAuthState, isSupportAdmin]);

  // 3c. Cross-identifier commercial ban enforcement (UID, CPF hash, phone hash, virtualLine)
  // Blocks ONLY Manufacturer & Reseller access/panels while preserving personal chat/calls/shopping.
  useEffect(() => {
    if (!profile?.uid || deviceAuthState !== 'authorized') return;
    void syncCommercialIdentityHashes({
      uid: profile.uid,
      phoneHash: profile.phoneHash || undefined,
      virtualLine: profile.virtualLine || undefined,
    });
    void checkCommercialBanStatus({
      uid: profile.uid,
      phone: profile.phone,
      phoneHash: profile.phoneHash,
      virtualLine: profile.virtualLine,
    });
  }, [
    profile?.uid,
    profile?.phone,
    profile?.phoneHash,
    profile?.virtualLine,
    deviceAuthState,
  ]);

  useEffect(() => {
    if (profile?.commercialBanned && activeTab === 'commercial') {
      setActiveTab('settings');
    }
  }, [profile?.commercialBanned, activeTab]);

  const recordLocalCancelledOrder = useCallback(
    (override: CancelledOrderOverride) => {
      setLocalCancelledOrders((prev) => {
        const next = { ...prev, [override.orderId]: override };
        if (authUid) {
          try {
            localStorage.setItem(`chatfi_cancelled_orders_v1_${authUid}`, JSON.stringify(next));
          } catch {
            // ignore storage quota
          }
        }
        return next;
      });
    },
    [authUid]
  );

  const effectiveOrders = useMemo(() => {
    if (Object.keys(localCancelledOrders).length === 0) return orders;
    return orders.map((o) => {
      const ov = localCancelledOrders[o.id];
      if (!ov || (o.status === 'cancelled' && o.stockRestored)) return o;
      return {
        ...o,
        status: 'cancelled' as const,
        stockRestored: true,
        cancelledAtMs: ov.cancelledAtMs || o.cancelledAtMs || Date.now(),
        cancelReason: ov.cancelReason || o.cancelReason,
        asaasChargeStatus: ov.asaasChargeStatus || o.asaasChargeStatus || 'CANCELLED',
        subOrders: o.subOrders.map((s) => ({ ...s, status: 'cancelled' as const })),
      };
    });
  }, [orders, localCancelledOrders]);

  const effectivePayments = useMemo(() => {
    if (Object.keys(localCancelledOrders).length === 0) return payments;
    return payments.map((p) => {
      const ov = localCancelledOrders[p.orderId];
      if (!ov || p.status === 'Cancelado') return p;
      return {
        ...p,
        status: 'Cancelado' as const,
        asaasChargeStatus: ov.asaasChargeStatus || p.asaasChargeStatus || 'CANCELLED',
      };
    });
  }, [payments, localCancelledOrders]);

  // 3a. Ensure every logged-in user (including accounts created earlier) is findable by name or Virtual Line
  const syncedDirectoryKeyRef = useRef<string>('');
  useEffect(() => {
    if (!profile?.uid || !profile.name.trim() || deviceAuthState !== 'authorized') return;
    const syncKey = `${profile.uid}|${profile.name}|${profile.virtualLine || ''}|${profile.statusMessage}|${profile.showOnlineStatus}|${profile.showLastSeen}|${profile.hasStorefront}|${profile.storefrontName}|${profile.avatarUrl ? profile.avatarUrl.length : 0}`;
    if (syncedDirectoryKeyRef.current === syncKey) return;
    syncedDirectoryKeyRef.current = syncKey;
    void syncPublicDirectoryEntry(profile).catch(() => {});
  }, [profile, deviceAuthState]);

  // 3a-ii. WhatsApp-style real-time presence heartbeat ("online" / "visto por último às HH:mm")
  // Writes only to `public_directory/{uid}` so the local session stays 100% calm and never flickers.
  const showOnlineSetting = profile?.showOnlineStatus !== false;
  const showLastSeenSetting = profile?.showLastSeen !== false;
  useEffect(() => {
    if (!authUid || !profileUid || deviceAuthState !== 'authorized' || !isOnline) {
      return undefined;
    }
    let lastPublishedAtMs = 0;
    let lastPublishedOnline: boolean | null = null;
    const publish = (onlineNow: boolean, force = false) => {
      const now = Date.now();
      // Avoid redundant writes on rapid focus/visibility flips while always allowing offline transition
      if (
        !force &&
        lastPublishedOnline === onlineNow &&
        now - lastPublishedAtMs < 60_000
      ) {
        return;
      }
      lastPublishedOnline = onlineNow;
      lastPublishedAtMs = now;
      void updateUserPresenceHeartbeat(authUid, {
        isOnline: onlineNow,
        showOnlineStatus: showOnlineSetting,
        showLastSeen: showLastSeenSetting,
      });
    };

    const isVisible =
      typeof document === 'undefined' || document.visibilityState === 'visible';
    publish(isVisible, true);

    // Low-frequency heartbeat (every 5 minutes) to preserve Firestore daily write quota
    const intervalId =
      showOnlineSetting || showLastSeenSetting
        ? window.setInterval(() => {
            if (document.visibilityState === 'visible') {
              publish(true, true);
            }
          }, 300_000)
        : null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        publish(true);
      } else {
        publish(false);
      }
    };

    const handlePageHide = () => {
      publish(false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
    };
  }, [authUid, profileUid, deviceAuthState, isOnline, showOnlineSetting, showLastSeenSetting]);

  // 3b. Automatically re-check saved contacts that weren't on Zapei yet (once per session)
  const autoResyncedUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profile?.uid || contacts.length === 0) return;
    if (autoResyncedUidRef.current === profile.uid) return;
    const pending = contacts.filter((c) => !c.onZapei);
    autoResyncedUidRef.current = profile.uid;
    if (pending.length > 0) {
      void resyncAllPhonebookContacts(profile.uid, pending).catch(() => {});
    }
  }, [profile?.uid, contacts]);

  // 4. Subscribe to live messages of the selected chat peer
  useEffect(() => {
    if (!authUser || !selectedPeer) {
      setActiveMessages([]);
      setLocalActiveMessages([]);
      seenActiveMsgIdsRef.current.clear();
      activeChatHydratedRef.current = false;
      activeChatOpenedAtRef.current = 0;
      return undefined;
    }
    const chatId = getDeterministicChatId(authUser.uid, selectedPeer.uid);
    seenActiveMsgIdsRef.current.clear();
    activeChatHydratedRef.current = false;
    activeChatOpenedAtRef.current = Date.now();
    const unsubFirestore = subscribeChatMessages(chatId, authUser.uid, setActiveMessages);
    const unsubLocal = subscribeLocalChatMessages(
      authUser.uid,
      chatId,
      setLocalActiveMessages
    );
    return () => {
      unsubFirestore();
      unsubLocal();
    };
  }, [authUser, selectedPeer?.uid]);

  // 4a. Inform server & Service Worker when the user is actively viewing a specific conversation
  // so messages from that person never pop OS notifications while the chat is open on screen.
  const activeOpenPeerId =
    activeTab === 'chats' && selectedPeer?.uid ? selectedPeer.uid : null;
  const activeOpenPeerIdRef = useRef<string | null>(null);
  activeOpenPeerIdRef.current = activeOpenPeerId;

  useEffect(() => {
    if (!authUser) {
      void syncActiveChatPresence(null, null, false);
      return undefined;
    }

    const syncNow = (forceClear = false) => {
      const visible =
        !forceClear &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible';
      void syncActiveChatPresence(authUser, visible ? activeOpenPeerId : null, visible);
    };

    syncNow(false);

    let heartbeatId: number | null = null;
    if (activeOpenPeerId) {
      heartbeatId = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          void syncActiveChatPresence(authUser, activeOpenPeerId, true);
        }
      }, 14_000);
    }

    const handleVisibilityChange = () => {
      syncNow(false);
    };
    const handlePageHide = () => {
      syncNow(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return () => {
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      if (activeOpenPeerId) {
        void syncActiveChatPresence(authUser, null, false);
      }
    };
  }, [authUser, activeOpenPeerId]);

  // 4a-ii. Connect lightweight WebSocket client for zero-DB-cost typing / recording / presence masking
  useEffect(() => {
    const activeAuth =
      authUser && deviceAuthState === 'authorized' && isOnline ? authUser : null;
    startRealtimeClient(activeAuth);
    const unsubActivity = subscribePeerChatActivityMap(setPeerActivityMap);
    const unsubHidden = subscribeHiddenPresenceUids(setHiddenPresenceUids);
    return () => {
      unsubActivity();
      unsubHidden();
    };
  }, [authUser, deviceAuthState, isOnline]);

  useEffect(() => {
    if (!authUser || deviceAuthState !== 'authorized') return;
    const uidSet = new Set<string>();
    for (const c of chats) if (c.otherUid) uidSet.add(c.otherUid);
    for (const c of localThreads) if (c.otherUid) uidSet.add(c.otherUid);
    for (const ct of contacts) if (ct.matchedUid) uidSet.add(ct.matchedUid);
    for (const d of directoryUsers) if (d.uid) uidSet.add(d.uid);
    if (selectedPeer?.uid) uidSet.add(selectedPeer.uid);
    if (uidSet.size > 0) {
      setPresenceSubscribedPeers(Array.from(uidSet));
    }
  }, [authUser, deviceAuthState, chats, localThreads, contacts, directoryUsers, selectedPeer?.uid]);

  useEffect(() => {
    if (!authUser || deviceAuthState !== 'authorized') return;
    const isVisible =
      typeof document === 'undefined' || document.visibilityState === 'visible';
    updateLivePresenceState({
      isOnline: isVisible && isOnline,
      showOnlineStatus: showOnlineSetting,
      showLastSeen: showLastSeenSetting,
    });
  }, [authUser, deviceAuthState, isOnline, showOnlineSetting, showLastSeenSetting]);

  useEffect(() => {
    if (!authUser || deviceAuthState !== 'authorized') {
      updateActiveChatWs(null);
      return;
    }
    updateActiveChatWs(activeOpenPeerId);
  }, [authUser, deviceAuthState, activeOpenPeerId]);

  // 4b. WhatsApp-style incoming text/audio/photo message chime & floating banner across ALL chats
  useEffect(() => {
    if (!profile) {
      seenChatSigRef.current.clear();
      chatsHydratedRef.current = false;
      return;
    }

    const isBootWindow = Date.now() - chatsSubStartedAtRef.current < 2500;
    if (!chatsHydratedRef.current) {
      for (const c of chats) {
        seenChatSigRef.current.set(c.id, `${c.lastSenderId || ''}|${c.lastMessage || ''}`);
      }
      if (chats.length > 0 || !isBootWindow) {
        chatsHydratedRef.current = true;
      }
      return;
    }

    const nowMs = Date.now();
    let newestIncoming: ChatThreadSummary | null = null;
    for (const c of chats) {
      const sig = `${c.lastSenderId || ''}|${c.lastMessage || ''}`;
      const prevSig = seenChatSigRef.current.get(c.id);
      seenChatSigRef.current.set(c.id, sig);

      const isBrandNewChatAfterBoot = prevSig === undefined && !isBootWindow;
      const isUpdatedExistingChat = prevSig !== undefined && prevSig !== sig;
      const isRecentMessage =
        c.updatedAtMs === 0 || nowMs - c.updatedAtMs < 120_000;

      if (
        (isBrandNewChatAfterBoot || isUpdatedExistingChat) &&
        isRecentMessage &&
        c.lastSenderId &&
        c.lastSenderId !== profile.uid &&
        c.lastMessage &&
        !chatPrefs.blockedUids.includes(c.otherUid)
      ) {
        if (!newestIncoming || c.updatedAtMs >= newestIncoming.updatedAtMs) {
          newestIncoming = c;
        }
      }
    }

    if (newestIncoming) {
      const isBlockedSender = chatPrefs.blockedUids.includes(newestIncoming.otherUid);
      const isMutedThread = chatPrefs.mutedChatIds.includes(newestIncoming.id);
      const isLockedThread = chatPrefs.lockedChatIds.includes(newestIncoming.id);

      const viewingSameChat =
        activeTab === 'chats' && selectedPeer?.uid === newestIncoming.otherUid;
      if (!viewingSameChat && !isBlockedSender) {
        updateChatPrefs((prev) =>
          prev.unreadChatIds.includes(newestIncoming!.id)
            ? prev
            : { ...prev, unreadChatIds: [...prev.unreadChatIds, newestIncoming!.id] }
        );
      }

      if (!isBlockedSender && !isMutedThread) {
        const chimeKey = `${newestIncoming.otherUid}|${newestIncoming.lastMessage}`;
        const alreadyChimed =
          lastIncomingChimeKeyRef.current.key === chimeKey &&
          nowMs - lastIncomingChimeKeyRef.current.at < 2000;

        if (!alreadyChimed) {
          lastIncomingChimeKeyRef.current = { key: chimeKey, at: nowMs };
          const lowerPreview = (newestIncoming.lastMessage || '').toLowerCase();
          const isIncomingAudio =
            lowerPreview.startsWith('mensagem de voz') ||
            lowerPreview.startsWith('áudio') ||
            lowerPreview.startsWith('audio') ||
            newestIncoming.lastMessage.startsWith('🎤');
          playMessageNotificationSound(isIncomingAudio ? 'audio' : 'text');
        }

        if (!viewingSameChat) {
          const contactMatch = contacts.find((ct) => ct.matchedUid === newestIncoming.otherUid);
          const dirMatch = directoryUsers.find((u) => u.uid === newestIncoming.otherUid);
          const senderName = isLockedThread
            ? 'Conversa trancada'
            : contactMatch?.name || dirMatch?.displayName || newestIncoming.otherName || 'Nova mensagem';
          showIncomingMsgBanner({
            senderId: newestIncoming.otherUid,
            senderName,
            initials: isLockedThread ? '🔒' : getInitials(senderName),
            avatarBg: contactMatch?.avatarBg || dirMatch?.avatarColor || '#0E7A34',
            avatarUrl: isLockedThread ? undefined : dirMatch?.avatarUrl,
            preview: isLockedThread ? 'Nova mensagem recebida' : newestIncoming.lastMessage,
          });
        }
      }
    }
  }, [chats, profile, activeTab, selectedPeer?.uid, contacts, directoryUsers, showIncomingMsgBanner, chatPrefs.blockedUids, chatPrefs.mutedChatIds, chatPrefs.lockedChatIds]);

  // 4c. Chime ONLY when a genuinely new message arrives from another user inside the open chat
  useEffect(() => {
    if (!profile || !selectedPeer) return;
    if (!activeChatHydratedRef.current) {
      for (const m of activeMessages) seenActiveMsgIdsRef.current.add(m.id);
      if (activeMessages.length > 0 || Date.now() - activeChatOpenedAtRef.current > 1200) {
        activeChatHydratedRef.current = true;
      }
      return;
    }
    const nowMs = Date.now();
    // Skip chime during the first 1.2s after switching/opening a conversation so hydration never chimes
    const inOpenSettlingWindow = nowMs - activeChatOpenedAtRef.current < 1200;
    let newPeerKind: 'text' | 'audio' | null = null;
    let newPeerChimeKey = '';
    for (const m of activeMessages) {
      if (!seenActiveMsgIdsRef.current.has(m.id)) {
        seenActiveMsgIdsRef.current.add(m.id);
        if (
          !inOpenSettlingWindow &&
          m.senderId !== profile.uid &&
          !chatPrefs.blockedUids.includes(m.senderId)
        ) {
          newPeerKind = m.type === 'audio' ? 'audio' : 'text';
          newPeerChimeKey = `${m.senderId}|${m.text || ''}`;
        }
      }
    }
    if (newPeerKind) {
      const alreadyChimed =
        lastIncomingChimeKeyRef.current.key === newPeerChimeKey &&
        nowMs - lastIncomingChimeKeyRef.current.at < 2000;
      if (!alreadyChimed) {
        lastIncomingChimeKeyRef.current = { key: newPeerChimeKey, at: nowMs };
        playMessageNotificationSound(newPeerKind);
      }
    }
  }, [activeMessages, profile, selectedPeer, chatPrefs.blockedUids]);

  // 5. Listen for real incoming WebRTC calls from Firestore
  useEffect(() => {
    if (!profile) return;

    // If an incoming call modal is currently ringing, check if caller ended/cancelled it
    if (activeCall && activeCall.direction === 'incoming' && activeCall.status === 'ringing') {
      const liveDoc = calls.find((c) => c.id === activeCall.callId);
      if (liveDoc && liveDoc.status !== 'ringing') {
        setActiveCall(null);
      }
      return;
    }

    if (activeCall) {
      for (const c of calls) seenCallIdsRef.current.add(c.id);
      return;
    }

    const now = Date.now();
    const isInitialLoad = !hasLoadedInitialCallsRef.current;
    const incoming = calls.find((c) => {
      if (
        c.calleeId !== profile.uid ||
        c.status !== 'ringing' ||
        !c.offerSdp ||
        ignoredCallIdsRef.current.has(c.id) ||
        chatPrefs.blockedUids.includes(c.callerId)
      ) {
        return false;
      }
      // Any call arriving LIVE after initial load is ALWAYS valid (immune to phone clock skew)
      const isLiveNewCall = !isInitialLoad && !seenCallIdsRef.current.has(c.id);
      if (isLiveNewCall) return true;
      // On initial load, accept recent calls (generous 10-minute tolerance for clock skew)
      return c.createdAtMs === 0 || Math.abs(now - c.createdAtMs) < 10 * 60 * 1000;
    });

    for (const c of calls) {
      seenCallIdsRef.current.add(c.id);
    }
    if (calls.length > 0 || !isInitialLoad) {
      hasLoadedInitialCallsRef.current = true;
    }

    if (incoming) {
      const callerDir = directoryUsers.find((u) => u.uid === incoming.callerId);
      setActiveCall({
        callId: incoming.id,
        direction: 'incoming',
        callType: incoming.callType,
        peerId: incoming.callerId,
        peerName: incoming.callerName,
        peerInitials: incoming.callerInitials,
        peerAvatarColor: incoming.callerAvatarColor,
        peerAvatarUrl: callerDir?.avatarUrl,
        status: 'ringing',
        offerSdp: incoming.offerSdp,
        localStream: null,
        remoteStream: null,
      });

      // If the browser tab is open in the background, also fire an OS notification with vibration
      if (
        typeof document !== 'undefined' &&
        document.hidden &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        'serviceWorker' in navigator
      ) {
        void navigator.serviceWorker.ready
          .then((reg) =>
            reg.showNotification(incoming.callerName, {
              body:
                incoming.callType === 'video'
                  ? '📹 Chamada de vídeo recebida · Toque para atender'
                  : '📞 Ligação de voz recebida · Toque para atender',
              ...(callerDir?.avatarUrl ? { icon: callerDir.avatarUrl } : {}),
              tag: `zapei-call-${incoming.id}`,
              requireInteraction: true,
              data: {
                type: 'incoming_call',
                callId: incoming.id,
                url: `/?incomingCall=${encodeURIComponent(incoming.id)}`,
              },
            })
          )
          .catch(() => {});
      }
    }
  }, [calls, profile, activeCall, directoryUsers, chatPrefs.blockedUids]);

  // Helper: persist full profile updates cleanly
  const persistProfileUpdate = useCallback(
    async (overrides: Partial<UserProfile>) => {
      if (!authUser) return;
      const base = profile;
      await registerOrUpdateUserProfile({
        uid: authUser.uid,
        email: authUser.email || base?.email || '',
        displayName: overrides.name ?? base?.name ?? authUser.displayName ?? 'Usuário ChatFi',
        phone: overrides.phone ?? base?.phone ?? '',
        statusMessage: sanitizeStatusMessage(
          overrides.statusMessage ?? base?.statusMessage ?? DEFAULT_STATUS_MESSAGE
        ),
        showOnlineStatus: overrides.showOnlineStatus ?? base?.showOnlineStatus ?? true,
        showLastSeen: overrides.showLastSeen ?? base?.showLastSeen ?? true,
        avatarColor: overrides.avatarBg ?? base?.avatarBg ?? '#0E7A34',
        avatarUrl: overrides.avatarUrl ?? base?.avatarUrl ?? '',
        commercialMode: overrides.commercialMode ?? base?.commercialMode ?? 'buyer',
        manufacturerActivated:
          overrides.manufacturerActivated ?? base?.manufacturerActivated ?? false,
        resellerActivated: overrides.resellerActivated ?? base?.resellerActivated ?? false,
        storefrontName:
          overrides.storefrontName ?? base?.storefrontName ?? `Vitrine ${base?.name ?? ''}`,
        storefrontPrivacy: overrides.storefrontPrivacy ?? base?.storefrontPrivacy ?? 'open',
        factoryName: overrides.factoryName ?? base?.factoryName ?? base?.name ?? '',
        asaasWalletId: overrides.asaasWalletId ?? base?.asaasWalletId ?? '',
        anchorDiscountPercent:
          overrides.anchorDiscountPercent ?? base?.anchorDiscountPercent ?? 0,
        factoryPolicy: overrides.factoryPolicy ?? base?.factoryPolicy,
        subscriptionStatus: overrides.subscriptionStatus ?? base?.subscriptionStatus ?? 'free',
        trialEndsAt: overrides.trialEndsAt ?? base?.trialEndsAt ?? 0,
        favoriteGrades: overrides.favoriteGrades ?? base?.favoriteGrades,
      });
    },
    [authUser, profile]
  );

  // --- REAL WEBRTC CALL HANDLERS ---

  const handleStartCall = useCallback(
    async (
      peer: {
        uid: string;
        name: string;
        initials: string;
        avatarBg: string;
        avatarUrl?: string;
      },
      callType: 'audio' | 'video'
    ) => {
      if (!profile) return;
      stealthCallTimersRef.current.forEach((tid) => window.clearTimeout(tid));
      stealthCallTimersRef.current = [];
      webrtcHandleRef.current?.cleanup();
      webrtcHandleRef.current = null;
      const livePhoto =
        peer.avatarUrl || directoryUsers.find((u) => u.uid === peer.uid)?.avatarUrl;

      setActiveCall({
        callId: 'pending',
        direction: 'outgoing',
        callType,
        peerId: peer.uid,
        peerName: peer.name,
        peerInitials: peer.initials,
        peerAvatarColor: peer.avatarBg || '#0D2B3E',
        peerAvatarUrl: livePhoto,
        status: 'connecting',
        localStream: null,
        remoteStream: null,
      });

      const reach = await checkPeerReachability(peer.uid, authUser);
      if (!reach.reachable) {
        // Stealth block: behave as if recipient is unreachable/offline without notifying them
        const tRing = window.setTimeout(() => {
          setActiveCall((prev) =>
            prev && prev.callId === 'pending' && prev.peerId === peer.uid
              ? { ...prev, status: 'ringing' }
              : prev
          );
        }, 900);
        const tEnd = window.setTimeout(() => {
          stealthCallTimersRef.current = [];
          setActiveCall((prev) =>
            prev && prev.callId === 'pending' && prev.peerId === peer.uid ? null : prev
          );
          showToast('Chamada não atendida.');
        }, 18_000);
        stealthCallTimersRef.current = [tRing, tEnd];
        return;
      }

      try {
        const handle = await startRealOutgoingCall({
          db,
          callerId: profile.uid,
          callerName: profile.name,
          callerInitials: profile.initials,
          callerAvatarColor: profile.avatarBg,
          calleeId: peer.uid,
          calleeName: peer.name,
          calleeInitials: peer.initials,
          calleeAvatarColor: peer.avatarBg || '#0D2B3E',
          callType,
          onRemoteStream: (stream) => {
            setActiveCall((prev) => (prev ? { ...prev, remoteStream: stream } : null));
          },
          onNetworkHealthChange: (networkHealth) => {
            setActiveCall((prev) => (prev ? { ...prev, networkHealth } : null));
          },
          onStatusChange: (status) => {
            if (status === 'ended' || status === 'declined' || status === 'missed') {
              webrtcHandleRef.current?.cleanup();
              webrtcHandleRef.current = null;
              setActiveCall(null);
              showToast(
                status === 'declined'
                  ? `${peer.name} recusou a chamada.`
                  : 'Chamada encerrada.'
              );
            } else {
              setActiveCall((prev) => (prev ? { ...prev, status } : null));
            }
          },
        });

        webrtcHandleRef.current = handle;
        setActiveCall((prev) =>
          prev
            ? {
                ...prev,
                callId: handle.callId,
                status: 'ringing',
                localStream: handle.localStream,
                remoteStream: handle.remoteStream,
              }
            : null
        );

        // Wake up the callee's closed/locked device via real high-priority Web Push
        if (authUser) {
          void triggerRemoteCallPush(authUser, {
            calleeId: peer.uid,
            callId: handle.callId,
            callerName: profile.name,
            callType,
            event: 'ringing',
          }).then((pushResult) => {
            setActiveCall((prev) =>
              prev && prev.callId === handle.callId
                ? { ...prev, remotePushDelivered: pushResult.sent > 0 }
                : prev
            );
          });
        }
      } catch (err) {
        const isPermission =
          err instanceof DOMException &&
          (err.name === 'NotAllowedError' || err.name === 'NotFoundError');
        setActiveCall((prev) =>
          prev
            ? {
                ...prev,
                status: 'ended',
                errorMessage: isPermission
                  ? `Permissão de ${callType === 'video' ? 'câmera e microfone' : 'microfone'} desativada neste aparelho. Autorize em Configurações > Privacidade e Permissões.`
                  : 'Não foi possível iniciar a chamada. Verifique sua conexão e tente novamente.',
              }
            : null
        );
      }
    },
    [authUser, profile, showToast, directoryUsers]
  );

  const handleAcceptIncomingCall = useCallback(async () => {
    if (!profile || !activeCall || !activeCall.offerSdp) return;
    setActiveCall((prev) => (prev ? { ...prev, status: 'connecting' } : null));

    if (authUser && activeCall.callId !== 'pending') {
      void triggerRemoteCallPush(authUser, {
        calleeId: profile.uid,
        callId: activeCall.callId,
        callerName: activeCall.peerName,
        callType: activeCall.callType,
        event: 'cancelled',
      });
    }

    try {
      const handle = await answerRealIncomingCall({
        db,
        callId: activeCall.callId,
        callerId: activeCall.peerId,
        calleeId: profile.uid,
        callType: activeCall.callType,
        offerSdp: activeCall.offerSdp,
        onRemoteStream: (stream) => {
          setActiveCall((prev) => (prev ? { ...prev, remoteStream: stream } : null));
        },
        onNetworkHealthChange: (networkHealth) => {
          setActiveCall((prev) => (prev ? { ...prev, networkHealth } : null));
        },
        onStatusChange: (status) => {
          if (status === 'ended' || status === 'declined' || status === 'missed') {
            webrtcHandleRef.current?.cleanup();
            webrtcHandleRef.current = null;
            setActiveCall(null);
            showToast('Chamada encerrada.');
          }
        },
      });

      webrtcHandleRef.current = handle;
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              status: 'active',
              localStream: handle.localStream,
              remoteStream: handle.remoteStream,
            }
          : null
      );
    } catch {
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              errorMessage:
                'Não foi possível acessar o microfone/câmera para atender a chamada.',
            }
          : null
      );
    }
  }, [authUser, profile, activeCall, showToast]);

  const handleDeclineIncomingCall = useCallback(async () => {
    if (!activeCall) return;
    ignoredCallIdsRef.current.add(activeCall.callId);
    const id = activeCall.callId;
    const callType = activeCall.callType;
    const peerName = activeCall.peerName;
    setActiveCall(null);
    if (id !== 'pending') {
      await updateRealCallStatus(db, id, 'declined', '00:00');
      if (authUser && profile) {
        void triggerRemoteCallPush(authUser, {
          calleeId: profile.uid,
          callId: id,
          callerName: peerName,
          callType,
          event: 'cancelled',
        });
      }
    }
  }, [activeCall, authUser, profile]);

  const handleEndCall = useCallback(
    async (durationLabel: string) => {
      stealthCallTimersRef.current.forEach((tid) => window.clearTimeout(tid));
      stealthCallTimersRef.current = [];
      if (!activeCall) return;
      const callId = activeCall.callId;
      const terminalStatus =
        activeCall.status === 'ringing' || activeCall.status === 'connecting'
          ? 'missed'
          : 'ended';
      ignoredCallIdsRef.current.add(callId);
      webrtcHandleRef.current?.cleanup();
      webrtcHandleRef.current = null;
      setActiveCall(null);
      if (callId !== 'pending') {
        await updateRealCallStatus(db, callId, terminalStatus, durationLabel);
        // Dismiss the ringing notification on the callee's locked device if caller hung up before answer
        if (
          authUser &&
          profile &&
          activeCall.direction === 'outgoing' &&
          terminalStatus === 'missed'
        ) {
          void triggerRemoteCallPush(authUser, {
            calleeId: activeCall.peerId,
            callId,
            callerName: profile.name,
            callType: activeCall.callType,
            event: 'cancelled',
          });
        }
      }
    },
    [activeCall, authUser, profile]
  );

  const handleSwitchCamera = useCallback(async () => {
    const handle = webrtcHandleRef.current;
    if (!handle) return;
    const updatedStream = await handle.switchCamera();
    if (updatedStream) {
      setActiveCall((prev) => (prev ? { ...prev, localStream: updatedStream } : null));
    } else {
      showToast('Não foi possível alternar a câmera neste aparelho.');
    }
  }, [showToast]);

  // --- CHAT PREFERENCES & CONVERSATION ACTIONS ---

  const updateChatPrefs = useCallback(
    (updater: (prev: UserChatPreferences) => UserChatPreferences) => {
      setChatPrefs((prev) => {
        const next: UserChatPreferences = {
          ...updater(prev),
          updatedAtMs: Date.now(),
        };
        if (authUid) {
          saveLocalChatPrefs(authUid, next);
        }
        const curAuth = authUserRef.current;
        if (curAuth) {
          void saveServerChatPrefs(curAuth, next);
        }
        return next;
      });
    },
    [authUid]
  );

  // --- CHAT & STOREFRONT NAVIGATION HANDLERS ---

  const openChatWithPeerDirect = useCallback(
    async (peer: ActiveChatPeer) => {
      const dirEntry = directoryUsers.find((u) => u.uid === peer.uid);
      const contactEntry = contacts.find((c) => c.matchedUid === peer.uid);
      const livePhoto = peer.avatarUrl || dirEntry?.avatarUrl;
      const resolvedPhone =
        peer.phone || contactEntry?.phone || dirEntry?.virtualLine;
      const resolvedVirtualLine = peer.virtualLine || dirEntry?.virtualLine;
      if (profile?.uid) {
        const cId = getDeterministicChatId(profile.uid, peer.uid);
        if (chatPrefs.unreadChatIds.includes(cId)) {
          updateChatPrefs((prev) => ({
            ...prev,
            unreadChatIds: prev.unreadChatIds.filter((id) => id !== cId),
          }));
        }
      }
      setSelectedPeer({
        ...peer,
        avatarUrl: livePhoto,
        phone: resolvedPhone,
        virtualLine: resolvedVirtualLine,
        hasStorefront: peer.hasStorefront && !dirEntry?.commercialBanned,
        ratingAverage: peer.ratingAverage ?? dirEntry?.ratingAverage,
        ratingCount: peer.ratingCount ?? dirEntry?.ratingCount,
      });
      setActiveTab('chats');
      if (peer.uid === OFFICIAL_SUPPORT_UID) return;
      void checkPeerReachability(peer.uid, authUserRef.current);
      // Refresh live storefront info for this peer
      const live = await fetchPublicUserStorefront(peer.uid);
      if (live) {
        setSelectedPeer((curr) =>
          curr && curr.uid === peer.uid
            ? {
                ...curr,
                hasStorefront:
                  live.hasStorefront &&
                  live.subscriptionStatus !== 'expired' &&
                  !live.commercialBanned,
                storefrontName: live.storefrontName,
                role: live.commercialBanned
                  ? 'normal'
                  : live.commercialMode === 'manufacturer'
                    ? 'manufacturer'
                    : live.commercialMode === 'reseller'
                      ? 'reseller'
                      : 'normal',
                deliveryPolicyLabel: live.deliveryPolicy.label,
                ratingAverage: live.ratingAverage,
                ratingCount: live.ratingCount,
              }
            : curr
        );
      }
    },
    [directoryUsers, contacts, profile?.uid, chatPrefs.unreadChatIds, updateChatPrefs]
  );

  const openChatWithPeer = useCallback(
    async (peer: ActiveChatPeer) => {
      if (profile?.uid) {
        const cId = getDeterministicChatId(profile.uid, peer.uid);
        if (chatPrefs.lockedChatIds.includes(cId) && !lockedFolderUnlocked) {
          setLockPinModal({
            mode: 'verify_unlock',
            chatIds: [cId],
            targetLabel: peer.name,
            onAfterUnlock: () => {
              setLockedFolderUnlocked(true);
              void openChatWithPeerDirect(peer);
            },
          });
          return;
        }
      }
      await openChatWithPeerDirect(peer);
    },
    [profile?.uid, chatPrefs.lockedChatIds, lockedFolderUnlocked, openChatWithPeerDirect]
  );

  const effectiveDirectoryUsers = useMemo(() => {
    const blockedSet = new Set(chatPrefs.blockedUids);
    return directoryUsers.map((u) => {
      if (!hiddenPresenceUids.has(u.uid) && !blockedSet.has(u.uid)) return u;
      return {
        ...u,
        isOnline: false,
        lastSeenAt: 0,
        showOnlineStatus: false,
        showLastSeen: false,
      };
    });
  }, [directoryUsers, hiddenPresenceUids, chatPrefs.blockedUids]);

  const directoryByUid = useMemo(() => {
    const map = new Map<string, PublicDirectoryUser>();
    for (const u of effectiveDirectoryUsers) {
      map.set(u.uid, u);
    }
    return map;
  }, [effectiveDirectoryUsers]);

  const openContactDetailsForUid = useCallback(
    (peerUid: string, fallbackName?: string) => {
      if (!profile) return;
      const contactMatch = contacts.find((c) => c.matchedUid === peerUid);
      const dir = directoryByUid.get(peerUid);
      const displayName = contactMatch?.name || dir?.displayName || fallbackName || 'Contato';
      const presence = getContactPresenceDisplay(dir, {
        fallback: contactMatch?.storefrontName || dir?.storefrontName || '',
      });
      setContactModalTarget({
        uid: peerUid,
        chatId: getDeterministicChatId(profile.uid, peerUid),
        name: displayName,
        initials: getInitials(displayName),
        avatarBg: contactMatch?.avatarBg || dir?.avatarColor || '#0E7A34',
        avatarUrl: dir?.avatarUrl,
        phone: contactMatch?.phone,
        virtualLine: dir?.virtualLine,
        statusMessage: dir?.statusMessage,
        presenceLabel: presence.label,
        isOnline: presence.isOnline,
        role:
          contactMatch?.role ||
          (dir?.commercialBanned ? 'normal' : dir?.role) ||
          'normal',
        hasStorefront: Boolean(
          (contactMatch?.hasStorefront || dir?.hasStorefront) && !dir?.commercialBanned
        ),
        storefrontName: contactMatch?.storefrontName || dir?.storefrontName,
        deliveryPolicyLabel: contactMatch?.deliveryPolicyLabel || dir?.deliveryPolicyLabel,
        ratingAverage: dir?.ratingAverage,
        ratingCount: dir?.ratingCount,
        isSavedContact: Boolean(contactMatch),
      });
    },
    [profile, contacts, directoryByUid]
  );

  const toggleChatSelection = useCallback((chatId: string) => {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }, []);

  const exitChatSelection = useCallback(() => {
    setSelectedChatIds(new Set());
    setShowChatListMenu(false);
  }, []);

  const toggleIdsInPrefList = useCallback(
    (key: 'pinnedChatIds' | 'archivedChatIds' | 'mutedChatIds' | 'favoriteChatIds' | 'unreadChatIds', ids: string[], labels: { added: string; removed: string }) => {
      if (ids.length === 0) return;
      const current = chatPrefs[key];
      const allPresent = ids.every((id) => current.includes(id));
      updateChatPrefs((prev) => {
        const set = new Set(prev[key]);
        if (allPresent) {
          for (const id of ids) set.delete(id);
        } else {
          for (const id of ids) set.add(id);
        }
        return { ...prev, [key]: Array.from(set) };
      });
      showToast(allPresent ? labels.removed : labels.added);
      exitChatSelection();
    },
    [chatPrefs, updateChatPrefs, showToast, exitChatSelection]
  );

  const handleRequestToggleLockChats = useCallback(
    (ids: string[], label?: string) => {
      if (ids.length === 0) return;
      setShowChatListMenu(false);
      const allLocked = ids.every((id) => chatPrefs.lockedChatIds.includes(id));
      if (allLocked) {
        if (chatPrefs.lockPinHash && !lockedFolderUnlocked) {
          setLockPinModal({
            mode: 'verify_to_remove',
            chatIds: ids,
            targetLabel: label,
          });
        } else {
          updateChatPrefs((prev) => ({
            ...prev,
            lockedChatIds: prev.lockedChatIds.filter((id) => !ids.includes(id)),
          }));
          showToast(ids.length === 1 ? 'Conversa destrancada.' : `${ids.length} conversas destrancadas.`);
          exitChatSelection();
        }
        return;
      }

      if (!chatPrefs.lockPinHash) {
        setLockPinModal({
          mode: 'create_and_lock',
          chatIds: ids,
          targetLabel: label,
        });
        return;
      }

      updateChatPrefs((prev) => ({
        ...prev,
        lockedChatIds: Array.from(new Set([...prev.lockedChatIds, ...ids])),
        archivedChatIds: prev.archivedChatIds.filter((id) => !ids.includes(id)),
      }));
      showToast(ids.length === 1 ? 'Conversa trancada com senha.' : `${ids.length} conversas trancadas.`);
      if (selectedPeer && profile && ids.includes(getDeterministicChatId(profile.uid, selectedPeer.uid))) {
        setSelectedPeer(null);
      }
      exitChatSelection();
    },
    [chatPrefs.lockedChatIds, chatPrefs.lockPinHash, lockedFolderUnlocked, updateChatPrefs, showToast, exitChatSelection, selectedPeer, profile]
  );

  const handleExecuteClearOrDeleteChats = useCallback(
    async (
      kind: 'clear' | 'delete_chat',
      chatIds: string[],
      deleteLocalMedia: boolean
    ) => {
      if (!profile || chatIds.length === 0) return;
      const nowMs = Date.now();
      const activeChatId = selectedPeer
        ? getDeterministicChatId(profile.uid, selectedPeer.uid)
        : null;

      for (const chatId of chatIds) {
        const matchingOutbox = outboxPackets
          .filter((p) => p.chatId === chatId)
          .map((p) => p.id);
        if (matchingOutbox.length > 0) {
          await removeOutboxPackets(matchingOutbox).catch(() => {});
        }
        if (deleteLocalMedia) {
          const mediaItems = await getLocalMediaByChat(chatId).catch(() => []);
          if (mediaItems.length > 0) {
            await deleteLocalMediaItems(mediaItems.map((m) => m.messageId)).catch(() => {});
          }
        }
      }

      // Compute cutoff strictly above existing loaded messages if clearing active chat
      const maxActiveMsgMs =
        activeChatId && chatIds.includes(activeChatId)
          ? activeMessages.reduce((mx, m) => Math.max(mx, m.createdAtMs || 0), 0)
          : 0;
      const cutoffBase = Math.max(nowMs, maxActiveMsgMs + 1);

      updateChatPrefs((prev) => {
        const nextCleared = { ...prev.clearedAtByChatId };
        const nextHidden = { ...prev.hiddenChatIds };
        const nextUnread = new Set(prev.unreadChatIds);
        const nextPinned = new Set(prev.pinnedChatIds);
        const nextArchived = new Set(prev.archivedChatIds);

        for (const cId of chatIds) {
          const thread = chats.find((c) => c.id === cId);
          const cutoff = Math.max(cutoffBase, (thread?.updatedAtMs || 0) + 1);
          nextCleared[cId] = cutoff;
          nextUnread.delete(cId);
          if (kind === 'delete_chat') {
            nextHidden[cId] = cutoff;
            nextPinned.delete(cId);
            nextArchived.delete(cId);
          }
        }

        return {
          ...prev,
          clearedAtByChatId: nextCleared,
          hiddenChatIds: nextHidden,
          unreadChatIds: Array.from(nextUnread),
          pinnedChatIds: Array.from(nextPinned),
          archivedChatIds: Array.from(nextArchived),
        };
      });

      if (kind === 'delete_chat' && activeChatId && chatIds.includes(activeChatId)) {
        setSelectedPeer(null);
      }
      exitChatSelection();
      showToast(
        kind === 'clear'
          ? chatIds.length === 1
            ? 'Conversa limpa neste aparelho.'
            : `${chatIds.length} conversas limpas.`
          : chatIds.length === 1
            ? 'Conversa apagada da lista.'
            : `${chatIds.length} conversas apagadas.`
      );
    },
    [profile, selectedPeer, outboxPackets, activeMessages, chats, updateChatPrefs, exitChatSelection, showToast]
  );

  const handleExecuteBlockToggle = useCallback(
    (peerUids: string[], mode: 'block' | 'unblock') => {
      if (peerUids.length === 0) return;
      const nowMs = Date.now();
      updateChatPrefs((prev) => {
        const set = new Set(prev.blockedUids);
        const nextBlockedAt = { ...(prev.blockedAtByUid || {}) };
        for (const uid of peerUids) {
          if (mode === 'block') {
            set.add(uid);
            nextBlockedAt[uid] = nowMs;
            sendChatActivity(uid, 'idle', authUserRef.current);
          } else {
            set.delete(uid);
            delete nextBlockedAt[uid];
          }
        }
        return {
          ...prev,
          blockedUids: Array.from(set),
          blockedAtByUid: nextBlockedAt,
        };
      });
      exitChatSelection();
      showToast(
        mode === 'block'
          ? peerUids.length === 1
            ? 'Contato bloqueado.'
            : `${peerUids.length} contatos bloqueados.`
          : peerUids.length === 1
            ? 'Contato desbloqueado.'
            : `${peerUids.length} contatos desbloqueados.`
      );
    },
    [updateChatPrefs, exitChatSelection, showToast]
  );

  const openHelpCenter = useCallback((ctx?: HelpCenterContext) => {
    setHelpModalContext(ctx ?? null);
    setHelpModalOpen(true);
  }, []);

  const handleOpenOfficialSupportChat = useCallback(
    (prefillMessage: string) => {
      setActiveStorefrontOwner(null);
      setChatPrefilledDraft({
        id: `sup_${Date.now()}`,
        text: prefillMessage,
      });
      void openChatWithPeer({
        uid: OFFICIAL_SUPPORT_UID,
        name: OFFICIAL_SUPPORT_NAME,
        initials: 'CF',
        avatarBg: '#0D2B3E',
        phone: OFFICIAL_SUPPORT_VIRTUAL_LINE,
        role: 'normal',
        hasStorefront: false,
        deliveryPolicyLabel: `Linha Virtual Oficial: ${OFFICIAL_SUPPORT_VIRTUAL_LINE}`,
      });
    },
    [openChatWithPeer]
  );

  // 6. Handle closed-app / locked-screen wake-up via Web Push deep link or Service Worker postMessage
  const processPushWakeAction = useCallback(
    async (params: {
      callId?: string;
      callAction?: string;
      openChatUid?: string;
    }) => {
      if (!profile) return;

      if (params.callId) {
        const dedupeKey = `${params.callId}:${params.callAction || 'open'}`;
        if (processedWakeCallIdsRef.current.has(dedupeKey)) return;
        processedWakeCallIdsRef.current.add(dedupeKey);

        if (params.callAction === 'decline') {
          ignoredCallIdsRef.current.add(params.callId);
          setActiveCall(null);
          await updateRealCallStatus(db, params.callId, 'declined', '00:00');
          if (authUser) {
            void triggerRemoteCallPush(authUser, {
              calleeId: profile.uid,
              callId: params.callId,
              callerName: 'Contato',
              callType: 'audio',
              event: 'cancelled',
            });
          }
          showToast('Chamada recusada.');
          return;
        }

        try {
          const snap = await getDoc(doc(db, 'calls', params.callId));
          if (!snap.exists()) {
            showToast('Esta chamada já foi encerrada.');
            return;
          }
          const d = snap.data();
          if (d.calleeId !== profile.uid || d.status !== 'ringing' || !d.offerSdp) {
            showToast('Esta chamada já foi encerrada.');
            return;
          }

          // Only stop server lock-screen push pulses once the user explicitly tapped a notification action (not on passive background ping)
          if (authUser && params.callAction === 'answer') {
            void triggerRemoteCallPush(authUser, {
              calleeId: profile.uid,
              callId: params.callId,
              callerName: String(d.callerName || 'Contato'),
              callType: d.callType === 'video' ? 'video' : 'audio',
              event: 'cancelled',
            });
          }

          const callType: 'audio' | 'video' = d.callType === 'video' ? 'video' : 'audio';
          const callerId = String(d.callerId || '');
          const callerName = String(d.callerName || 'Contato');
          const callerInitials = String(d.callerInitials || getInitials(callerName));
          const callerAvatarColor = String(d.callerAvatarColor || '#0E7A34');
          const offerSdp = String(d.offerSdp);

          let canAutoAnswer = false;
          if (params.callAction === 'answer') {
            const perms = await queryMediaPermissionSnapshot();
            canAutoAnswer =
              perms.mic === 'granted' && (callType === 'audio' || perms.cam === 'granted');
          }

          setActiveCall({
            callId: params.callId,
            direction: 'incoming',
            callType,
            peerId: callerId,
            peerName: callerName,
            peerInitials: callerInitials,
            peerAvatarColor: callerAvatarColor,
            status: canAutoAnswer ? 'connecting' : 'ringing',
            offerSdp,
            localStream: null,
            remoteStream: null,
          });

          if (canAutoAnswer) {
            try {
              const handle = await answerRealIncomingCall({
                db,
                callId: params.callId,
                callerId,
                calleeId: profile.uid,
                callType,
                offerSdp,
                onRemoteStream: (stream) => {
                  setActiveCall((prev) => (prev ? { ...prev, remoteStream: stream } : null));
                },
                onNetworkHealthChange: (networkHealth) => {
                  setActiveCall((prev) => (prev ? { ...prev, networkHealth } : null));
                },
                onStatusChange: (status) => {
                  if (status === 'ended' || status === 'declined' || status === 'missed') {
                    webrtcHandleRef.current?.cleanup();
                    webrtcHandleRef.current = null;
                    setActiveCall(null);
                    showToast('Chamada encerrada.');
                  }
                },
              });
              webrtcHandleRef.current = handle;
              setActiveCall((prev) =>
                prev
                  ? {
                      ...prev,
                      status: 'active',
                      localStream: handle.localStream,
                      remoteStream: handle.remoteStream,
                    }
                  : null
              );
            } catch {
              // If browser requires a fresh tap after cold-start to release mic/cam, keep the ringing UI ready
              setActiveCall((prev) =>
                prev ? { ...prev, status: 'ringing' } : null
              );
            }
          }
        } catch {
          showToast('Não foi possível recuperar os dados da chamada.');
        }
        return;
      }

      if (params.openChatUid) {
        const matched = contacts.find((c) => c.matchedUid === params.openChatUid);
        if (matched) {
          void openChatWithPeer({
            uid: params.openChatUid,
            name: matched.name,
            initials: matched.initials,
            avatarBg: matched.avatarBg,
            phone: matched.phone,
            role: matched.role,
            hasStorefront: matched.hasStorefront,
            storefrontName: matched.storefrontName,
            deliveryPolicyLabel: matched.deliveryPolicyLabel,
          });
        } else {
          const live = await fetchPublicUserStorefront(params.openChatUid);
          if (live) {
            void openChatWithPeer({
              uid: live.uid,
              name: live.displayName,
              initials: getInitials(live.displayName),
              avatarBg: '#0E7A34',
              role: live.commercialBanned
                ? 'normal'
                : live.commercialMode === 'manufacturer'
                  ? 'manufacturer'
                  : live.commercialMode === 'reseller'
                    ? 'reseller'
                    : 'normal',
              hasStorefront:
                live.hasStorefront &&
                live.subscriptionStatus !== 'expired' &&
                !live.commercialBanned,
              storefrontName: live.storefrontName,
              deliveryPolicyLabel: live.deliveryPolicy.label,
              ratingAverage: live.ratingAverage,
              ratingCount: live.ratingCount,
            });
          }
        }
      }
    },
    [authUser, profile, contacts, openChatWithPeer, showToast]
  );

  // Check URL query parameters when app is cold-launched from a push notification or WhatsApp Share Target
  const loadPendingSharedInbox = useCallback(async () => {
    const items = await getPendingSharedPayloads();
    if (items.length > 0) {
      setPendingSharedPayloads(items);
    }
  }, []);

  useEffect(() => {
    if (!profile || deviceAuthState !== 'authorized') return;
    const params = new URLSearchParams(window.location.search);
    const incomingCall = params.get('incomingCall') || undefined;
    const callAction = params.get('callAction') || undefined;
    const openChatUid = params.get('openChat') || undefined;
    const isSharedLaunch = params.get('shared') === '1';

    if (incomingCall || openChatUid || isSharedLaunch) {
      window.history.replaceState(window.history.state || {}, '', '/');
    }
    if (incomingCall || openChatUid) {
      void processPushWakeAction({ callId: incomingCall, callAction, openChatUid });
    }
    // Always check IndexedDB share inbox on authorized startup (covers WhatsApp Share Target)
    void loadPendingSharedInbox();
  }, [profile, deviceAuthState, processPushWakeAction, loadPendingSharedInbox]);

  // Load persisted Terms & Privacy consent record for this user/device
  useEffect(() => {
    if (!profile?.uid) {
      setPolicyConsent(null);
      setPolicyCheckedUid(null);
      return;
    }
    setPolicyConsent(getPolicyConsentRecord(profile.uid));
    setPolicyCheckedUid(profile.uid);
  }, [profile?.uid]);

  const handleAcceptPolicyAndAuthorize = useCallback(async () => {
    if (!profile?.uid) return;
    const saved = savePolicyConsentRecord(profile.uid);
    setPolicyConsent(saved);
    setPolicyCheckedUid(profile.uid);

    await authorizeAllZapeiResourcesOnce(authUser);
    setShowPoliciesModal(false);
    showToast('Termos aceitos. Tudo pronto para usar o ChatFi.');
  }, [profile?.uid, authUser, showToast]);

  // Listen for Service Worker notificationclick actions & WhatsApp Web Share Target pings
  useEffect(() => {
    if (!profile || !('serviceWorker' in navigator)) return undefined;
    const onSwMessage = (event: MessageEvent) => {
      const msg = event.data as {
        type?: string;
        payload?: {
          kind?: string;
          callId?: string;
          senderId?: string;
          senderName?: string;
          body?: string;
          messageType?: 'text' | 'audio' | 'image' | 'video';
          action?: string;
        };
      };
      if (msg?.type === 'ZAPEI_SHARED_MEDIA_READY') {
        void loadPendingSharedInbox();
        return;
      }
      if (msg?.type === 'ZAPEI_INCOMING_CALL_PING' && msg.payload?.callId) {
        void processPushWakeAction({ callId: msg.payload.callId });
        return;
      }
      if (msg?.type === 'ZAPEI_INCOMING_MESSAGE_PING' && msg.payload) {
        if (
          msg.payload.senderId !== profile.uid &&
          msg.payload.senderId !== activeOpenPeerIdRef.current
        ) {
          playMessageNotificationSound(
            msg.payload.messageType === 'audio' ? 'audio' : 'text'
          );
        }
        return;
      }
      if (msg?.type !== 'ZAPEI_PUSH_ACTION' || !msg.payload) return;
      if (msg.payload.kind === 'incoming_call' && msg.payload.callId) {
        void processPushWakeAction({
          callId: msg.payload.callId,
          callAction: msg.payload.action,
        });
      } else if (msg.payload.kind === 'new_message' && msg.payload.senderId) {
        void processPushWakeAction({ openChatUid: msg.payload.senderId });
      }
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, [profile, processPushWakeAction, loadPendingSharedInbox]);

  const shareTargetRecipients = useMemo<ShareTargetRecipient[]>(() => {
    if (!profile) return [];
    const byUid = new Map<string, ShareTargetRecipient>();

    // 1. Recent conversations first
    for (const c of chats) {
      if (!c.otherUid || c.otherUid === profile.uid) continue;
      const contactMatch = contacts.find((ct) => ct.matchedUid === c.otherUid);
      const dirMatch = directoryUsers.find((u) => u.uid === c.otherUid);
      const name = contactMatch?.name || dirMatch?.displayName || c.otherName || 'Contato';
      byUid.set(c.otherUid, {
        uid: c.otherUid,
        name,
        subtitle: dirMatch?.virtualLine || contactMatch?.phone || 'Conversa recente',
        initials: getInitials(name),
        avatarBg: contactMatch?.avatarBg || dirMatch?.avatarColor || '#0E7A34',
        avatarUrl: dirMatch?.avatarUrl,
      });
    }

    // 2. Registered contacts in user's phonebook
    for (const ct of contacts) {
      if (!ct.matchedUid || ct.matchedUid === profile.uid || byUid.has(ct.matchedUid)) continue;
      const dirMatch = directoryUsers.find((u) => u.uid === ct.matchedUid);
      byUid.set(ct.matchedUid, {
        uid: ct.matchedUid,
        name: ct.name,
        subtitle: dirMatch?.virtualLine || ct.phone || 'Contato ChatFi',
        initials: ct.initials || getInitials(ct.name),
        avatarBg: ct.avatarBg || dirMatch?.avatarColor || '#0E7A34',
        avatarUrl: dirMatch?.avatarUrl,
      });
    }

    return Array.from(byUid.values());
  }, [chats, contacts, directoryUsers, profile]);

  const handleDismissSharedPayloads = useCallback(async () => {
    const ids = pendingSharedPayloads.map((p) => p.id);
    setPendingSharedPayloads([]);
    await clearPendingSharedPayloads(ids);
  }, [pendingSharedPayloads]);

  // Track previous main tabs so Android Back (◀) returns to the previous visited tab and then 'chats'
  const tabHistoryRef = useRef<MainTab[]>([]);
  const prevActiveTabRef = useRef<MainTab>(activeTab);
  const poppingTabBackRef = useRef(false);

  useEffect(() => {
    const prev = prevActiveTabRef.current;
    prevActiveTabRef.current = activeTab;
    if (poppingTabBackRef.current) {
      poppingTabBackRef.current = false;
      return;
    }
    if (activeTab === 'chats') {
      tabHistoryRef.current = [];
      return;
    }
    if (prev !== activeTab) {
      tabHistoryRef.current = [
        ...tabHistoryRef.current.filter((t) => t !== prev && t !== activeTab),
        prev,
      ].slice(-6);
    }
  }, [activeTab]);

  // Android system Back arrow (◀) & browser Back navigation across all app layers
  useSystemBackHandler(
    activeTab === 'chats' && !selectedPeer && chatSearch.trim().length > 0,
    () => setChatSearch(''),
    BACK_PRIORITY.SEARCH
  );
  useSystemBackHandler(
    activeTab !== 'chats',
    () => {
      const nextBackTab = tabHistoryRef.current.pop() || 'chats';
      poppingTabBackRef.current = true;
      setActiveTab(nextBackTab);
    },
    BACK_PRIORITY.TAB,
    activeTab
  );
  useSystemBackHandler(
    Boolean(selectedPeer),
    () => setSelectedPeer(null),
    BACK_PRIORITY.SCREEN,
    selectedPeer?.uid || ''
  );
  useSystemBackHandler(
    Boolean(activeStorefrontOwner),
    () => setActiveStorefrontOwner(null),
    BACK_PRIORITY.SCREEN + 2,
    activeStorefrontOwner?.uid || ''
  );
  useSystemBackHandler(
    showEditProfile,
    () => setShowEditProfile(false),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(trialPromptRole),
    () => setTrialPromptRole(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    showBillingModal,
    () => setShowBillingModal(false),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    showPoliciesModal,
    () => setShowPoliciesModal(false),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    helpModalOpen,
    () => setHelpModalOpen(false),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    pendingSharedPayloads.length > 0,
    () => {
      void handleDismissSharedPayloads();
    },
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    showChatListMenu,
    () => setShowChatListMenu(false),
    BACK_PRIORITY.DRAWER + 1
  );
  useSystemBackHandler(
    activeTab === 'chats' && !selectedPeer && selectedChatIds.size > 0,
    exitChatSelection,
    BACK_PRIORITY.DRAWER
  );
  useSystemBackHandler(
    activeTab === 'chats' &&
      !selectedPeer &&
      (chatListFilter === 'archived' || chatListFilter === 'locked'),
    () => setChatListFilter('all'),
    BACK_PRIORITY.SEARCH
  );
  useSystemBackHandler(
    Boolean(contactModalTarget),
    () => setContactModalTarget(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(shortcutModalTarget),
    () => setShortcutModalTarget(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(lockPinModal),
    () => setLockPinModal(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(addToListTarget),
    () => setAddToListTarget(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(chatConfirmModal),
    () => setChatConfirmModal(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(avatarPreview),
    () => setAvatarPreview(null),
    BACK_PRIORITY.LIGHTBOX
  );

  const handleSendSharedContent = useCallback(
    async (params: {
      recipients: ShareTargetRecipient[];
      items: PreparedShareItem[];
      textMessage: string;
      caption: string;
      onProgress?: (current: number, total: number) => void;
    }) => {
      if (!profile || !authUser) return;
      const { recipients, items, textMessage, caption, onProgress } = params;

      const totalOps =
        recipients.length * (items.length + (textMessage ? 1 : 0));
      let completedOps = 0;

      // Pre-compress shared images once before sending to 1 or multiple recipients
      const preparedBlobs = await Promise.all(
        items.map(async (item) => {
          if (item.kind === 'image') {
            try {
              const imgFile = new File([item.blob], item.name, {
                type: item.mimeType || 'image/jpeg',
              });
              const compressed = await compressImageFileToBlob(
                imgFile,
                MAX_IMAGE_WIDTH,
                IMAGE_JPEG_QUALITY
              );
              return { item, blob: compressed.blob, mimeType: compressed.mimeType };
            } catch {
              return { item, blob: item.blob, mimeType: item.mimeType || 'image/jpeg' };
            }
          }
          return { item, blob: item.blob, mimeType: item.mimeType };
        })
      );

      for (const target of recipients) {
        for (let idx = 0; idx < preparedBlobs.length; idx += 1) {
          const { item, blob, mimeType } = preparedBlobs[idx];
          completedOps += 1;
          onProgress?.(completedOps, Math.max(1, totalOps));

          if (!isOnline) {
            if (
              (item.kind === 'image' || item.kind === 'audio' || item.kind === 'pdf') &&
              blob.size <= 330 * 1024
            ) {
              const dataUrl = await blobToDataUrl(blob);
              const isPdfItem = item.kind === 'pdf';
              const resolvedOfflineType: 'image' | 'audio' =
                item.kind === 'audio' ? 'audio' : 'image';
              await sendOrQueueMessage(
                {
                  senderId: profile.uid,
                  senderName: profile.name,
                  recipientId: target.uid,
                  recipientName: target.name,
                  type: resolvedOfflineType,
                  text:
                    item.kind === 'audio'
                      ? `Mensagem de voz (${item.durationLabel || '0:00'})`
                      : isPdfItem
                        ? item.name || 'Documento.pdf'
                        : (idx === 0 && caption) || 'Foto',
                  mediaUrl: dataUrl,
                  mediaMimeType: isPdfItem ? 'application/pdf' : mimeType,
                  audioDuration: item.kind === 'audio' ? item.durationLabel || '0:00' : undefined,
                  pushPreviewText:
                    item.kind === 'audio'
                      ? `Áudio (${item.durationLabel || '0:00'})`
                      : isPdfItem
                        ? `PDF: ${item.name || 'Documento.pdf'}`
                        : caption
                          ? `Foto: ${caption}`
                          : 'Enviou uma foto',
                  pushMessageType: resolvedOfflineType,
                },
                authUser
              );
            } else {
              throw new Error(
                'Sem conexão para enviar arquivos grandes compartilhados. Conecte-se à internet e tente novamente.'
              );
            }
          } else {
            const isPdfItem = item.kind === 'pdf';
            const resolvedOnlineType: 'image' | 'audio' | 'video' =
              item.kind === 'pdf' ? 'image' : item.kind;
            await sendMediaWithTransitBridge({
              myUid: profile.uid,
              myName: profile.name,
              recipientId: target.uid,
              recipientName: target.name,
              mediaType: resolvedOnlineType,
              blob,
              mimeType: isPdfItem ? 'application/pdf' : mimeType,
              durationLabel:
                item.kind === 'audio'
                  ? item.durationLabel || '0:00'
                  : item.kind === 'video'
                    ? item.durationLabel || undefined
                    : undefined,
              caption: isPdfItem
                ? item.name || 'Documento.pdf'
                : item.kind === 'image' || item.kind === 'video'
                  ? idx === 0
                    ? caption || (item.kind === 'image' ? 'Foto' : undefined)
                    : item.kind === 'image'
                      ? 'Foto'
                      : undefined
                  : undefined,
              fileName: item.name,
              authUser,
            });
          }
        }

        if (textMessage) {
          completedOps += 1;
          onProgress?.(completedOps, Math.max(1, totalOps));
          await sendOrQueueMessage(
            {
              senderId: profile.uid,
              senderName: profile.name,
              recipientId: target.uid,
              recipientName: target.name,
              type: 'text',
              text: textMessage,
              pushPreviewText: textMessage,
              pushMessageType: 'text',
            },
            authUser
          );
        }
      }

      const ids = pendingSharedPayloads.map((p) => p.id);
      setPendingSharedPayloads([]);
      await clearPendingSharedPayloads(ids);

      // Open the first chosen chat automatically so the user sees the sent photo/audio right away
      const first = recipients[0];
      if (first) {
        const dirMatch = directoryUsers.find((u) => u.uid === first.uid);
        void openChatWithPeer({
          uid: first.uid,
          name: first.name,
          phone: dirMatch?.virtualLine || first.subtitle,
          initials: first.initials,
          avatarBg: first.avatarBg,
          avatarUrl: first.avatarUrl,
          role: dirMatch?.role || 'normal',
          hasStorefront: Boolean(dirMatch?.hasStorefront),
          storefrontName: dirMatch?.storefrontName,
        });
      }

      showToast(
        recipients.length === 1
          ? `Conteúdo compartilhado enviado para ${recipients[0].name}!`
          : `Conteúdo compartilhado enviado para ${recipients.length} conversas!`
      );
    },
    [
      profile,
      authUser,
      isOnline,
      pendingSharedPayloads,
      directoryUsers,
      openChatWithPeer,
      showToast,
    ]
  );

  const openStorefrontByUid = useCallback(
    async (
      uid: string,
      initialTab: 'catalog' | 'cart' | 'orders' = 'catalog'
    ) => {
      const owner = await fetchPublicUserStorefront(uid);
      if (!owner) {
        showToast('Vitrine não encontrada.');
        return;
      }
      setActiveStorefrontInitialTab(initialTab);
      setActiveStorefrontOwner(owner);
    },
    [showToast]
  );

  // --- COMMERCIAL WORKFLOW HANDLERS ---

  const handleSelectCommercialMode = useCallback(
    async (targetMode: CommercialMode) => {
      if (!profile) return;
      if (targetMode === 'buyer') {
        await persistProfileUpdate({ commercialMode: 'buyer' });
        showToast('Modo Padrão (Comprador gratuito) selecionado.');
        return;
      }

      if (profile.commercialBanned) {
        showToast(
          'Os modos Fabricante e Revendedor estão temporariamente suspensos para análise. Contate o suporte para revisão.'
        );
        return;
      }

      const banCheck = await checkCommercialBanStatus({
        uid: profile.uid,
        phone: profile.phone,
        phoneHash: profile.phoneHash,
        virtualLine: profile.virtualLine,
      });
      if (banCheck.banned) {
        showToast(
          banCheck.reason ||
            'Os modos Fabricante e Revendedor estão temporariamente suspensos para esta conta.'
        );
        return;
      }

      const alreadyActivated =
        (targetMode === 'manufacturer' && profile.manufacturerActivated) ||
        (targetMode === 'reseller' && profile.resellerActivated);

      // Require validated CPF before enabling or entering Manufacturer / Reseller modes
      if (!alreadyActivated || !profile.cpfVerified) {
        setTrialPromptRole(targetMode);
        return;
      }

      await persistProfileUpdate({
        commercialMode: targetMode,
      });
      setActiveTab('commercial');
    },
    [profile, persistProfileUpdate, showToast]
  );

  const handleConfirmTrialActivation = useCallback(
    async (businessName: string, cpfRaw?: string) => {
      if (!profile || !trialPromptRole) return;

      if (profile.commercialBanned) {
        throw new Error(
          'Os modos Fabricante e Revendedor estão suspensos para esta conta. Solicite revisão pela Central de Ajuda.'
        );
      }

      if (!profile.cpfVerified) {
        const res = await verifyAndBindCpfForCommercialRole({
          uid: profile.uid,
          cpfRaw: cpfRaw || '',
          phone: profile.phone,
          phoneHash: profile.phoneHash,
          virtualLine: profile.virtualLine,
          authMethod: profile.authMethod,
        });
        if (!res.ok) {
          throw new Error(
            res.message ||
              'Não foi possível validar o CPF para liberar o modo comercial.'
          );
        }
      } else {
        const banCheck = await checkCommercialBanStatus({
          uid: profile.uid,
          phone: profile.phone,
          phoneHash: profile.phoneHash,
          virtualLine: profile.virtualLine,
        });
        if (banCheck.banned) {
          throw new Error(
            banCheck.reason ||
              'Os modos Fabricante e Revendedor estão temporariamente suspensos para este CPF/conta.'
          );
        }
      }

      const cleanedName = businessName.trim() || profile.name;
      const trialEndsAt =
        profile.trialEndsAt > Date.now()
          ? profile.trialEndsAt
          : Date.now() + 30 * 24 * 60 * 60 * 1000;

      await persistProfileUpdate({
        commercialMode: trialPromptRole,
        manufacturerActivated:
          trialPromptRole === 'manufacturer' ? true : profile.manufacturerActivated,
        resellerActivated:
          trialPromptRole === 'reseller' ? true : profile.resellerActivated,
        factoryName:
          trialPromptRole === 'manufacturer' ? cleanedName : profile.factoryName,
        storefrontName:
          trialPromptRole === 'reseller'
            ? cleanedName
            : profile.resellerActivated
              ? profile.storefrontName
              : cleanedName,
        subscriptionStatus:
          profile.subscriptionStatus === 'active' ? 'active' : 'trial',
        trialEndsAt,
      });
      setTrialPromptRole(null);
      setActiveTab('commercial');
      showToast(
        trialPromptRole === 'manufacturer'
          ? `Perfil de Anunciante "${cleanedName}" ativado! Você já pode publicar seus anúncios.`
          : `Vitrine "${cleanedName}" ativada! Você já pode conectar seus fornecedores.`
      );
    },
    [profile, trialPromptRole, persistProfileUpdate, showToast]
  );

  const handleSubmitCommercialReview = useCallback(
    async (params: {
      orderId: string;
      orderCode: string;
      subOrderId?: string;
      targetUid: string;
      targetName: string;
      targetRole: TargetCommercialRole;
      reviewerRole: 'buyer' | 'reseller';
      stars: 1 | 2 | 3 | 4 | 5;
      comment: string;
    }) => {
      if (!profile) return;
      await submitCommercialReview({
        ...params,
        reviewerId: profile.uid,
        reviewerName: profile.name,
      });
      showToast(`Avaliação de ${params.stars} estrela(s) registrada!`);
    },
    [profile, showToast]
  );

  const handleSubmitDeliveryReport = useCallback(
    async (params: {
      orderId: string;
      orderCode: string;
      subOrderId?: string;
      subOrderCode?: string;
      reportedUid: string;
      reportedName: string;
      reportedRole: TargetCommercialRole;
      reporterRole: 'buyer' | 'reseller';
      reason: string;
      description: string;
    }) => {
      if (!profile) throw new Error('Sessão inválida.');
      const res = await submitDeliveryBadFaithReport({
        ...params,
        reporterId: profile.uid,
        reporterName: profile.name,
        reporterVirtualLine: profile.virtualLine || profile.phone,
      });
      showToast(
        `Ocorrência ${res.reportCode} registrada e vinculada ao chamado ${res.ticketCode}.`
      );
      return res;
    },
    [profile, showToast]
  );

  const handleConfirmConference = useCallback(
    async (
      sub: SubOrder,
      decisions: Record<string, 'available' | 'unavailable'>
    ) => {
      const parent = effectiveOrders.find((o) => o.id === sub.parentOrderId);
      const updatedItems = sub.items.map((item) => ({
        ...item,
        availability: decisions[item.id] ?? 'available',
      }));

      // Deduct stock only for legacy orders that didn't reserve stock atomically at checkout
      if (!parent?.stockReserved) {
        for (const item of updatedItems) {
          if (item.availability === 'available') {
            const prod = products.find((p) => p.id === item.productId);
            if (prod) {
              const nextStock = Math.max(0, prod.stockBoxes - item.boxesRequested);
              await updateRealProductStock(
                prod.id,
                nextStock,
                nextStock === 0 ? true : prod.isSoldOutToday
              );
            }
          }
        }
      } else {
        // Restore any item marked unavailable during partial conference back to product stock
        for (const item of updatedItems) {
          if (item.availability === 'unavailable') {
            const prod = products.find((p) => p.id === item.productId);
            if (prod && item.boxesRequested > 0) {
              const nextStock = prod.stockBoxes + item.boxesRequested;
              await updateRealProductStock(prod.id, nextStock, false);
            }
          }
        }
      }

      const availableItems = updatedItems.filter((i) => i.availability === 'available');
      const newFactoryCost = availableItems.reduce(
        (sum, i) => sum + i.boxesRequested * i.unitFactoryPrice,
        0
      );
      const newBuyerSubtotal = availableItems.reduce(
        (sum, i) => sum + i.boxesRequested * i.unitBuyerPrice,
        0
      );

      const newSubStatus: OrderStatus =
        availableItems.length === 0
          ? 'cancelled'
          : availableItems.length < updatedItems.length
            ? 'partial_confirmed'
            : 'confirmed';

      await updateRealSubOrder(sub.id, {
        items: updatedItems,
        factoryCost: newFactoryCost,
        buyerSubtotal: newBuyerSubtotal,
        status: newSubStatus,
      });

      // Update Layer 1 payment for this sub-order
      await updateRealPayment(`pay_fr_${sub.id}`, {
        amount: newFactoryCost,
        ...(newSubStatus === 'cancelled' ? { status: 'Cancelado' as PaymentStatus } : {}),
      });

      // Recompute parent order totals & Split breakdown & Layer 2 payment
      if (parent) {
        const mergedSubs = parent.subOrders.map((s) =>
          s.id === sub.id
            ? {
                ...s,
                factoryCost: newFactoryCost,
                buyerSubtotal: newBuyerSubtotal,
                status: newSubStatus,
              }
            : s
        );
        const totalFactory = mergedSubs.reduce((acc, s) => acc + s.factoryCost, 0);
        const totalBuyerSub = mergedSubs.reduce((acc, s) => acc + s.buyerSubtotal, 0);
        const maxCommission = Math.max(0, totalBuyerSub - totalFactory);
        const clampedDiscount = Math.min(parent.discountAmount, maxCommission);
        const finalBuyer = Math.max(totalFactory, totalBuyerSub - clampedDiscount);

        const nextBreakdown = calculateOrderSplit({
          orderTotal: finalBuyer,
          factoryCostTotal: totalFactory,
          paymentMethod: parent.paymentMethod || 'pix',
          installments: parent.installments || 1,
          isDirectManufacturerSale:
            parent.factoryIds.length === 1 &&
            parent.factoryIds[0] === parent.resellerId &&
            Math.abs(finalBuyer - totalFactory) < 0.01,
          subOrders: mergedSubs.map((s) => ({
            id: s.id,
            subOrderCode: s.subOrderCode,
            factoryId: s.factoryId,
            factoryName: s.factoryName,
            factoryCost: s.factoryCost,
          })),
        });

        const subSplit = nextBreakdown.subOrderSplits.find((sp) => sp.subOrderId === sub.id);
        if (subSplit) {
          await updateRealPayment(`pay_fr_${sub.id}`, {
            netAmount: subSplit.factoryNetAmount,
          }).catch(() => {});
        }

        await updateRealOrder(parent.id, {
          factoryCostTotal: totalFactory,
          buyerSubtotal: totalBuyerSub,
          discountAmount: clampedDiscount,
          buyerFinalTotal: finalBuyer,
          status: newSubStatus,
          ...(availableItems.length > 0 && !parent.stockReserved
            ? { stockReserved: true }
            : {}),
          buyerChargedTotal: nextBreakdown.buyerChargedTotal,
          gatewayFee: nextBreakdown.gatewayFee,
          platformFeeGross: nextBreakdown.platformGrossFee,
          platformFeeNet: nextBreakdown.platformNetFee,
          minimumFeeApplied: nextBreakdown.minimumRuleApplied,
          splitFactoryNet: nextBreakdown.factoryNetTotal,
          splitResellerNet: nextBreakdown.resellerNetTotal,
        });
        if (profile && parent.resellerId === profile.uid) {
          await updateRealPayment(`pay_rb_${parent.id}`, {
            amount: finalBuyer,
            costReference: totalFactory,
            gatewayFee: nextBreakdown.gatewayFee,
            platformFeeGross: nextBreakdown.platformGrossFee,
            platformFeeNet: nextBreakdown.platformNetFee,
            netAmount: nextBreakdown.resellerNetTotal,
            ...(newSubStatus === 'cancelled' ? { status: 'Cancelado' as PaymentStatus } : {}),
          });
        }
      }
    },
    [products, effectiveOrders, profile]
  );

  // Reseller-side automatic Layer 2 reconciliation when a connected factory performs a partial stock cut
  useEffect(() => {
    if (!profile) return;
    for (const order of effectiveOrders) {
      if (order.resellerId !== profile.uid) continue;
      const layer2Pay = effectivePayments.find(
        (p) => p.id === `pay_rb_${order.id}` && p.ownerId === profile.uid
      );
      if (
        layer2Pay &&
        (Math.abs(layer2Pay.amount - order.buyerFinalTotal) > 0.01 ||
          Math.abs((layer2Pay.costReference ?? 0) - order.factoryCostTotal) > 0.01)
      ) {
        void updateRealPayment(layer2Pay.id, {
          amount: order.buyerFinalTotal,
          costReference: order.factoryCostTotal,
          ...(typeof order.gatewayFee === 'number' ? { gatewayFee: order.gatewayFee } : {}),
          ...(typeof order.platformFeeGross === 'number'
            ? { platformFeeGross: order.platformFeeGross }
            : {}),
          ...(typeof order.platformFeeNet === 'number'
            ? { platformFeeNet: order.platformFeeNet }
            : {}),
          ...(typeof order.splitResellerNet === 'number'
            ? { netAmount: order.splitResellerNet }
            : {}),
        }).catch(() => {});
      }
    }
  }, [effectiveOrders, effectivePayments, profile]);

  const handleApplyPunctualDiscount = useCallback(
    async (order: MixedOrder, mode: 'fixed' | 'percent', value: number) => {
      const maxCommission = Math.max(0, order.buyerSubtotal - order.factoryCostTotal);
      const rawDiscount =
        mode === 'fixed' ? value : (order.buyerSubtotal * value) / 100;
      const clampedDiscount = Number(
        Math.min(maxCommission, Math.max(0, rawDiscount)).toFixed(2)
      );
      const finalTotal = Number(
        Math.max(order.factoryCostTotal, order.buyerSubtotal - clampedDiscount).toFixed(2)
      );

      const nextBreakdown = calculateOrderSplit({
        orderTotal: finalTotal,
        factoryCostTotal: order.factoryCostTotal,
        paymentMethod: order.paymentMethod || 'pix',
        installments: order.installments || 1,
        isDirectManufacturerSale:
          order.factoryIds.length === 1 &&
          order.factoryIds[0] === order.resellerId &&
          Math.abs(finalTotal - order.factoryCostTotal) < 0.01,
        subOrders: order.subOrders.map((s) => ({
          id: s.id,
          subOrderCode: s.subOrderCode,
          factoryId: s.factoryId,
          factoryName: s.factoryName,
          factoryCost: s.factoryCost,
        })),
      });

      await updateRealOrder(order.id, {
        discountMode: mode,
        discountValue: value,
        discountAmount: clampedDiscount,
        buyerFinalTotal: finalTotal,
        buyerChargedTotal: nextBreakdown.buyerChargedTotal,
        gatewayFee: nextBreakdown.gatewayFee,
        platformFeeGross: nextBreakdown.platformGrossFee,
        platformFeeNet: nextBreakdown.platformNetFee,
        minimumFeeApplied: nextBreakdown.minimumRuleApplied,
        splitFactoryNet: nextBreakdown.factoryNetTotal,
        splitResellerNet: nextBreakdown.resellerNetTotal,
      });
      await updateRealPayment(`pay_rb_${order.id}`, {
        amount: finalTotal,
        gatewayFee: nextBreakdown.gatewayFee,
        platformFeeGross: nextBreakdown.platformGrossFee,
        platformFeeNet: nextBreakdown.platformNetFee,
        netAmount: nextBreakdown.resellerNetTotal,
      });
    },
    []
  );

  const handleGenerateAsaasChargeForOrder = useCallback(
    async (
      order: MixedOrder,
      paymentMethod: SplitPaymentMethod,
      installments: number
    ): Promise<CreateAsaasChargeResult> => {
      const chargeResult = await createAsaasSplitCharge({
        orderId: order.id,
        paymentMethod,
        installments,
        customerInfo: {
          name: order.buyerName || profile?.name,
          email: profile?.email,
        },
      });
      const b = chargeResult.splitBreakdown;
      await updateRealOrder(order.id, {
        paymentMethod: b.paymentMethod,
        installments: b.installments,
        buyerChargedTotal: b.buyerChargedTotal,
        gatewayFee: b.gatewayFee,
        platformFeeGross: b.platformGrossFee,
        platformFeeNet: b.platformNetFee,
        minimumFeeApplied: b.minimumRuleApplied,
        splitFactoryNet: b.factoryNetTotal,
        splitResellerNet: b.resellerNetTotal,
        asaasChargeId: chargeResult.chargeId,
        asaasChargeStatus: chargeResult.status,
        ...(chargeResult.invoiceUrl ? { asaasInvoiceUrl: chargeResult.invoiceUrl } : {}),
        ...(chargeResult.pixCopyPaste ? { asaasPixPayload: chargeResult.pixCopyPaste } : {}),
      });
      if (profile?.uid === order.resellerId) {
        await updateRealPayment(`pay_rb_${order.id}`, {
          method: b.paymentMethod === 'credit_card' ? 'Cartão' : 'À vista',
          gatewayFee: b.gatewayFee,
          platformFeeGross: b.platformGrossFee,
          platformFeeNet: b.platformNetFee,
          netAmount: b.resellerNetTotal,
          asaasChargeId: chargeResult.chargeId,
          asaasChargeStatus: chargeResult.status,
        }).catch(() => {});
        for (const sub of order.subOrders) {
          await updateRealPayment(`pay_fr_${sub.id}`, {
            asaasChargeId: chargeResult.chargeId,
            asaasChargeStatus: chargeResult.status,
          }).catch(() => {});
        }
      } else if (profile?.uid === order.buyerId) {
        await updateRealPayment(`pay_rb_${order.id}`, {
          asaasChargeId: chargeResult.chargeId,
          asaasChargeStatus: chargeResult.status,
        }).catch(() => {});
      }
      return chargeResult;
    },
    [profile?.uid, profile?.name, profile?.email]
  );

  const handleSyncAsaasOrderStatus = useCallback(
    async (order: MixedOrder): Promise<AsaasOrderStatusResult | null> => {
      const statusRes = await fetchAsaasOrderStatus(order.id);
      if (!statusRes.found) {
        showToast(`Nenhuma cobrança Asaas encontrada no servidor para ${order.orderCode}.`);
        return statusRes;
      }
      const nextAsaasStatus = statusRes.asaasStatus || statusRes.mappedPaymentStatus;
      if (profile?.uid === order.buyerId || profile?.uid === order.resellerId) {
        await updateRealOrder(order.id, {
          ...(statusRes.chargeId ? { asaasChargeId: statusRes.chargeId } : {}),
          ...(nextAsaasStatus ? { asaasChargeStatus: nextAsaasStatus } : {}),
          ...(statusRes.invoiceUrl ? { asaasInvoiceUrl: statusRes.invoiceUrl } : {}),
          ...(statusRes.pixCopyPaste ? { asaasPixPayload: statusRes.pixCopyPaste } : {}),
        }).catch(() => {});
      }
      if (profile?.uid === order.resellerId) {
        await updateRealPayment(`pay_rb_${order.id}`, {
          ...(statusRes.mappedPaymentStatus ? { status: statusRes.mappedPaymentStatus } : {}),
          ...(statusRes.chargeId ? { asaasChargeId: statusRes.chargeId } : {}),
          ...(nextAsaasStatus ? { asaasChargeStatus: nextAsaasStatus } : {}),
        }).catch(() => {});
        for (const sub of order.subOrders) {
          await updateRealPayment(`pay_fr_${sub.id}`, {
            ...(statusRes.chargeId ? { asaasChargeId: statusRes.chargeId } : {}),
            ...(nextAsaasStatus ? { asaasChargeStatus: nextAsaasStatus } : {}),
          }).catch(() => {});
        }
      } else if (profile?.uid === order.buyerId) {
        await updateRealPayment(`pay_rb_${order.id}`, {
          ...(statusRes.chargeId ? { asaasChargeId: statusRes.chargeId } : {}),
          ...(nextAsaasStatus ? { asaasChargeStatus: nextAsaasStatus } : {}),
        }).catch(() => {});
      } else if (profile?.uid && order.factoryIds.includes(profile.uid)) {
        for (const sub of order.subOrders) {
          if (sub.factoryId !== profile.uid) continue;
          await updateRealPayment(`pay_fr_${sub.id}`, {
            ...(statusRes.mappedPaymentStatus ? { status: statusRes.mappedPaymentStatus } : {}),
            ...(statusRes.chargeId ? { asaasChargeId: statusRes.chargeId } : {}),
            ...(nextAsaasStatus ? { asaasChargeStatus: nextAsaasStatus } : {}),
          }).catch(() => {});
        }
      }
      return statusRes;
    },
    [profile?.uid, showToast]
  );

  const handleCancelOrderAndReleaseStock = useCallback(
    async (orderId: string, reason: OrderCancelReason): Promise<CancelOrderResult> => {
      const res = await cancelOrderAndReleaseStock(orderId, reason);
      recordLocalCancelledOrder({
        orderId,
        status: 'cancelled',
        stockRestored: true,
        cancelledAtMs: res.cancelledAtMs || Date.now(),
        cancelReason: res.cancelReason || reason,
        asaasChargeStatus: res.asaasChargeStatus,
      });
      if (res.alreadyCancelled) {
        showToast('Este pedido já havia sido cancelado e seu estoque liberado.');
      } else {
        const totalReturned = (res.restoredItems || []).reduce(
          (acc, it) => acc + it.boxesRestored,
          0
        );
        showToast(
          totalReturned > 0
            ? `Pedido cancelado! ${totalReturned} caixa(s)/unid. devolvida(s) ao estoque${res.asaasCancelled ? ' e cobrança Asaas cancelada' : ''}.`
            : `Pedido cancelado${res.asaasCancelled ? ' e cobrança Asaas cancelada' : ''}.`
        );
      }
      return res;
    },
    [recordLocalCancelledOrder, showToast]
  );

  // Automatic 2-hour reservation expiration watcher for unpaid active orders
  useEffect(() => {
    if (!authUid || effectiveOrders.length === 0) return;

    const checkAndExpireOrders = () => {
      const now = Date.now();
      for (const order of effectiveOrders) {
        const isParticipant =
          order.buyerId === authUid ||
          order.resellerId === authUid ||
          order.factoryIds.includes(authUid);
        if (!isParticipant) continue;

        const orderPayments = effectivePayments.filter((p) => p.orderId === order.id);
        if (!canCancelUnpaidOrder(order, orderPayments)) continue;

        const deadlineMs = getOrderReservationDeadlineMs(order);
        if (!deadlineMs || now < deadlineMs) continue;

        const lastAttempt = expiringOrderAttemptRef.current.get(order.id) ?? 0;
        if (now - lastAttempt < 60_000) continue;

        expiringOrderAttemptRef.current.set(order.id, now);
        void cancelOrderAndReleaseStock(order.id, 'expired_2h')
          .then((res) => {
            expiringOrderAttemptRef.current.set(order.id, Number.MAX_SAFE_INTEGER);
            recordLocalCancelledOrder({
              orderId: order.id,
              orderCode: order.orderCode,
              status: 'cancelled',
              stockRestored: true,
              cancelledAtMs: res.cancelledAtMs || Date.now(),
              cancelReason: res.cancelReason || 'expired_2h',
              asaasChargeStatus: res.asaasChargeStatus,
            });
            if (!res.alreadyCancelled) {
              showToast(
                `Reserva de 2h do pedido ${order.orderCode} expirou — itens devolvidos ao estoque.`
              );
            }
          })
          .catch(() => {
            // Allow retry after 60s cooldown if transient failure occurred
          });
      }
    };

    checkAndExpireOrders();
    const timer = window.setInterval(checkAndExpireOrders, 30_000);
    return () => window.clearInterval(timer);
  }, [authUid, effectiveOrders, effectivePayments, recordLocalCancelledOrder, showToast]);

  const handleConnectFactoryByPhone = useCallback(
    async (rawPhone: string): Promise<{ ok: boolean; message: string }> => {
      if (!profile) return { ok: false, message: 'Sessão inválida.' };
      if (profile.commercialBanned) {
        return {
          ok: false,
          message:
            'Seus modos comerciais estão temporariamente suspensos. Entre em contato com o suporte.',
        };
      }
      const match = await lookupRegisteredUserByPhone(rawPhone);
      if (!match) {
        return {
          ok: false,
          message:
            'Nenhum usuário cadastrado no ChatFi foi encontrado com este número de telefone.',
        };
      }
      if (match.uid === profile.uid) {
        return {
          ok: false,
          message: 'Você não pode conectar sua própria conta como fabricante.',
        };
      }
      if (match.commercialBanned) {
        return {
          ok: false,
          message: `${match.displayName} está com a atuação comercial temporariamente suspensa.`,
        };
      }
      if (match.role !== 'manufacturer') {
        return {
          ok: false,
          message: `${match.displayName} está no ChatFi, mas ainda não ativou o perfil de Fabricante.`,
        };
      }
      const result = await createRealFactoryConnection({
        resellerId: profile.uid,
        resellerName: profile.name,
        resellerStorefrontName: profile.storefrontName || profile.name,
        factory: match,
      });

      if (result === 'already_approved') {
        return {
          ok: true,
          message: `Você já é um revendedor aprovado da fábrica "${match.displayName}".`,
        };
      }

      if (result === 'already_pending') {
        return {
          ok: true,
          message: `Sua solicitação para "${match.displayName}" já foi enviada e aguarda aprovação do fabricante.`,
        };
      }

      const resellerLabel = profile.storefrontName || profile.name;
      void checkPeerReachability(match.uid, authUserRef.current).then((reach) => {
        if (!reach.reachable) return;
        void sendRealChatMessage({
          myUid: profile.uid,
          myName: resellerLabel,
          otherUid: match.uid,
          otherName: match.displayName,
          type: 'text',
          text: `Olá ${match.displayName}! Solicitei autorização para atuar como seu revendedor no ChatFi (${resellerLabel}). Acesse seu Painel do Fabricante > aba "Revendedores" para aceitar ou recusar minha solicitação.`,
        }).catch(() => {});
      });

      return {
        ok: true,
        message:
          result === 're_requested'
            ? `Nova solicitação enviada para "${match.displayName}"! Aguarde o fabricante aceitar você como revendedor.`
            : `Solicitação enviada para "${match.displayName}"! Os produtos só serão liberados na sua vitrine após o fabricante aceitar você como revendedor.`,
      };
    },
    [profile]
  );

  const handleRespondResellerRequest = useCallback(
    async (connection: FactoryConnection, decision: 'approved' | 'rejected') => {
      if (!profile) return;
      await respondToResellerConnection(connection.id, decision);

      const factoryLabel = profile.factoryName || profile.name;
      const resellerLabel =
        connection.resellerStorefrontName || connection.resellerName || 'Revendedor';

      void checkPeerReachability(connection.resellerId, authUserRef.current).then((reach) => {
        if (!reach.reachable) return;
        void sendRealChatMessage({
          myUid: profile.uid,
          myName: factoryLabel,
          otherUid: connection.resellerId,
          otherName: resellerLabel,
          type: 'text',
          text:
            decision === 'approved'
              ? `Parabéns! A fábrica "${factoryLabel}" aceitou sua solicitação de revendedor. Nossos produtos já estão liberados no seu Painel de Revendedor para você configurar suas margens e divulgar na sua vitrine.`
              : `A fábrica "${factoryLabel}" não aprovou (ou revogou) sua autorização como revendedor no momento. Os produtos desta fábrica foram removidos da sua vitrine.`,
        }).catch(() => {});
      });

      showToast(
        decision === 'approved'
          ? `Revendedor "${resellerLabel}" aceito com sucesso!`
          : `Autorização de "${resellerLabel}" recusada/revogada.`
      );
    },
    [profile, showToast]
  );

  // Derived lists & WhatsApp-style unified search
  const zapeiContacts = useMemo(
    () => contacts.filter((c) => c.onZapei && c.matchedUid),
    [contacts]
  );

  const normalizedChatQuery = normalizeSearchText(chatSearch);
  const chatQueryDigits = chatSearch.replace(/\D/g, '');
  const chatQueryIsVirtualLine = isVirtualLineFormat(chatSearch);
  const chatQueryNormalizedPhone = chatQueryIsVirtualLine
    ? chatSearch.trim().toUpperCase()
    : chatQueryDigits.length >= 10 && !/[a-zA-ZÀ-ÿ]/.test(chatSearch.trim())
      ? normalizePhoneDigits(chatSearch)
      : '';

  const [chatPhoneMatch, setChatPhoneMatch] = useState<{
    uid: string;
    name: string;
    initials: string;
    avatarBg: string;
    avatarUrl?: string;
    phone: string;
    role: 'normal' | 'reseller' | 'manufacturer';
    hasStorefront: boolean;
    storefrontName: string;
    deliveryPolicyLabel: string;
  } | null>(null);
  const [chatPhoneLookupBusy, setChatPhoneLookupBusy] = useState(false);

  useEffect(() => {
    if (!chatQueryNormalizedPhone || !profile) {
      setChatPhoneMatch(null);
      setChatPhoneLookupBusy(false);
      return undefined;
    }
    let cancelled = false;
    setChatPhoneLookupBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await lookupRegisteredUserByPhone(
          chatQueryIsVirtualLine ? chatQueryNormalizedPhone : chatSearch
        );
        if (cancelled) return;
        if (found && found.uid !== profile.uid) {
          setChatPhoneMatch({
            uid: found.uid,
            name: found.displayName,
            initials: found.initials,
            avatarBg: found.avatarColor,
            avatarUrl: found.avatarUrl,
            phone: chatQueryIsVirtualLine
              ? chatQueryNormalizedPhone
              : formatPhoneDisplay(chatSearch),
            role: found.role,
            hasStorefront: found.hasStorefront,
            storefrontName: found.storefrontName,
            deliveryPolicyLabel: found.deliveryPolicy.label,
          });
        } else {
          setChatPhoneMatch(null);
        }
      } catch {
        if (!cancelled) setChatPhoneMatch(null);
      } finally {
        if (!cancelled) setChatPhoneLookupBusy(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chatQueryNormalizedPhone, chatSearch, profile]);

  // Outbox packets belonging to the signed-in user
  const myOutboxPackets = useMemo(() => {
    if (!profile) return [];
    return outboxPackets.filter((p) => p.senderId === profile.uid);
  }, [outboxPackets, profile]);

  const pendingOutboxByChatId = useMemo(() => {
    const map = new Map<string, ZapeiMessagePacket[]>();
    for (const pkt of myOutboxPackets) {
      const list = map.get(pkt.chatId) || [];
      list.push(pkt);
      map.set(pkt.chatId, list);
    }
    return map;
  }, [myOutboxPackets]);

  // Merge Firestore cached/live chats with local device chats (e.g. stealth-blocked sent msgs)
  // and locally queued offline messages, applying cleared/hidden/blocked conversation rules.
  const mergedChats = useMemo(() => {
    const map = new Map<string, ChatThreadSummary>();
    for (const c of chats) {
      map.set(c.id, c);
    }
    for (const lt of localThreads) {
      const existing = map.get(lt.id);
      if (!existing || lt.updatedAtMs > existing.updatedAtMs) {
        map.set(lt.id, lt);
      }
    }
    if (profile && myOutboxPackets.length > 0) {
      for (const pkt of myOutboxPackets) {
        if (deletedForMeIds.has(pkt.id)) continue;
        const existing = map.get(pkt.chatId);
        if (existing) {
          if (pkt.timestamp >= existing.updatedAtMs) {
            map.set(pkt.chatId, {
              ...existing,
              lastMessage: pkt.text,
              lastSenderId: pkt.senderId,
              updatedAtLabel: formatPacketTimeLabel(pkt.timestamp),
              updatedAtMs: pkt.timestamp,
            });
          }
        } else {
          const [userA, userB] = [pkt.senderId, pkt.recipientId].sort();
          const userAName = userA === pkt.senderId ? pkt.senderName : pkt.recipientName;
          const userBName = userB === pkt.senderId ? pkt.senderName : pkt.recipientName;
          map.set(pkt.chatId, {
            id: pkt.chatId,
            userA,
            userB,
            userAName,
            userBName,
            otherUid: pkt.recipientId,
            otherName: pkt.recipientName,
            lastMessage: pkt.text,
            lastSenderId: pkt.senderId,
            updatedAtLabel: formatPacketTimeLabel(pkt.timestamp),
            updatedAtMs: pkt.timestamp,
          });
        }
      }
    }

    const pinnedSet = new Set(chatPrefs.pinnedChatIds);
    const blockedSet = new Set(chatPrefs.blockedUids);
    return Array.from(map.values())
      .filter((c) => {
        const hiddenAt = chatPrefs.hiddenChatIds[c.id];
        if (hiddenAt && c.updatedAtMs <= hiddenAt) return false;
        return true;
      })
      .map((c) => {
        if (blockedSet.has(c.otherUid) && c.lastSenderId === c.otherUid) {
          const blockedAt = chatPrefs.blockedAtByUid?.[c.otherUid] || 0;
          if (c.updatedAtMs >= blockedAt) {
            return {
              ...c,
              lastMessage: 'Contato bloqueado',
              updatedAtMs: blockedAt > 0 ? Math.min(c.updatedAtMs, blockedAt) : c.updatedAtMs,
            };
          }
        }
        const clearedAt = chatPrefs.clearedAtByChatId[c.id];
        if (clearedAt && c.updatedAtMs <= clearedAt) {
          return { ...c, lastMessage: 'Conversa limpa' };
        }
        return c;
      })
      .sort((a, b) => {
        const aPinned = pinnedSet.has(a.id) ? 1 : 0;
        const bPinned = pinnedSet.has(b.id) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return b.updatedAtMs - a.updatedAtMs;
      });
  }, [
    chats,
    localThreads,
    myOutboxPackets,
    profile,
    deletedForMeIds,
    chatPrefs.pinnedChatIds,
    chatPrefs.hiddenChatIds,
    chatPrefs.clearedAtByChatId,
    chatPrefs.blockedUids,
    chatPrefs.blockedAtByUid,
  ]);

  // Merge Firestore active chat messages with local IndexedDB messages + pending offline outbox,
  // applying "Limpar conversa" cutoffs, blocked sender cutoffs, "Apagar para mim" and "Apagar para todos".
  const mergedActiveMessages = useMemo(() => {
    if (!profile || !selectedPeer) return [];
    const activeChatId = getDeterministicChatId(profile.uid, selectedPeer.uid);
    const pendingForChat = pendingOutboxByChatId.get(activeChatId);
    const clearedCutoff = chatPrefs.clearedAtByChatId[activeChatId] || 0;
    const blockedSet = new Set(chatPrefs.blockedUids);

    const byId = new Map<string, ChatMessage>();
    for (const m of localActiveMessages) {
      byId.set(m.id, m);
    }
    for (const m of activeMessages) {
      // Firestore message overrides optimistic local copy if present
      byId.set(m.id, m);
    }
    if (pendingForChat && pendingForChat.length > 0) {
      for (const pkt of pendingForChat) {
        if (!byId.has(pkt.id)) {
          byId.set(pkt.id, packetToChatMessage(pkt));
        }
      }
    }

    return Array.from(byId.values())
      .filter((m) => {
        if (deletedForMeIds.has(m.id)) return false;
        if (clearedCutoff > 0 && (m.createdAtMs || 0) <= clearedCutoff) return false;
        if (blockedSet.has(m.senderId)) {
          const blockedAt = chatPrefs.blockedAtByUid?.[m.senderId] || 0;
          if ((m.createdAtMs || 0) >= blockedAt) return false;
        }
        return true;
      })
      .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0) || a.id.localeCompare(b.id))
      .map((m) => {
        const srvDeletedAt = deletedForAllMap.get(`${activeChatId}__${m.id}`);
        if (!m.deletedForAll && srvDeletedAt === undefined) return m;
        return {
          ...m,
          deletedForAll: true,
          deletedAtMs: m.deletedAtMs || srvDeletedAt,
          text: 'Mensagem apagada',
          mediaUrl: undefined,
          mediaTransitPath: undefined,
          audioDuration: undefined,
          videoDuration: undefined,
        };
      });
  }, [
    activeMessages,
    localActiveMessages,
    pendingOutboxByChatId,
    profile,
    selectedPeer,
    deletedForMeIds,
    deletedForAllMap,
    chatPrefs.clearedAtByChatId,
    chatPrefs.blockedUids,
    chatPrefs.blockedAtByUid,
  ]);

  const archivedCount = useMemo(
    () =>
      mergedChats.filter(
        (c) =>
          chatPrefs.archivedChatIds.includes(c.id) &&
          !chatPrefs.lockedChatIds.includes(c.id)
      ).length,
    [mergedChats, chatPrefs.archivedChatIds, chatPrefs.lockedChatIds]
  );

  const lockedCount = useMemo(
    () => mergedChats.filter((c) => chatPrefs.lockedChatIds.includes(c.id)).length,
    [mergedChats, chatPrefs.lockedChatIds]
  );

  const unreadBadgeCount = useMemo(
    () =>
      mergedChats.filter(
        (c) =>
          chatPrefs.unreadChatIds.includes(c.id) &&
          !chatPrefs.archivedChatIds.includes(c.id) &&
          !chatPrefs.lockedChatIds.includes(c.id)
      ).length,
    [mergedChats, chatPrefs.unreadChatIds, chatPrefs.archivedChatIds, chatPrefs.lockedChatIds]
  );

  const shortcutThreads = useMemo(
    () =>
      mergedChats.filter((c) => chatPrefs.shortcutChatIds.includes(c.id)).slice(0, 12),
    [mergedChats, chatPrefs.shortcutChatIds]
  );

  const filteredChats = useMemo(() => {
    const archivedSet = new Set(chatPrefs.archivedChatIds);
    const lockedSet = new Set(chatPrefs.lockedChatIds);
    const unreadSet = new Set(chatPrefs.unreadChatIds);
    const favSet = new Set(chatPrefs.favoriteChatIds);
    const blockedSet = new Set(chatPrefs.blockedUids);

    return mergedChats.filter((c) => {
      const isLocked = lockedSet.has(c.id);
      const isArchived = archivedSet.has(c.id);

      if (normalizedChatQuery) {
        if (isLocked && !lockedFolderUnlocked) return false;
        const matchedContact = contacts.find((ct) => ct.matchedUid === c.otherUid);
        const dir = directoryByUid.get(c.otherUid);
        const displayName = matchedContact?.name || dir?.displayName || c.otherName;
        return (
          normalizeSearchText(displayName).includes(normalizedChatQuery) ||
          normalizeSearchText(c.otherName).includes(normalizedChatQuery) ||
          normalizeSearchText(c.lastMessage).includes(normalizedChatQuery) ||
          (matchedContact?.phone.toLowerCase().includes(normalizedChatQuery) ?? false) ||
          (dir?.virtualLine
            ? normalizeSearchText(dir.virtualLine).includes(normalizedChatQuery)
            : false)
        );
      }

      if (chatListFilter === 'locked') {
        return lockedFolderUnlocked && isLocked;
      }
      if (isLocked) return false;
      if (chatListFilter === 'archived') {
        return isArchived;
      }
      if (isArchived) return false;

      if (chatListFilter === 'unread') {
        return unreadSet.has(c.id);
      }
      if (chatListFilter === 'favorites') {
        return favSet.has(c.id);
      }
      if (chatListFilter === 'blocked') {
        return blockedSet.has(c.otherUid);
      }
      if (chatListFilter.startsWith('list:')) {
        const listId = chatListFilter.slice(5);
        const targetList = chatPrefs.customLists.find((l) => l.id === listId);
        return targetList ? targetList.chatIds.includes(c.id) : false;
      }
      return true;
    });
  }, [
    mergedChats,
    contacts,
    directoryByUid,
    normalizedChatQuery,
    chatListFilter,
    lockedFolderUnlocked,
    chatPrefs.archivedChatIds,
    chatPrefs.lockedChatIds,
    chatPrefs.unreadChatIds,
    chatPrefs.favoriteChatIds,
    chatPrefs.blockedUids,
    chatPrefs.customLists,
  ]);

  // WhatsApp-style contacts matching search (saved contacts + exact Phone/CFI lookup only — zero global strangers)
  const matchingZapeiPeople = useMemo(() => {
    const shownChatUids = new Set(filteredChats.map((c) => c.otherUid));
    const seen = new Set<string>();
    const results: Array<{
      uid: string;
      name: string;
      initials: string;
      avatarBg: string;
      avatarUrl?: string;
      phone?: string;
      subtitle: string;
      role: 'normal' | 'reseller' | 'manufacturer';
      hasStorefront: boolean;
      storefrontName?: string;
      deliveryPolicyLabel?: string;
    }> = [];

    // 1. Saved contacts who are on ChatFi
    for (const c of zapeiContacts) {
      if (!c.matchedUid || c.matchedUid === profile?.uid) continue;
      if (shownChatUids.has(c.matchedUid) || seen.has(c.matchedUid)) continue;
      const dir = directoryByUid.get(c.matchedUid);
      const matches =
        !normalizedChatQuery ||
        normalizeSearchText(c.name).includes(normalizedChatQuery) ||
        c.phone.toLowerCase().includes(normalizedChatQuery) ||
        normalizeSearchText(c.storefrontName || '').includes(normalizedChatQuery) ||
        (dir ? normalizeSearchText(dir.displayName).includes(normalizedChatQuery) : false) ||
        (dir?.virtualLine
          ? normalizeSearchText(dir.virtualLine).includes(normalizedChatQuery)
          : false);
      if (!matches) continue;
      seen.add(c.matchedUid);
      const contactPresence = getContactPresenceDisplay(dir, {
        fallback: c.hasStorefront && c.storefrontName ? c.storefrontName : DEFAULT_STATUS_MESSAGE,
      });
      results.push({
        uid: c.matchedUid,
        name: c.name,
        initials: c.initials,
        avatarBg: c.avatarBg || dir?.avatarColor || '#0E7A34',
        avatarUrl: dir?.avatarUrl,
        phone: c.phone,
        subtitle: c.hasStorefront && c.storefrontName
          ? contactPresence.isOnline
            ? `online · ${c.storefrontName}`
            : c.storefrontName
          : contactPresence.label,
        role: c.role,
        hasStorefront: c.hasStorefront,
        storefrontName: c.storefrontName,
        deliveryPolicyLabel: c.deliveryPolicyLabel,
      });
    }

    // 2. Direct exact phone / virtual line (CFI-XXXX-XXXX) match if user typed a number in Conversas
    if (
      chatPhoneMatch &&
      !shownChatUids.has(chatPhoneMatch.uid) &&
      !seen.has(chatPhoneMatch.uid)
    ) {
      results.unshift({
        uid: chatPhoneMatch.uid,
        name: chatPhoneMatch.name,
        initials: chatPhoneMatch.initials,
        avatarBg: chatPhoneMatch.avatarBg,
        avatarUrl: chatPhoneMatch.avatarUrl,
        phone: chatPhoneMatch.phone,
        subtitle: chatPhoneMatch.hasStorefront && chatPhoneMatch.storefrontName
          ? chatPhoneMatch.storefrontName
          : chatPhoneMatch.phone,
        role: chatPhoneMatch.role,
        hasStorefront: chatPhoneMatch.hasStorefront,
        storefrontName: chatPhoneMatch.storefrontName,
        deliveryPolicyLabel: chatPhoneMatch.deliveryPolicyLabel,
      });
    }

    return results;
  }, [
    filteredChats,
    zapeiContacts,
    directoryByUid,
    normalizedChatQuery,
    profile?.uid,
    chatPhoneMatch,
  ]);

  const forwardTargets = useMemo<ForwardTarget[]>(() => {
    const seen = new Set<string>();
    const list: ForwardTarget[] = [];
    for (const c of mergedChats) {
      if (!c.otherUid || c.otherUid === profile?.uid || seen.has(c.otherUid)) continue;
      seen.add(c.otherUid);
      const matchedContact = contacts.find((ct) => ct.matchedUid === c.otherUid);
      const dir = directoryByUid.get(c.otherUid);
      const displayName = matchedContact?.name || dir?.displayName || c.otherName;
      list.push({
        uid: c.otherUid,
        name: displayName,
        initials: getInitials(displayName),
        avatarBg: matchedContact?.avatarBg || dir?.avatarColor || '#0E7A34',
        avatarUrl: dir?.avatarUrl,
        subtitle: matchedContact?.phone || dir?.statusMessage || 'Conversa ativa',
      });
    }
    for (const c of zapeiContacts) {
      if (!c.matchedUid || c.matchedUid === profile?.uid || seen.has(c.matchedUid)) continue;
      seen.add(c.matchedUid);
      const dir = directoryByUid.get(c.matchedUid);
      list.push({
        uid: c.matchedUid,
        name: c.name,
        initials: c.initials,
        avatarBg: c.avatarBg || dir?.avatarColor || '#0E7A34',
        avatarUrl: dir?.avatarUrl,
        subtitle: c.phone || dir?.statusMessage || 'No ChatFi',
      });
    }
    return list;
  }, [mergedChats, contacts, zapeiContacts, directoryByUid, profile?.uid]);

  const allSubOrders = useMemo(
    () => effectiveOrders.flatMap((o) => o.subOrders),
    [effectiveOrders]
  );

  // --- LOADING & REAL AUTH/PHONE GATE ---

  if (!authReady || (authUser && !profileLoaded)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-4">
        <div className="flex max-w-xs flex-col items-center gap-3.5 text-center text-slate-600">
          <ChatFiLogo className="h-16 w-16 rounded-2xl shadow-md" />
          <Loader2 className="h-6 w-6 animate-spin text-[#0E7A34]" />
          <p className="text-xs font-semibold">Conectando ao ChatFi...</p>
          {bootSlow && (
            <div className="mt-2 flex flex-col items-center gap-2">
              <p className="text-[11px] leading-relaxed text-slate-500">
                A conexão está demorando mais que o normal neste aparelho.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBootSlow(false);
                    if (authUser) {
                      void fetchUserProfileOnce(authUser.uid, authUser.email || '')
                        .then((loaded) => {
                          setProfile(loaded);
                          setProfileLoaded(true);
                        })
                        .catch(() => {
                          setProfileRetryTick((t) => t + 1);
                        });
                    } else {
                      setAuthReady(true);
                      setProfileRetryTick((t) => t + 1);
                    }
                  }}
                  className="rounded-xl bg-[#0E7A34] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0B5D27]"
                >
                  Tentar novamente
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBootSlow(false);
                    setAuthReady(true);
                    setProfileLoaded(true);
                    void signOutFirebase().catch(() => {});
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Voltar ao login
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!authUser || !profile) {
    return (
      <PhoneOnboardingModal
        mode="gate"
        authUser={authUser}
        onSaveProfile={async (name, phone, statusMessage, avatarUrl) => {
          if (!authUser) return;
          const { isNewProfile } = await registerOrUpdateUserProfile({
            uid: authUser.uid,
            email: authUser.email || '',
            displayName: name,
            phone,
            statusMessage,
            avatarUrl,
            primaryDevice: localDeviceInfo,
          });
          if (isNewProfile) {
            checkedDeviceUidRef.current = authUser.uid;
            setActiveAuthRequest(null);
            setDeviceAuthState('authorized');
          }
        }}
      />
    );
  }

  // --- CONNECTED DEVICES GATE (PRIMARY SESSION + NEW DEVICE AUTHORIZATION) ---
  if (deviceAuthState === 'idle' || deviceAuthState === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-3.5 text-slate-600">
          <ChatFiLogo className="h-16 w-16 rounded-2xl shadow-md" />
          <Loader2 className="h-6 w-6 animate-spin text-[#0E7A34]" />
          <p className="text-xs font-semibold">Verificando aparelho conectado...</p>
        </div>
      </div>
    );
  }

  if (deviceAuthState === 'pending_approval' && activeAuthRequest) {
    const gateAuthMethod: 'phone' | 'cpf' = authUser.phoneNumber ? 'phone' : 'cpf';
    const lastSignInMs = authUser.metadata?.lastSignInTime
      ? Date.parse(authUser.metadata.lastSignInTime)
      : 0;
    const recentlyVerifiedAtSignIn =
      Number.isFinite(lastSignInMs) &&
      lastSignInMs > 0 &&
      Date.now() - lastSignInMs <= 10 * 60 * 1000;

    return (
      <DeviceAuthorizationGate
        userName={profile.name}
        userIdentifier={profile.virtualLine || profile.phone}
        authMethod={gateAuthMethod}
        registeredPhone={authUser.phoneNumber || profile.phone}
        recoveryEmail={authUser.email || profile.email}
        recentlyVerifiedAtSignIn={recentlyVerifiedAtSignIn}
        request={activeAuthRequest}
        regenerating={regeneratingAuthReq}
        onRegenerate={async () => {
          setRegeneratingAuthReq(true);
          try {
            const fresh = await createDeviceAuthRequest(authUser.uid, localDeviceInfo);
            setActiveAuthRequest(fresh);
          } finally {
            setRegeneratingAuthReq(false);
          }
        }}
        onSendTakeoverSms={async (containerId) => sendDeviceTakeoverSmsCode(containerId)}
        onConfirmTakeoverSms={async (confirmation, code, containerId) => {
          await confirmDeviceTakeoverSmsCode(confirmation, code, containerId);
        }}
        onVerifyCpfForTakeover={async (cpfRaw, password) => {
          await verifyCpfAccountForDeviceTakeover({
            uid: authUser.uid,
            cpfRaw,
            password,
          });
        }}
        onSendRecoveryEmail={async () => sendRecoveryEmailForSignedInCpfUser()}
        onTakeOverPrimary={async () => {
          await takeOverAsPrimaryDevice(authUser.uid, localDeviceInfo, activeAuthRequest.id);
          try {
            localStorage.setItem(
              `zapei_device_auth_uid_${localDeviceInfo.deviceId}`,
              authUser.uid
            );
          } catch {
            // ignore storage errors
          }
          checkedDeviceUidRef.current = authUser.uid;
          setActiveAuthRequest(null);
          setDeviceAuthState('authorized');
          showToast(
            'Este aparelho agora é o seu Aparelho Principal! Os demais aparelhos foram desconectados.'
          );
        }}
        onSignOut={async () => {
          await signOutFirebase();
        }}
      />
    );
  }

  const hasCommercialPanel = profile.commercialMode !== 'buyer' && !profile.commercialBanned;
  const pendingFactoryResellerCount =
    profile.commercialMode === 'manufacturer' && !profile.commercialBanned
      ? connections.filter(
          (c) => c.factoryId === profile.uid && c.approvalStatus === 'pending'
        ).length
      : 0;

  const navItems: Array<{
    id: MainTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'chats', label: 'Conversas', icon: MessageSquare },
    { id: 'calls', label: 'Ligações', icon: Phone },
    { id: 'contacts', label: 'Contatos', icon: Users },
    ...(hasCommercialPanel
      ? [
          {
            id: 'commercial' as MainTab,
            label: profile.commercialMode === 'manufacturer' ? 'Anúncios' : 'Vitrine',
            icon: profile.commercialMode === 'manufacturer' ? Factory : Briefcase,
            badge: pendingFactoryResellerCount > 0 ? pendingFactoryResellerCount : undefined,
          },
        ]
      : []),
    { id: 'settings', label: 'Ajustes', icon: Settings },
  ];

  const mobileInChat = activeTab === 'chats' && Boolean(selectedPeer);

  return (
    <div className="chatfi-app-bg flex h-[100dvh] w-full max-w-full overflow-hidden text-slate-900">
      {/* Desktop Left Navigation Rail — Deep Emerald Wave */}
      <aside className="chatfi-rail-wave hidden md:flex md:w-20 lg:w-60 shrink-0 flex-col justify-between border-r border-emerald-950/30 text-white shadow-sm">
        <div>
          <div className="border-b border-white/10 p-3">
            <div className="flex w-full items-center justify-center lg:justify-start gap-2.5 rounded-2xl p-2 hover:bg-white/10 transition">
              <button
                type="button"
                onClick={() =>
                  setAvatarPreview({
                    name: profile.name,
                    initials: profile.initials,
                    avatarBg: profile.avatarBg,
                    avatarUrl: profile.avatarUrl,
                    phone: profile.phone,
                    virtualLine: profile.virtualLine,
                    subtitle: profile.statusMessage,
                    ratingAverage: profile.ratingAverage,
                    ratingCount: profile.ratingCount,
                  })
                }
                title="Ampliar foto de perfil"
                aria-label="Ampliar foto de perfil"
                className="shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/40"
              >
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.name}
                    className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white/30"
                  />
                ) : (
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white/25"
                    style={{ backgroundColor: profile.avatarBg || '#0E7A34' }}
                  >
                    {profile.initials}
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className="hidden lg:block min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-bold text-white">{profile.name}</p>
                <p className="truncate font-mono text-[11px] text-emerald-100/75 tabular-nums">
                  {profile.virtualLine || profile.phone}
                </p>
              </button>
            </div>
          </div>

          <nav className="mt-3 space-y-1 px-2.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative flex min-h-[44px] w-full items-center justify-center lg:justify-start gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                    active
                      ? 'bg-[#16A34A] text-white shadow-sm ring-1 ring-white/20'
                      : 'text-emerald-100/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="hidden lg:inline truncate">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute right-2 top-1.5 lg:static lg:ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col lg:flex-row items-center justify-center lg:justify-between gap-3 px-3 lg:px-4 py-4 border-t border-white/10">
          <div className="flex items-center justify-center lg:justify-start gap-3 min-w-0">
            <ChatFiLogo className="h-10 w-10 shrink-0 rounded-xl shadow-sm ring-1 ring-white/15" />
            <div className="hidden lg:block min-w-0">
              <span className="block text-base font-extrabold tracking-tight text-white">
                Chat<span className="text-[#4ADE80]">Fi</span>
              </span>
              <span className="block truncate text-[11px] text-emerald-100/80">
                {profile.commercialMode === 'manufacturer'
                  ? 'Anunciante / Fabricante'
                  : profile.commercialMode === 'reseller'
                    ? 'Revendedor'
                    : 'Conectando pessoas!'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleThemeMode()}
            title={themeMode === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
            aria-label={themeMode === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20 active:scale-95"
          >
            {themeMode === 'dark' ? (
              <Sun className="h-4 w-4 text-amber-300" />
            ) : (
              <Moon className="h-4 w-4 text-emerald-100" />
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Mobile Compact Emerald Wave Header (hidden when inside an active mobile chat thread) */}
        {!mobileInChat && (
          <header className="chatfi-header-wave relative flex md:hidden items-center justify-between gap-2 px-4 pb-5 header-pt-safe text-white shrink-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <ChatFiLogo className="h-9 w-9 shrink-0 rounded-xl shadow-sm ring-1 ring-white/20" />
              <div className="min-w-0 leading-tight">
                <span className="block truncate text-lg font-extrabold tracking-tight text-white">
                  Chat<span className="text-[#4ADE80]">Fi</span>
                </span>
                <span className="block truncate text-[11px] font-medium text-emerald-100/85">
                  Conectando pessoas!
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => toggleThemeMode()}
                title={themeMode === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
                aria-label={themeMode === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20 active:scale-95"
              >
                {themeMode === 'dark' ? (
                  <Sun className="h-4 w-4 text-amber-300" />
                ) : (
                  <Moon className="h-4 w-4 text-emerald-100" />
                )}
              </button>
              <PWAInstallButton compact />
            </div>
          </header>
        )}

        {/* Floating Incoming Message Alert Banner */}
        {incomingMsgBanner && (
          <div className="fixed left-3 right-3 sm:left-auto sm:right-4 top-3 z-50 sm:w-96 pt-safe">
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200/80 bg-white p-3 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  const targetUid = incomingMsgBanner.senderId;
                  setIncomingMsgBanner(null);
                  void processPushWakeAction({ openChatUid: targetUid });
                }}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {incomingMsgBanner.avatarUrl ? (
                  <img
                    src={incomingMsgBanner.avatarUrl}
                    alt={incomingMsgBanner.senderName}
                    className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-[#0E7A34]/20"
                  />
                ) : (
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: incomingMsgBanner.avatarBg || '#0E7A34' }}
                  >
                    {incomingMsgBanner.initials}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-slate-900">
                      {incomingMsgBanner.senderName}
                    </span>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#0E7A34]">
                      Agora
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-600">
                    {incomingMsgBanner.preview}
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIncomingMsgBanner(null)}
                aria-label="Fechar aviso"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed left-3 right-3 sm:left-auto sm:right-4 top-3 z-50 sm:max-w-sm rounded-xl border border-emerald-200 bg-[#0E7A34] px-4 py-2.5 text-xs font-semibold text-white shadow-lg">
            {toastMessage}
          </div>
        )}

        {/* Active Tab Viewport */}
        <main
          className={`relative z-10 flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${
            !mobileInChat
              ? '-mt-3 rounded-t-[24px] bg-[#F2F7F4] shadow-[0_-6px_20px_rgba(3,51,22,0.18)] md:mt-0 md:rounded-none md:bg-transparent md:shadow-none'
              : ''
          }`}
        >
          {activeTab === 'chats' && (
            <div className="flex h-full min-h-0 w-full overflow-hidden">
              {/* Chat List Sidebar */}
              <section
                className={`w-full md:w-80 lg:w-96 shrink-0 flex-col border-r border-emerald-950/10 bg-white/95 backdrop-blur-xs ${
                  selectedPeer ? 'hidden md:flex' : 'flex'
                }`}
              >
                {/* Top Header of Conversas: WhatsApp-style Multi-Selection Bar OR Default Header */}
                {selectedChatIds.size > 0 ? (
                  (() => {
                    const selIds = Array.from(selectedChatIds);
                    const selThreads = mergedChats.filter((c) => selectedChatIds.has(c.id));
                    const singleThread = selThreads.length === 1 ? selThreads[0] : null;
                    const singleMatched = singleThread
                      ? contacts.find((ct) => ct.matchedUid === singleThread.otherUid)
                      : undefined;
                    const singleDir = singleThread
                      ? directoryByUid.get(singleThread.otherUid)
                      : undefined;
                    const singleName = singleThread
                      ? singleMatched?.name || singleDir?.displayName || singleThread.otherName
                      : '';
                    const allPinned = selIds.every((id) => chatPrefs.pinnedChatIds.includes(id));
                    const allMuted = selIds.every((id) => chatPrefs.mutedChatIds.includes(id));
                    const allArchived = selIds.every((id) => chatPrefs.archivedChatIds.includes(id));
                    const allFav = selIds.every((id) => chatPrefs.favoriteChatIds.includes(id));
                    const allLocked = selIds.every((id) => chatPrefs.lockedChatIds.includes(id));
                    const allUnread = selIds.every((id) => chatPrefs.unreadChatIds.includes(id));
                    const selPeerUids = Array.from(new Set(selThreads.map((t) => t.otherUid)));
                    const allBlocked =
                      selPeerUids.length > 0 &&
                      selPeerUids.every((u) => chatPrefs.blockedUids.includes(u));

                    return (
                      <div className="relative border-b border-slate-100 bg-white px-2.5 py-3">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={exitChatSelection}
                              aria-label="Sair da seleção"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
                            >
                              <ArrowLeft className="h-5 w-5" />
                            </button>
                            <span className="text-base font-extrabold text-slate-900 tabular-nums">
                              {selectedChatIds.size}
                            </span>
                          </div>

                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                toggleIdsInPrefList('pinnedChatIds', selIds, {
                                  added:
                                    selIds.length === 1
                                      ? 'Conversa fixada no topo.'
                                      : `${selIds.length} conversas fixadas.`,
                                  removed: 'Conversa desafixada.',
                                })
                              }
                              title={allPinned ? 'Desafixar conversa' : 'Fixar conversa'}
                              aria-label={allPinned ? 'Desafixar conversa' : 'Fixar conversa'}
                              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
                            >
                              {allPinned ? (
                                <PinOff className="h-4.5 w-4.5 text-[#0E7A34]" />
                              ) : (
                                <Pin className="h-4.5 w-4.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setShowChatListMenu(false);
                                setChatConfirmModal({
                                  kind: 'delete_chat',
                                  chatIds: selIds,
                                  peerUids: selPeerUids,
                                  targetName: singleName,
                                });
                              }}
                              title="Apagar conversa"
                              aria-label="Apagar conversa"
                              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4.5 w-4.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                toggleIdsInPrefList('mutedChatIds', selIds, {
                                  added: 'Notificações silenciadas.',
                                  removed: 'Notificações reativadas.',
                                })
                              }
                              title={allMuted ? 'Reativar notificações' : 'Silenciar'}
                              aria-label={allMuted ? 'Reativar notificações' : 'Silenciar'}
                              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
                            >
                              {allMuted ? (
                                <Bell className="h-4.5 w-4.5 text-[#0E7A34]" />
                              ) : (
                                <BellOff className="h-4.5 w-4.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                toggleIdsInPrefList('archivedChatIds', selIds, {
                                  added:
                                    selIds.length === 1
                                      ? 'Conversa arquivada.'
                                      : `${selIds.length} conversas arquivadas.`,
                                  removed: 'Conversa desarquivada.',
                                })
                              }
                              title={allArchived ? 'Desarquivar conversa' : 'Arquivar conversa'}
                              aria-label={allArchived ? 'Desarquivar conversa' : 'Arquivar conversa'}
                              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
                            >
                              {allArchived ? (
                                <ArchiveRestore className="h-4.5 w-4.5 text-[#0E7A34]" />
                              ) : (
                                <Archive className="h-4.5 w-4.5" />
                              )}
                            </button>

                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setShowChatListMenu((v) => !v)}
                                title="Mais opções"
                                aria-label="Mais opções da seleção"
                                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
                              >
                                <MoreVertical className="h-4.5 w-4.5" />
                              </button>

                              {showChatListMenu && (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setShowChatListMenu(false)}
                                  />
                                  <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-2xl">
                                    {singleThread && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setShowChatListMenu(false);
                                          setShortcutModalTarget({
                                            chatId: singleThread.id,
                                            peerUid: singleThread.otherUid,
                                            peerName: singleName,
                                          });
                                        }}
                                        className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                                      >
                                        <Link2 className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                                        <span>Adicionar atalho para conversa</span>
                                      </button>
                                    )}

                                    {singleThread && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setShowChatListMenu(false);
                                          openContactDetailsForUid(
                                            singleThread.otherUid,
                                            singleName
                                          );
                                        }}
                                        className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                                      >
                                        <UserIcon className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                                        <span>Mostrar contato</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleIdsInPrefList('unreadChatIds', selIds, {
                                          added: 'Marcada como não lida.',
                                          removed: 'Marcada como lida.',
                                        })
                                      }
                                      className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                                    >
                                      <MessageSquare className="h-4 w-4 shrink-0 text-slate-500" />
                                      <span>
                                        {allUnread ? 'Marcar como lida' : 'Marcar como não lido'}
                                      </span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowChatListMenu(false);
                                        setSelectedChatIds(
                                          new Set(filteredChats.map((c) => c.id))
                                        );
                                      }}
                                      className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                                    >
                                      <CheckSquare className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                                      <span>Selecionar tudo</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleRequestToggleLockChats(
                                          selIds,
                                          singleName || `${selIds.length} conversas`
                                        )
                                      }
                                      className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                                    >
                                      {allLocked ? (
                                        <LockOpen className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                                      ) : (
                                        <Lock className="h-4 w-4 shrink-0 text-slate-500" />
                                      )}
                                      <span>
                                        {allLocked ? 'Destrancar conversa' : 'Trancar conversa'}
                                      </span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleIdsInPrefList('favoriteChatIds', selIds, {
                                          added: 'Adicionada aos favoritos.',
                                          removed: 'Removida dos favoritos.',
                                        })
                                      }
                                      className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                                    >
                                      <Star
                                        className={`h-4 w-4 shrink-0 ${
                                          allFav
                                            ? 'fill-amber-400 text-amber-500'
                                            : 'text-slate-500'
                                        }`}
                                      />
                                      <span>
                                        {allFav
                                          ? 'Remover dos favoritos'
                                          : 'Adicionar aos favoritos'}
                                      </span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowChatListMenu(false);
                                        setAddToListTarget({
                                          chatIds: selIds,
                                          title:
                                            singleName ||
                                            `${selIds.length} conversas selecionadas`,
                                        });
                                      }}
                                      className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                                    >
                                      <ListPlus className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                                      <span>Adicionar à lista</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowChatListMenu(false);
                                        setChatConfirmModal({
                                          kind: 'clear',
                                          chatIds: selIds,
                                          peerUids: selPeerUids,
                                          targetName: singleName,
                                        });
                                      }}
                                      className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
                                    >
                                      <Eraser className="h-4 w-4 shrink-0 text-slate-500" />
                                      <span>Limpar conversa</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowChatListMenu(false);
                                        setChatConfirmModal({
                                          kind: allBlocked ? 'unblock' : 'block',
                                          chatIds: selIds,
                                          peerUids: selPeerUids,
                                          targetName: singleName,
                                        });
                                      }}
                                      className={`flex min-h-[44px] w-full items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-left text-sm font-bold hover:bg-red-50 ${
                                        allBlocked ? 'text-[#0E7A34]' : 'text-red-600'
                                      }`}
                                    >
                                      <Ban className="h-4 w-4 shrink-0" />
                                      <span>{allBlocked ? 'Desbloquear' : 'Bloquear'}</span>
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="border-b border-slate-100 px-4 pt-4 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      {chatListFilter === 'archived' || chatListFilter === 'locked' ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setChatListFilter('all')}
                            aria-label="Voltar para todas as conversas"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
                          >
                            <ArrowLeft className="h-5 w-5" />
                          </button>
                          <h1 className="truncate text-lg font-extrabold tracking-tight text-slate-900">
                            {chatListFilter === 'archived'
                              ? 'Arquivadas'
                              : 'Conversas trancadas'}
                          </h1>
                        </div>
                      ) : (
                        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">
                          Conversas
                        </h1>
                      )}
                      <div className="flex shrink-0 items-center gap-1.5">
                        {chatListFilter === 'locked' && (
                          <button
                            type="button"
                            onClick={() => {
                              setLockedFolderUnlocked(false);
                              setChatListFilter('all');
                              showToast('Pasta de conversas trancadas bloqueada.');
                            }}
                            title="Trancar pasta novamente"
                            className="flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                          >
                            <Lock className="h-3.5 w-3.5" />
                            <span>Trancar</span>
                          </button>
                        )}
                        {filteredChats.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectedChatIds(new Set([filteredChats[0].id]))}
                            title="Selecionar conversas"
                            aria-label="Selecionar conversas"
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-emerald-50 hover:text-[#0E7A34]"
                          >
                            <CheckSquare className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveTab('contacts')}
                          className="rounded-full bg-gradient-to-r from-[#16A34A] to-[#0E7A34] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm shadow-emerald-900/15 transition hover:brightness-105 active:scale-95"
                        >
                          + Nova conversa
                        </button>
                      </div>
                    </div>

                    <div className="relative mt-3">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        inputMode="search"
                        name="chatfi_chat_search"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={chatSearch}
                        onChange={(e) => setChatSearch(e.target.value)}
                        placeholder="Buscar conversa, contato, telefone ou CFI..."
                        className="h-10 w-full rounded-full border border-slate-200/90 bg-[#F4F8F5] pl-10 pr-9 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#0E7A34] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/15"
                      />
                      {chatPhoneLookupBusy ? (
                        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#0E7A34]" />
                      ) : chatSearch ? (
                        <button
                          type="button"
                          onClick={() => setChatSearch('')}
                          aria-label="Limpar busca"
                          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>

                    {/* Interactive Conversation Filter Tabs (Todas, Não lidas, Favoritos, Listas...) */}
                    {chatListFilter !== 'archived' && chatListFilter !== 'locked' && (
                      <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                        <button
                          type="button"
                          onClick={() => setChatListFilter('all')}
                          className={`whitespace-nowrap shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                            chatListFilter === 'all'
                              ? 'bg-emerald-50 text-[#0E7A34] ring-1 ring-[#0E7A34]/30'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                          }`}
                        >
                          Todas
                        </button>
                        <button
                          type="button"
                          onClick={() => setChatListFilter('unread')}
                          className={`whitespace-nowrap shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                            chatListFilter === 'unread'
                              ? 'bg-emerald-50 text-[#0E7A34] ring-1 ring-[#0E7A34]/30'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                          }`}
                        >
                          Não lidas{unreadBadgeCount > 0 ? ` ${unreadBadgeCount}` : ''}
                        </button>
                        <button
                          type="button"
                          onClick={() => setChatListFilter('favorites')}
                          className={`whitespace-nowrap shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                            chatListFilter === 'favorites'
                              ? 'bg-emerald-50 text-[#0E7A34] ring-1 ring-[#0E7A34]/30'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                          }`}
                        >
                          Favoritos
                        </button>
                        {chatPrefs.customLists.map((lst) => {
                          const key = `list:${lst.id}`;
                          return (
                            <button
                              key={lst.id}
                              type="button"
                              onClick={() => setChatListFilter(key)}
                              className={`whitespace-nowrap shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                                chatListFilter === key
                                  ? 'bg-emerald-50 text-[#0E7A34] ring-1 ring-[#0E7A34]/30'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                              }`}
                            >
                              {lst.name}
                            </button>
                          );
                        })}
                        {chatPrefs.blockedUids.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setChatListFilter('blocked')}
                            className={`whitespace-nowrap shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                              chatListFilter === 'blocked'
                                ? 'bg-red-50 text-red-600 ring-1 ring-red-300'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                            }`}
                          >
                            Bloqueados ({chatPrefs.blockedUids.length})
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto pb-safe-nav md:pb-2">
                  {/* Discreet Offline Mode & Sync Banner at top of Conversas */}
                  {(!isOnline || myOutboxPackets.length > 0) && (
                    <div
                      className={`mx-3 mt-2.5 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                        !isOnline
                          ? 'border-amber-200 bg-amber-50/90 text-amber-900'
                          : 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {!isOnline ? (
                          <WifiOff className="h-4 w-4 shrink-0 text-amber-600" />
                        ) : (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0E7A34]" />
                        )}
                        <p className="text-[11px] font-medium leading-snug">
                          {!isOnline
                            ? 'Sem conexão — Suas mensagens serão enviadas assim que o sinal voltar'
                            : `Sincronizando ${myOutboxPackets.length} mensagem(ns) da fila...`}
                        </p>
                      </div>
                      {!isOnline && myOutboxPackets.length > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                          <Clock className="h-3 w-3" />
                          {myOutboxPackets.length}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Quick-Access Shortcuts Strip */}
                  {!normalizedChatQuery &&
                    chatListFilter === 'all' &&
                    shortcutThreads.length > 0 && (
                      <div className="border-b border-slate-100 px-3 py-2">
                        <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Atalhos rápidos
                        </p>
                        <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                          {shortcutThreads.map((st) => {
                            const matched = contacts.find((c) => c.matchedUid === st.otherUid);
                            const dir = directoryByUid.get(st.otherUid);
                            const name = matched?.name || dir?.displayName || st.otherName;
                            const firstName = name.split(' ')[0] || name;
                            const avatarBg = matched?.avatarBg || dir?.avatarColor || '#0E7A34';
                            return (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() =>
                                  void openChatWithPeer({
                                    uid: st.otherUid,
                                    name,
                                    initials: getInitials(name),
                                    avatarBg,
                                    avatarUrl: dir?.avatarUrl,
                                    phone: matched?.phone,
                                    role: matched?.role || dir?.role || 'normal',
                                    hasStorefront: Boolean(
                                      matched?.hasStorefront || dir?.hasStorefront
                                    ),
                                    storefrontName:
                                      matched?.storefrontName || dir?.storefrontName,
                                    deliveryPolicyLabel:
                                      matched?.deliveryPolicyLabel || dir?.deliveryPolicyLabel,
                                  })
                                }
                                className="flex w-14 shrink-0 flex-col items-center gap-1 text-center"
                              >
                                {dir?.avatarUrl ? (
                                  <img
                                    src={dir.avatarUrl}
                                    alt={name}
                                    className="h-11 w-11 rounded-full object-cover ring-2 ring-[#0E7A34]/30"
                                  />
                                ) : (
                                  <div
                                    className="flex h-11 w-11 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-[#0E7A34]/25"
                                    style={{ backgroundColor: avatarBg }}
                                  >
                                    {getInitials(name)}
                                  </div>
                                )}
                                <span className="w-full truncate text-[11px] font-semibold text-slate-700">
                                  {firstName}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* Locked & Archived Folders at top of Conversas (WhatsApp Style) */}
                  {!normalizedChatQuery &&
                    chatListFilter === 'all' &&
                    (lockedCount > 0 || archivedCount > 0) && (
                      <div className="divide-y divide-slate-100 border-b border-slate-100">
                        {lockedCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (lockedFolderUnlocked || !chatPrefs.lockPinHash) {
                                setLockedFolderUnlocked(true);
                                setChatListFilter('locked');
                              } else {
                                setLockPinModal({
                                  mode: 'verify_unlock',
                                  chatIds: chatPrefs.lockedChatIds,
                                  onAfterUnlock: () => {
                                    setLockedFolderUnlocked(true);
                                    setChatListFilter('locked');
                                  },
                                });
                              }
                            }}
                            className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-[#F3F8F5]"
                          >
                            <span className="flex items-center gap-3 text-sm font-bold text-slate-800">
                              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-[#0E7A34]">
                                <Lock className="h-4 w-4" />
                              </span>
                              <span>Conversas trancadas</span>
                            </span>
                            <span className="text-xs font-bold text-[#0E7A34] tabular-nums">
                              {lockedCount}
                            </span>
                          </button>
                        )}
                        {archivedCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setChatListFilter('archived')}
                            className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-[#F3F8F5]"
                          >
                            <span className="flex items-center gap-3 text-sm font-bold text-slate-800">
                              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                                <Archive className="h-4 w-4" />
                              </span>
                              <span>Arquivadas</span>
                            </span>
                            <span className="text-xs font-bold text-slate-500 tabular-nums">
                              {archivedCount}
                            </span>
                          </button>
                        )}
                      </div>
                    )}

                  {/* Matching / Existing Conversations */}
                  {filteredChats.length > 0 && (
                    <div className="divide-y divide-slate-100">
                      {normalizedChatQuery && (
                        <div className="bg-slate-50/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Conversas ({filteredChats.length})
                        </div>
                      )}
                      {filteredChats.map((thread) => {
                        const matchedContact = contacts.find(
                          (c) => c.matchedUid === thread.otherUid
                        );
                        const dir = directoryByUid.get(thread.otherUid);
                        const displayName =
                          matchedContact?.name || dir?.displayName || thread.otherName;
                        const photoUrl = dir?.avatarUrl;
                        const avatarBg =
                          matchedContact?.avatarBg || dir?.avatarColor || '#0E7A34';
                        const isOpenSelected = selectedPeer?.uid === thread.otherUid;
                        const isRowChecked = selectedChatIds.has(thread.id);
                        const isChatSelectionActive = selectedChatIds.size > 0;
                        const isPinned = chatPrefs.pinnedChatIds.includes(thread.id);
                        const isMuted = chatPrefs.mutedChatIds.includes(thread.id);
                        const isFav = chatPrefs.favoriteChatIds.includes(thread.id);
                        const isUnread = chatPrefs.unreadChatIds.includes(thread.id);
                        const isBlocked = chatPrefs.blockedUids.includes(thread.otherUid);
                        const rowActivity =
                          !isBlocked && !hiddenPresenceUids.has(thread.otherUid)
                            ? peerActivityMap.get(thread.otherUid)?.activity ?? null
                            : null;
                        const rawLastText = thread.lastMessage || 'Conversa iniciada';
                        const lastText = rawLastText.startsWith('» ') && rawLastText.includes('\n')
                          ? rawLastText.slice(rawLastText.indexOf('\n') + 1).trim() || rawLastText
                          : rawLastText;
                        const isVoicePreview = /^(mensagem de voz|áudio|audio)\b/i.test(lastText.trim());
                        const isPdfPreview = /\.pdf\b|^pdf\b/i.test(lastText.trim());

                        const openRowPeer = () => {
                          void openChatWithPeer({
                            uid: thread.otherUid,
                            name: displayName,
                            initials: getInitials(displayName),
                            avatarBg,
                            avatarUrl: photoUrl,
                            phone: matchedContact?.phone,
                            role: matchedContact?.role || dir?.role || 'normal',
                            hasStorefront: Boolean(
                              matchedContact?.hasStorefront || dir?.hasStorefront
                            ),
                            storefrontName:
                              matchedContact?.storefrontName || dir?.storefrontName,
                            deliveryPolicyLabel:
                              matchedContact?.deliveryPolicyLabel ||
                              dir?.deliveryPolicyLabel,
                          });
                        };

                        return (
                          <div
                            key={thread.id}
                            onTouchStart={() => {
                              chatRowSuppressClickRef.current = false;
                              if (chatRowLongPressTimerRef.current !== null) {
                                window.clearTimeout(chatRowLongPressTimerRef.current);
                              }
                              chatRowLongPressTimerRef.current = window.setTimeout(() => {
                                chatRowSuppressClickRef.current = true;
                                toggleChatSelection(thread.id);
                              }, 440);
                            }}
                            onTouchMove={() => {
                              if (chatRowLongPressTimerRef.current !== null) {
                                window.clearTimeout(chatRowLongPressTimerRef.current);
                                chatRowLongPressTimerRef.current = null;
                              }
                            }}
                            onTouchEnd={() => {
                              if (chatRowLongPressTimerRef.current !== null) {
                                window.clearTimeout(chatRowLongPressTimerRef.current);
                                chatRowLongPressTimerRef.current = null;
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              toggleChatSelection(thread.id);
                            }}
                            className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                              isRowChecked
                                ? 'bg-emerald-50/95 ring-1 ring-inset ring-[#0E7A34]/20'
                                : isOpenSelected
                                  ? 'bg-emerald-50/90'
                                  : 'hover:bg-[#F3F8F5]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (isChatSelectionActive) {
                                  toggleChatSelection(thread.id);
                                  return;
                                }
                                setAvatarPreview({
                                  name: displayName,
                                  initials: getInitials(displayName),
                                  avatarBg,
                                  avatarUrl: photoUrl,
                                  phone: matchedContact?.phone || dir?.virtualLine,
                                  virtualLine: dir?.virtualLine,
                                  subtitle:
                                    matchedContact?.storefrontName || dir?.storefrontName,
                                });
                              }}
                              title={
                                isChatSelectionActive
                                  ? 'Marcar ou desmarcar conversa'
                                  : `Ver foto de ${displayName}`
                              }
                              aria-label={
                                isChatSelectionActive
                                  ? `Selecionar ${displayName}`
                                  : `Ampliar foto de ${displayName}`
                              }
                              className="relative shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/40"
                            >
                              {photoUrl ? (
                                <img
                                  src={photoUrl}
                                  alt={displayName}
                                  className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                                />
                              ) : (
                                <div
                                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-xs"
                                  style={{ backgroundColor: avatarBg }}
                                >
                                  {getInitials(displayName)}
                                </div>
                              )}
                              {isRowChecked ? (
                                <span
                                  className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#16A34A] text-white ring-2 ring-white"
                                  aria-label="Selecionada"
                                >
                                  <Check className="h-3 w-3 stroke-[3]" />
                                </span>
                              ) : (
                                isUserEffectivelyOnline(dir) && (
                                  <span
                                    className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-[#16A34A] ring-2 ring-white"
                                    aria-label="Online"
                                  />
                                )
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (chatRowSuppressClickRef.current) {
                                  chatRowSuppressClickRef.current = false;
                                  return;
                                }
                                if (isChatSelectionActive) {
                                  toggleChatSelection(thread.id);
                                  return;
                                }
                                openRowPeer();
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-sm font-bold text-slate-900">
                                    {displayName}
                                  </span>
                                  {isFav && (
                                    <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />
                                  )}
                                  {isBlocked && (
                                    <Ban className="h-3 w-3 shrink-0 text-red-500" />
                                  )}
                                </span>
                                <span
                                  className={`shrink-0 font-mono text-[11px] tabular-nums ${
                                    isUnread ? 'font-bold text-[#0E7A34]' : 'text-slate-400'
                                  }`}
                                >
                                  {thread.updatedAtLabel}
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center justify-between gap-2">
                                {rowActivity === 'recording_audio' ? (
                                  <p className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-[#0E7A34]">
                                    <Mic className="h-3.5 w-3.5 shrink-0 animate-pulse" />
                                    <span className="truncate">Gravando áudio...</span>
                                  </p>
                                ) : rowActivity === 'recording_video' ? (
                                  <p className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-[#0E7A34]">
                                    <Video className="h-3.5 w-3.5 shrink-0 animate-pulse" />
                                    <span className="truncate">Gravando vídeo...</span>
                                  </p>
                                ) : rowActivity === 'typing' ? (
                                  <p className="flex min-w-0 items-center gap-1 truncate text-xs font-semibold text-[#0E7A34]">
                                    <span className="truncate">Digitando...</span>
                                  </p>
                                ) : (
                                  <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-slate-500">
                                    {(pendingOutboxByChatId.get(thread.id)?.length || 0) > 0 && (
                                      <Clock
                                        className="h-3.5 w-3.5 shrink-0 text-amber-600"
                                        aria-label="Aguardando rede"
                                      />
                                    )}
                                    {isVoicePreview && (
                                      <Mic className="h-3.5 w-3.5 shrink-0 text-[#0E7A34]" />
                                    )}
                                    {isPdfPreview && (
                                      <FileText className="h-3.5 w-3.5 shrink-0 text-rose-600" />
                                    )}
                                    <span className="truncate">{lastText}</span>
                                  </p>
                                )}
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {isMuted && (
                                    <BellOff className="h-3.5 w-3.5 text-slate-400" />
                                  )}
                                  {isPinned && (
                                    <Pin className="h-3.5 w-3.5 text-slate-400" />
                                  )}
                                  {(matchedContact?.hasStorefront || dir?.hasStorefront) && (
                                    <Store className="h-4 w-4 text-[#0E7A34]" />
                                  )}
                                  {isUnread && (
                                    <span
                                      className="h-2.5 w-2.5 rounded-full bg-[#16A34A]"
                                      aria-label="Não lida"
                                    />
                                  )}
                                </div>
                              </div>
                            </button>
                            {!isChatSelectionActive && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedChatIds(new Set([thread.id]));
                                  setShowChatListMenu(true);
                                }}
                                aria-label={`Opções da conversa com ${displayName}`}
                                title="Opções da conversa"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Saved Contacts / Exact Phone or Virtual Line Match */}
                  {(Boolean(normalizedChatQuery) || chats.length === 0) &&
                    matchingZapeiPeople.length > 0 && (
                      <div className="divide-y divide-slate-100 border-t border-slate-100">
                        <div className="bg-slate-50/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          {chatPhoneMatch && matchingZapeiPeople.length === 1
                            ? 'Contato encontrado'
                            : `Seus contatos no ChatFi (${matchingZapeiPeople.length})`}
                        </div>
                        {matchingZapeiPeople.map((person) => (
                          <div
                            key={person.uid}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-emerald-50/50"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setAvatarPreview({
                                  name: person.name,
                                  initials: person.initials,
                                  avatarBg: person.avatarBg || '#0E7A34',
                                  avatarUrl: person.avatarUrl,
                                  phone: person.phone,
                                  subtitle: person.subtitle,
                                })
                              }
                              title={`Ver foto de ${person.name}`}
                              aria-label={`Ampliar foto de ${person.name}`}
                              className="shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/40"
                            >
                              {person.avatarUrl ? (
                                <img
                                  src={person.avatarUrl}
                                  alt={person.name}
                                  className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                                />
                              ) : (
                                <div
                                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                                  style={{ backgroundColor: person.avatarBg || '#0E7A34' }}
                                >
                                  {person.initials}
                                </div>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setChatSearch('');
                                void openChatWithPeer({
                                  uid: person.uid,
                                  name: person.name,
                                  initials: person.initials,
                                  avatarBg: person.avatarBg,
                                  avatarUrl: person.avatarUrl,
                                  phone: person.phone,
                                  role: person.role,
                                  hasStorefront: person.hasStorefront,
                                  storefrontName: person.storefrontName,
                                  deliveryPolicyLabel: person.deliveryPolicyLabel,
                                });
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-bold text-slate-900">
                                  {person.name}
                                </span>
                                <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#0E7A34]">
                                  No ChatFi
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-slate-500">
                                {person.subtitle}
                              </p>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                  {/* Empty State only when neither chats nor matching saved contacts exist */}
                  {filteredChats.length === 0 && matchingZapeiPeople.length === 0 && (
                    <div className="p-6 text-center">
                      <MessageSquare className="mx-auto h-9 w-9 text-slate-300" />
                      <p className="mt-3 text-sm font-semibold text-slate-800">
                        {normalizedChatQuery
                          ? `Nenhum contato ou conversa encontrado para "${chatSearch.trim()}"`
                          : 'Nenhuma conversa iniciada ainda'}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        {normalizedChatQuery
                          ? 'Digite o telefone completo com DDD ou a Linha Virtual (CFI-XXXX-XXXX) para encontrar alguém que ainda não está na sua agenda.'
                          : 'Apenas suas conversas e seus contatos salvos aparecem aqui. Abra Contatos para importar sua agenda ou adicionar um telefone ou Linha Virtual (CFI-...).'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('contacts')}
                        className="mt-4 rounded-xl bg-[#0E7A34] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0B5D27]"
                      >
                        Abrir Contatos
                      </button>
                    </div>
                  )}
                </div>
              </section>

              {/* Active Chat Thread Area */}
              <section
                className={`flex-1 flex-col min-w-0 ${
                  selectedPeer ? 'flex' : 'hidden md:flex'
                }`}
              >
                {selectedPeer ? (
                  <ChatThreadView
                    myUid={profile.uid}
                    myName={profile.name}
                    myAvatarUrl={profile.avatarUrl}
                    myInitials={getInitials(profile.name)}
                    myAvatarBg={profile.avatarBg || '#0E7A34'}
                    peer={selectedPeer}
                    peerPresence={directoryByUid.get(selectedPeer.uid) ?? null}
                    peerActivity={
                      selectedPeer &&
                      !chatPrefs.blockedUids.includes(selectedPeer.uid) &&
                      !hiddenPresenceUids.has(selectedPeer.uid)
                        ? peerActivityMap.get(selectedPeer.uid)?.activity ?? null
                        : null
                    }
                    onLocalActivityChange={(activity) => {
                      if (!selectedPeer || chatPrefs.blockedUids.includes(selectedPeer.uid)) {
                        return;
                      }
                      sendChatActivity(selectedPeer.uid, activity, authUser);
                    }}
                    onPreviewAvatar={setAvatarPreview}
                    messages={mergedActiveMessages}
                    forwardTargets={forwardTargets}
                    isOffline={!isOnline}
                    pendingCount={
                      pendingOutboxByChatId.get(
                        getDeterministicChatId(profile.uid, selectedPeer.uid)
                      )?.length || 0
                    }
                    onNotify={showToast}
                    onBack={() => setSelectedPeer(null)}
                    prefilledDraft={
                      selectedPeer.uid === OFFICIAL_SUPPORT_UID
                        ? chatPrefilledDraft
                        : null
                    }
                    onSendText={async (text) => {
                      const cleanPushPreview =
                        text.startsWith('» ') && text.includes('\n')
                          ? text.slice(text.indexOf('\n') + 1).trim() || text
                          : text;
                      const { queuedOffline } = await sendOrQueueMessage(
                        {
                          senderId: profile.uid,
                          senderName: profile.name,
                          recipientId: selectedPeer.uid,
                          recipientName: selectedPeer.name,
                          type: 'text',
                          text,
                          pushPreviewText: cleanPushPreview,
                          pushMessageType: 'text',
                        },
                        authUser
                      );
                      if (queuedOffline) {
                        showToast('Salva na fila — será enviada assim que o sinal voltar.');
                      }
                    }}
                    onSendAudio={async (audioBlob, audioDuration, replyCaption) => {
                      const audioText =
                        replyCaption?.trim() || `Mensagem de voz (${audioDuration})`;
                      if (!isOnline) {
                        if (audioBlob.size <= 330 * 1024) {
                          const dataUrl = await blobToDataUrl(audioBlob);
                          await sendOrQueueMessage(
                            {
                              senderId: profile.uid,
                              senderName: profile.name,
                              recipientId: selectedPeer.uid,
                              recipientName: selectedPeer.name,
                              type: 'audio',
                              text: audioText,
                              mediaUrl: dataUrl,
                              audioDuration,
                              pushPreviewText: `Áudio (${audioDuration})`,
                              pushMessageType: 'audio',
                            },
                            authUser
                          );
                          showToast('Áudio salvo na fila — será enviado assim que o sinal voltar.');
                          return;
                        }
                        throw new Error('Sem conexão para enviar áudio longo. Tente novamente quando o sinal voltar.');
                      }
                      await sendMediaWithTransitBridge({
                        myUid: profile.uid,
                        myName: profile.name,
                        recipientId: selectedPeer.uid,
                        recipientName: selectedPeer.name,
                        mediaType: 'audio',
                        blob: audioBlob,
                        mimeType: audioBlob.type || 'audio/webm',
                        durationLabel: audioDuration,
                        caption: replyCaption || undefined,
                        authUser,
                      });
                    }}
                    onSendImage={async (imageBlob, caption) => {
                      if (!isOnline) {
                        if (imageBlob.size <= 330 * 1024) {
                          const dataUrl = await blobToDataUrl(imageBlob);
                          await sendOrQueueMessage(
                            {
                              senderId: profile.uid,
                              senderName: profile.name,
                              recipientId: selectedPeer.uid,
                              recipientName: selectedPeer.name,
                              type: 'image',
                              text: caption || 'Foto',
                              mediaUrl: dataUrl,
                              pushPreviewText: caption ? `Foto: ${caption}` : 'Enviou uma foto',
                              pushMessageType: 'image',
                            },
                            authUser
                          );
                          showToast('Foto salva na fila — será enviada assim que o sinal voltar.');
                          return;
                        }
                        throw new Error('Sem conexão para enviar esta foto. Tente novamente quando o sinal voltar.');
                      }
                      await sendMediaWithTransitBridge({
                        myUid: profile.uid,
                        myName: profile.name,
                        recipientId: selectedPeer.uid,
                        recipientName: selectedPeer.name,
                        mediaType: 'image',
                        blob: imageBlob,
                        mimeType: imageBlob.type || 'image/jpeg',
                        caption: caption || 'Foto',
                        authUser,
                      });
                    }}
                    onSendVideo={async (videoBlob, videoDuration, caption) => {
                      if (!isOnline) {
                        throw new Error('Sem internet para enviar vídeo. Conecte-se para enviar.');
                      }
                      await sendMediaWithTransitBridge({
                        myUid: profile.uid,
                        myName: profile.name,
                        recipientId: selectedPeer.uid,
                        recipientName: selectedPeer.name,
                        mediaType: 'video',
                        blob: videoBlob,
                        mimeType: videoBlob.type || 'video/mp4',
                        durationLabel: videoDuration || undefined,
                        caption: caption || undefined,
                        authUser,
                      });
                    }}
                    onSendPdf={async (pdfBlob, fileName) => {
                      const cleanName = (fileName || 'Documento.pdf').trim().slice(0, 120);
                      if (!isOnline) {
                        if (pdfBlob.size <= 330 * 1024) {
                          const dataUrl = await blobToDataUrl(pdfBlob);
                          await sendOrQueueMessage(
                            {
                              senderId: profile.uid,
                              senderName: profile.name,
                              recipientId: selectedPeer.uid,
                              recipientName: selectedPeer.name,
                              type: 'image',
                              text: cleanName,
                              mediaUrl: dataUrl,
                              mediaMimeType: 'application/pdf',
                              pushPreviewText: `PDF: ${cleanName}`,
                              pushMessageType: 'image',
                            },
                            authUser
                          );
                          showToast('PDF salvo na fila — será enviado assim que o sinal voltar.');
                          return;
                        }
                        throw new Error('Sem conexão para enviar este PDF. Tente novamente quando o sinal voltar.');
                      }
                      await sendMediaWithTransitBridge({
                        myUid: profile.uid,
                        myName: profile.name,
                        recipientId: selectedPeer.uid,
                        recipientName: selectedPeer.name,
                        mediaType: 'image',
                        blob: pdfBlob,
                        mimeType: 'application/pdf',
                        fileName: cleanName,
                        caption: cleanName,
                        authUser,
                      });
                    }}
                    onForwardMessage={async (target, msg) => {
                      if (msg.type === 'image' || msg.type === 'audio' || msg.type === 'video') {
                        const cached = await getLocalMedia(msg.id);
                        let blobToSend: Blob | null = cached?.blob || null;
                        if (!blobToSend && msg.mediaUrl?.startsWith('data:')) {
                          blobToSend = dataUrlToBlob(msg.mediaUrl);
                        }
                        if (!blobToSend) {
                          showToast('Esta mídia não está salva neste aparelho para encaminhar.');
                          return;
                        }
                        if (!isOnline) {
                          showToast('Conecte-se à internet para encaminhar mídias.');
                          return;
                        }
                        await sendMediaWithTransitBridge({
                          myUid: profile.uid,
                          myName: profile.name,
                          recipientId: target.uid,
                          recipientName: target.name,
                          mediaType: msg.type,
                          blob: blobToSend,
                          mimeType: cached?.mimeType || msg.mediaMimeType || blobToSend.type,
                          durationLabel:
                            msg.type === 'audio'
                              ? msg.audioDuration
                              : msg.type === 'video'
                                ? msg.videoDuration
                                : undefined,
                          caption:
                            msg.type === 'image' || msg.type === 'video'
                              ? msg.text
                              : undefined,
                          authUser,
                        });
                        showToast(`Encaminhado para ${target.name}!`);
                        return;
                      }

                      const { queuedOffline } = await sendOrQueueMessage(
                        {
                          senderId: profile.uid,
                          senderName: profile.name,
                          recipientId: target.uid,
                          recipientName: target.name,
                          type: 'text',
                          text: msg.text || '',
                          pushPreviewText: msg.text,
                          pushMessageType: 'text',
                        },
                        authUser
                      );
                      showToast(
                        queuedOffline
                          ? `Salvo na fila para ${target.name} (aguardando rede).`
                          : `Encaminhado para ${target.name}!`
                      );
                    }}
                    onDeleteMessagesForMe={async (messageIds) => {
                      const clean = Array.from(new Set(messageIds.filter(Boolean)));
                      if (clean.length === 0) return;
                      const deletedMeKey = `chatfi_deleted_for_me_v1_${profile.uid}`;
                      setDeletedForMeIds((prev) => {
                        const next = new Set(prev);
                        for (const id of clean) next.add(id);
                        try {
                          localStorage.setItem(
                            deletedMeKey,
                            JSON.stringify(Array.from(next).slice(-5000))
                          );
                        } catch {
                          // ignore storage quota
                        }
                        return next;
                      });
                      await removeOutboxPackets(clean).catch(() => {});
                      await deleteLocalMediaItems(clean).catch(() => {});
                      if (authUser) {
                        void persistDeletedForMeOnServer(authUser, clean);
                      }
                      showToast(
                        clean.length === 1
                          ? 'Mensagem apagada para você.'
                          : `${clean.length} mensagens apagadas para você.`
                      );
                    }}
                    onDeleteMessagesForAll={async (msgsToDelete) => {
                      const chatId = getDeterministicChatId(profile.uid, selectedPeer.uid);
                      const mineTargets = msgsToDelete.filter(
                        (m) => m.senderId === profile.uid && !m.deletedForAll
                      );
                      if (mineTargets.length === 0) return;
                      const nowMs = Date.now();

                      const outboxIds = mineTargets
                        .filter((m) => m.deliveryStatus === 'pending' || m.deliveryStatus === 'sending')
                        .map((m) => m.id);
                      if (outboxIds.length > 0) {
                        await removeOutboxPackets(outboxIds).catch(() => {});
                      }

                      const cloudTargets = mineTargets.filter(
                        (m) => m.deliveryStatus !== 'pending' && m.deliveryStatus !== 'sending'
                      );
                      setDeletedForAllMap((prev) => {
                        const next = new Map(prev);
                        for (const m of cloudTargets) {
                          next.set(`${chatId}__${m.id}`, nowMs);
                        }
                        return next;
                      });
                      await deleteLocalMediaItems(mineTargets.map((m) => m.id)).catch(() => {});

                      if (cloudTargets.length > 0) {
                        const lastVisible = mergedActiveMessages[mergedActiveMessages.length - 1];
                        const isLatest = Boolean(
                          lastVisible && cloudTargets.some((m) => m.id === lastVisible.id)
                        );
                        await deleteChatMessagesForAll({
                          chatId,
                          messages: cloudTargets,
                          myUid: profile.uid,
                          authUser,
                          isLatestInThread: isLatest,
                        });
                      }
                      showToast(
                        mineTargets.length === 1
                          ? 'Mensagem apagada para todos.'
                          : `${mineTargets.length} mensagens apagadas para todos.`
                      );
                    }}
                    onStartCall={(type) => void handleStartCall(selectedPeer, type)}
                    onOpenStorefront={() => void openStorefrontByUid(selectedPeer.uid)}
                    onInspectOrder={() => {
                      if (profile.commercialMode !== 'buyer') {
                        setActiveTab('commercial');
                      } else if (selectedPeer.hasStorefront) {
                        void openStorefrontByUid(selectedPeer.uid, 'orders');
                      }
                    }}
                    isPeerBlocked={chatPrefs.blockedUids.includes(selectedPeer.uid)}
                    isChatMuted={chatPrefs.mutedChatIds.includes(
                      getDeterministicChatId(profile.uid, selectedPeer.uid)
                    )}
                    isChatFavorite={chatPrefs.favoriteChatIds.includes(
                      getDeterministicChatId(profile.uid, selectedPeer.uid)
                    )}
                    isChatLocked={chatPrefs.lockedChatIds.includes(
                      getDeterministicChatId(profile.uid, selectedPeer.uid)
                    )}
                    hasShortcut={chatPrefs.shortcutChatIds.includes(
                      getDeterministicChatId(profile.uid, selectedPeer.uid)
                    )}
                    onShowContact={() =>
                      openContactDetailsForUid(selectedPeer.uid, selectedPeer.name)
                    }
                    onAddShortcut={() =>
                      setShortcutModalTarget({
                        chatId: getDeterministicChatId(profile.uid, selectedPeer.uid),
                        peerUid: selectedPeer.uid,
                        peerName: selectedPeer.name,
                      })
                    }
                    onToggleLockChat={() =>
                      handleRequestToggleLockChats(
                        [getDeterministicChatId(profile.uid, selectedPeer.uid)],
                        selectedPeer.name
                      )
                    }
                    onToggleFavoriteChat={() =>
                      toggleIdsInPrefList(
                        'favoriteChatIds',
                        [getDeterministicChatId(profile.uid, selectedPeer.uid)],
                        {
                          added: 'Adicionada aos favoritos.',
                          removed: 'Removida dos favoritos.',
                        }
                      )
                    }
                    onOpenAddToList={() =>
                      setAddToListTarget({
                        chatIds: [getDeterministicChatId(profile.uid, selectedPeer.uid)],
                        title: selectedPeer.name,
                      })
                    }
                    onToggleMuteChat={() =>
                      toggleIdsInPrefList(
                        'mutedChatIds',
                        [getDeterministicChatId(profile.uid, selectedPeer.uid)],
                        {
                          added: 'Notificações silenciadas.',
                          removed: 'Notificações reativadas.',
                        }
                      )
                    }
                    onClearChat={() =>
                      setChatConfirmModal({
                        kind: 'clear',
                        chatIds: [getDeterministicChatId(profile.uid, selectedPeer.uid)],
                        peerUids: [selectedPeer.uid],
                        targetName: selectedPeer.name,
                      })
                    }
                    onToggleBlockPeer={() => {
                      const blocked = chatPrefs.blockedUids.includes(selectedPeer.uid);
                      setChatConfirmModal({
                        kind: blocked ? 'unblock' : 'block',
                        chatIds: [getDeterministicChatId(profile.uid, selectedPeer.uid)],
                        peerUids: [selectedPeer.uid],
                        targetName: selectedPeer.name,
                      });
                    }}
                  />
                ) : (
                  <div className="chatfi-chat-wallpaper flex flex-1 flex-col items-center justify-center p-8 text-center">
                    <div className="max-w-md rounded-3xl border border-emerald-900/10 bg-white/90 px-8 py-8 shadow-sm backdrop-blur-sm">
                      <ChatFiLogo className="mx-auto h-20 w-20 rounded-3xl border border-emerald-200/70 shadow-sm" />
                      <h2 className="mt-5 text-lg font-extrabold text-slate-900">
                        Chat<span className="text-[#0E7A34]">Fi</span> Mensageiro em Tempo Real
                      </h2>
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">
                        Selecione uma conversa à esquerda ou abra sua agenda de contatos para enviar mensagens, gravar áudios, enviar fotos ou fazer chamadas reais de voz e vídeo.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'calls' && (
            <CallsView
              myUid={profile.uid}
              calls={calls.filter((c) => !dismissedCallIds.has(c.id))}
              zapeiContacts={zapeiContacts}
              directoryUsers={effectiveDirectoryUsers}
              onPreviewAvatar={setAvatarPreview}
              onDeleteCall={async (callId) => {
                setDismissedCallIds((prev) => {
                  const next = new Set(prev);
                  next.add(callId);
                  return next;
                });
                await deleteCallHistoryRecord(callId, profile.uid);
                showToast('Chamada removida do histórico.');
              }}
              onStartCallWithPeer={(peer, type) => void handleStartCall(peer, type)}
            />
          )}

          {activeTab === 'contacts' && (
            <ContactsView
              currentUserUid={profile.uid}
              contacts={contacts}
              directoryUsers={effectiveDirectoryUsers}
              products={products}
              connections={connections}
              onPreviewAvatar={setAvatarPreview}
              onLookupPhone={lookupRegisteredUserByPhone}
              onOpenDirectoryChat={(person) => {
                void openChatWithPeer({
                  uid: person.uid,
                  name: person.displayName,
                  initials: person.initials,
                  avatarBg: person.avatarColor,
                  avatarUrl: person.avatarUrl,
                  role: person.role,
                  hasStorefront: person.hasStorefront,
                  storefrontName: person.storefrontName,
                  deliveryPolicyLabel: person.deliveryPolicyLabel,
                });
              }}
              onOpenDirectoryStorefront={(person) => {
                void openStorefrontByUid(person.uid);
              }}
              onStartDirectoryCall={(person, type) => {
                void handleStartCall(
                  {
                    uid: person.uid,
                    name: person.displayName,
                    initials: person.initials,
                    avatarBg: person.avatarColor,
                    avatarUrl: person.avatarUrl,
                  },
                  type
                );
              }}
              onSaveContact={(name, phone) =>
                saveRealContactToPhonebook({ ownerId: profile.uid, name, phone })
              }
              onImportBatchContacts={async (entries) => {
                let matched = 0;
                for (const entry of entries) {
                  const res = await saveRealContactToPhonebook({
                    ownerId: profile.uid,
                    name: entry.name,
                    phone: entry.phone,
                  });
                  if (res.matched) matched += 1;
                }
                return { total: entries.length, matched };
              }}
              onResyncContacts={() => resyncAllPhonebookContacts(profile.uid, contacts)}
              onMarkInvited={(contactId) => markContactInvited(profile.uid, contactId)}
              onDeleteContact={(contactId) => deletePhonebookContact(profile.uid, contactId)}
              onOpenDirectFoundChat={async (found, rawPhone) => {
                void saveRealContactToPhonebook({
                  ownerId: profile.uid,
                  name: found.displayName,
                  phone: rawPhone,
                }).catch(() => {});
                await openChatWithPeer({
                  uid: found.uid,
                  name: found.displayName,
                  initials: found.initials,
                  avatarBg: found.avatarColor,
                  avatarUrl: found.avatarUrl,
                  phone: formatPhoneDisplay(rawPhone),
                  role: found.role,
                  hasStorefront: found.hasStorefront,
                  storefrontName: found.storefrontName,
                  deliveryPolicyLabel: found.deliveryPolicy.label,
                });
              }}
              onStartDirectFoundCall={async (found, rawPhone, type) => {
                void saveRealContactToPhonebook({
                  ownerId: profile.uid,
                  name: found.displayName,
                  phone: rawPhone,
                }).catch(() => {});
                await handleStartCall(
                  {
                    uid: found.uid,
                    name: found.displayName,
                    initials: found.initials,
                    avatarBg: found.avatarColor,
                    avatarUrl: found.avatarUrl,
                  },
                  type
                );
              }}
              onOpenChat={(contact, avatarUrl) => {
                if (!contact.matchedUid) return;
                void openChatWithPeer({
                  uid: contact.matchedUid,
                  name: contact.name,
                  initials: contact.initials,
                  avatarBg: contact.avatarBg,
                  avatarUrl,
                  phone: contact.phone,
                  role: contact.role,
                  hasStorefront: contact.hasStorefront,
                  storefrontName: contact.storefrontName,
                  deliveryPolicyLabel: contact.deliveryPolicyLabel,
                });
              }}
              onOpenStorefront={(contact) => {
                if (contact.matchedUid) {
                  void openStorefrontByUid(contact.matchedUid);
                }
              }}
              onStartCall={(contact, type, avatarUrl) => {
                if (!contact.matchedUid) return;
                void handleStartCall(
                  {
                    uid: contact.matchedUid,
                    name: contact.name,
                    initials: contact.initials,
                    avatarBg: contact.avatarBg,
                    avatarUrl,
                  },
                  type
                );
              }}
            />
          )}

          {activeTab === 'commercial' &&
            profile.commercialMode === 'manufacturer' &&
            !profile.commercialBanned && (
            <ManufacturerPanel
              profile={profile}
              products={products}
              subOrders={allSubOrders}
              orders={effectiveOrders}
              payments={effectivePayments}
              connections={connections}
              receivedReviews={receivedReviews}
              onRespondResellerRequest={handleRespondResellerRequest}
              onSavePolicy={async (factoryName, factoryPolicy: MinimumDeliveryPolicy) => {
                await persistProfileUpdate({ factoryName, factoryPolicy });
              }}
              onSaveWalletId={async (asaasWalletId: string) => {
                await persistProfileUpdate({ asaasWalletId });
              }}
              onSyncAsaasStatus={handleSyncAsaasOrderStatus}
              onSaveFavoriteGrade={async (grade: FavoriteGrade) => {
                await persistProfileUpdate({
                  favoriteGrades: [...profile.favoriteGrades, grade],
                });
              }}
              onCreateProduct={async (params) => {
                await createRealProduct({
                  ...params,
                  factoryId: profile.uid,
                  factoryName: profile.factoryName || profile.name,
                });
              }}
              onUpdateProduct={(productId, params) =>
                updateRealProduct(productId, params)
              }
              onUpdateStock={(productId, stockBoxes, isSoldOutToday) =>
                updateRealProductStock(productId, stockBoxes, isSoldOutToday)
              }
              onConfirmConference={handleConfirmConference}
              onDispatchSubOrder={async (sub, receiptNote, receiptUrl) => {
                await updateRealSubOrder(sub.id, {
                  status: 'dispatched',
                  receiptNote,
                  receiptUrl,
                  receiptAttached: Boolean(receiptUrl || receiptNote),
                });
                const parent = effectiveOrders.find((o) => o.id === sub.parentOrderId);
                if (parent) {
                  const allDispatched = parent.subOrders.every(
                    (s) => s.id === sub.id || s.status === 'dispatched' || s.status === 'completed'
                  );
                  if (allDispatched) {
                    await updateRealOrder(parent.id, { status: 'dispatched' });
                  }
                }
              }}
              onUpdatePayment={(paymentId, updates) =>
                updateRealPayment(paymentId, updates)
              }
              onCancelOrder={handleCancelOrderAndReleaseStock}
              onOpenBilling={() => setShowBillingModal(true)}
              onOpenHelp={(ctx) => openHelpCenter(ctx)}
            />
          )}

          {activeTab === 'commercial' &&
            profile.commercialMode === 'reseller' &&
            !profile.commercialBanned && (
            <ResellerPanel
              profile={profile}
              connections={connections}
              products={products}
              orders={effectiveOrders}
              payments={effectivePayments}
              writtenReviews={writtenReviews}
              receivedReviews={receivedReviews}
              onSaveStorefrontIdentity={async (storefrontName, storefrontPrivacy) => {
                await persistProfileUpdate({ storefrontName, storefrontPrivacy });
              }}
              onSaveAnchorDiscount={async (anchorDiscountPercent: number) => {
                await persistProfileUpdate({ anchorDiscountPercent });
              }}
              onSaveWalletId={async (asaasWalletId: string) => {
                await persistProfileUpdate({ asaasWalletId });
              }}
              onConnectFactoryByPhone={handleConnectFactoryByPhone}
              onUpdateConnection={async (
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
              ) => {
                await updateRealConnection(connectionId, updates);
                if (updates.approvalStatus === 'pending') {
                  const targetConn = connections.find((c) => c.id === connectionId);
                  if (targetConn) {
                    const resellerLabel = profile.storefrontName || profile.name;
                    void checkPeerReachability(targetConn.factoryId, authUser).then((reach) => {
                      if (!reach.reachable) return;
                      void sendRealChatMessage({
                        myUid: profile.uid,
                        myName: resellerLabel,
                        otherUid: targetConn.factoryId,
                        otherName: targetConn.factoryName,
                        type: 'text',
                        text: `Olá ${targetConn.factoryName}! Enviei novamente uma solicitação para atuar como seu revendedor (${resellerLabel}). Acesse seu Painel do Fabricante > aba "Revendedores" para analisar.`,
                      }).catch(() => {});
                    });
                  }
                }
              }}
              onApplyPunctualDiscount={handleApplyPunctualDiscount}
              onSubmitLogistics={async (
                sub: SubOrder,
                logisticsType: LogisticsType,
                logisticsCompany: string,
                logisticsAddress: string
              ) => {
                await updateRealSubOrder(sub.id, {
                  logisticsType,
                  logisticsCompany,
                  logisticsAddress,
                  status: 'logistics_sent',
                });
              }}
              onUpdatePayment={(paymentId, updates: { method?: PaymentMethod; status?: PaymentStatus }) =>
                updateRealPayment(paymentId, updates)
              }
              onSendBillingReminder={async (pay) => {
                const nowLabel = new Date().toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const reach = await checkPeerReachability(pay.counterpartyId, authUser);
                if (reach.reachable) {
                  await sendRealChatMessage({
                    myUid: profile.uid,
                    myName: profile.storefrontName || profile.name,
                    otherUid: pay.counterpartyId,
                    otherName: pay.counterpartyName,
                    type: 'billing_reminder',
                    orderId: pay.orderId,
                    orderCode: pay.orderCode,
                    text: `Olá ${pay.counterpartyName}! Passando para lembrar do pagamento referente ao pedido ${pay.orderCode} no valor de ${formatBRL(pay.amount)} (vencimento ${pay.dueDate}, forma: ${pay.method}).`,
                  });
                }
                await updateRealPayment(pay.id, { lastReminderSent: nowLabel });
              }}
              onGenerateAsaasCharge={handleGenerateAsaasChargeForOrder}
              onSyncAsaasStatus={handleSyncAsaasOrderStatus}
              onCancelOrder={handleCancelOrderAndReleaseStock}
              onConfirmSubOrderDelivered={async (order, sub) => {
                await updateRealSubOrder(sub.id, { status: 'completed' });
                const allCompleted = order.subOrders.every(
                  (s) => s.id === sub.id || s.status === 'completed' || s.status === 'cancelled'
                );
                if (allCompleted) {
                  await updateRealOrder(order.id, { status: 'completed' }).catch(() => {});
                }
              }}
              onSubmitReview={handleSubmitCommercialReview}
              onSubmitDeliveryReport={handleSubmitDeliveryReport}
              onOpenMyStorefrontPreview={() => void openStorefrontByUid(profile.uid)}
              onOpenBilling={() => setShowBillingModal(true)}
              onOpenHelp={(ctx) => openHelpCenter(ctx)}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              profile={profile}
              connectedDevices={connectedDevices}
              currentDeviceId={localDeviceInfo.deviceId}
              onDisconnectDevice={async (device) => {
                await disconnectUserDevice(profile.uid, device.deviceId);
                if (device.deviceId === localDeviceInfo.deviceId) {
                  try {
                    localStorage.removeItem(
                      `zapei_device_auth_uid_${localDeviceInfo.deviceId}`
                    );
                  } catch {
                    // ignore
                  }
                  showToast('Este aparelho foi desconectado.');
                  await signOutFirebase();
                } else {
                  showToast(`${device.deviceName} desconectado imediatamente.`);
                }
              }}
              policyConsent={policyConsent}
              onOpenPolicies={() => setShowPoliciesModal(true)}
              onEditProfile={() => setShowEditProfile(true)}
              onPreviewAvatar={setAvatarPreview}
              onUpdatePresencePrivacy={async (opts) => {
                await updateUserPresencePrivacy(profile.uid, {
                  ...opts,
                  currentlyOnline: isOnline,
                });
                if (!opts.showOnlineStatus && !opts.showLastSeen) {
                  showToast('Modo invisível ativado: seu online e visto por último estão ocultos.');
                } else if (!opts.showOnlineStatus) {
                  showToast('Status online ocultado para seus contatos.');
                } else if (!opts.showLastSeen) {
                  showToast('Horário de "visto por último" ocultado.');
                } else {
                  showToast('Status online e "visto por último" visíveis normalmente.');
                }
              }}
              onSelectMode={(mode) => void handleSelectCommercialMode(mode)}
              onSaveWalletId={async (asaasWalletId: string) => {
                await persistProfileUpdate({ asaasWalletId });
              }}
              onOpenBilling={() => setShowBillingModal(true)}
              onOpenCommercialPanel={() => setActiveTab('commercial')}
              onOpenHelp={() => openHelpCenter({ defaultTab: 'faq' })}
              onOpenCommercialAppeal={() =>
                openHelpCenter({
                  defaultTab: 'ticket',
                  reason: 'Recurso / Liberação Comercial',
                })
              }
              openTicketCount={
                supportTickets.filter((t) => t.status !== 'Resolvido').length
              }
              onNotify={showToast}
              onSignOut={async () => {
                await updateUserPresenceHeartbeat(profile.uid, {
                  isOnline: false,
                  showOnlineStatus: profile.showOnlineStatus !== false,
                  showLastSeen: profile.showLastSeen !== false,
                }).catch(() => {});
                await disconnectUserDevice(profile.uid, localDeviceInfo.deviceId).catch(() => {});
                try {
                  localStorage.removeItem(
                    `zapei_device_auth_uid_${localDeviceInfo.deviceId}`
                  );
                  localStorage.removeItem(`chatfi_profile_cache_v1_${profile.uid}`);
                } catch {
                  // ignore
                }
                await signOutFirebase();
              }}
            />
          )}
        </main>

        {/* Mobile Bottom Navigation Bar — Elevated Rounded Dock */}
        {!mobileInChat && (
          <nav className="fixed bottom-0 left-0 right-0 z-30 flex md:hidden w-full max-w-full items-center justify-around rounded-t-[22px] border-t border-emerald-950/10 bg-white/95 px-2 pt-2 pb-safe backdrop-blur-md shadow-[0_-6px_24px_rgba(4,61,27,0.08)]">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1 text-[11px] font-semibold transition ${
                    active
                      ? 'bg-emerald-50/95 text-[#0E7A34]'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <div className="relative">
                    <Icon className="h-5 w-5 shrink-0" />
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="absolute -right-2 -top-1.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-extrabold text-white">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="w-full truncate text-center">{item.label}</span>
                  {active && (
                    <span
                      className="mt-0.5 h-[3px] w-6 rounded-full bg-[#0E7A34]"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {/* Public Storefront Overlay (for viewing any real Manufacturer or Reseller storefront) */}
      {activeStorefrontOwner && (
        <PublicStorefrontView
          myUid={profile.uid}
          myName={profile.name}
          owner={activeStorefrontOwner}
          products={products}
          connections={connections}
          orders={effectiveOrders}
          writtenReviews={writtenReviews}
          initialSubView={activeStorefrontInitialTab}
          onClose={() => {
            setActiveStorefrontOwner(null);
            setActiveStorefrontInitialTab('catalog');
          }}
          onGenerateOrderCharge={handleGenerateAsaasChargeForOrder}
          onSyncOrderStatus={handleSyncAsaasOrderStatus}
          onCancelOrder={handleCancelOrderAndReleaseStock}
          onConfirmOrderDelivered={async (order) => {
            await markOrderCompletedByParticipant({
              orderId: order.id,
              subOrderId: order.subOrders[0]?.id,
            });
            showToast(`Entrega do pedido ${order.orderCode} confirmada!`);
          }}
          onSubmitReview={handleSubmitCommercialReview}
          onSubmitDeliveryReport={handleSubmitDeliveryReport}
          onOpenHelp={(ctx) => openHelpCenter(ctx)}
          onCheckoutMixedOrder={async ({
            ownerUid,
            storefrontName,
            subOrders,
            buyerSubtotal,
            factoryCostTotal,
            paymentMethod,
            installments,
            splitBreakdown,
          }) => {
            const firstSub = subOrders[0];
            const orderId = firstSub?.parentOrderId || `ord_${Date.now()}`;
            const orderCode = firstSub
              ? firstSub.subOrderCode.split('-')[0]
              : `#${Math.floor(1000 + Math.random() * 9000)}`;

            await createRealMixedOrder({
              orderId,
              orderCode,
              buyerId: profile.uid,
              buyerName: profile.name,
              resellerId: ownerUid,
              storefrontName,
              subOrders,
              buyerSubtotal,
              buyerFinalTotal: buyerSubtotal,
              factoryCostTotal,
              paymentMethod,
              installments,
              buyerChargedTotal: splitBreakdown.buyerChargedTotal,
              gatewayFee: splitBreakdown.gatewayFee,
              platformFeeGross: splitBreakdown.platformGrossFee,
              platformFeeNet: splitBreakdown.platformNetFee,
              minimumFeeApplied: splitBreakdown.minimumRuleApplied,
              splitFactoryNet: splitBreakdown.factoryNetTotal,
              splitResellerNet: splitBreakdown.resellerNetTotal,
            });

            // Send real interactive order card directly to the storefront owner's chat
            if (ownerUid !== profile.uid) {
              const reach = await checkPeerReachability(ownerUid, authUser);
              if (reach.reachable) {
                const totalBoxes = subOrders.reduce(
                  (acc, s) =>
                    acc + s.items.reduce((sum, i) => sum + i.boxesRequested, 0),
                  0
                );
                await sendRealChatMessage({
                  myUid: profile.uid,
                  myName: profile.name,
                  otherUid: ownerUid,
                  otherName: storefrontName,
                  type: 'order_card',
                  text: `Novo pedido ${orderCode} enviado (${totalBoxes} caixas · ${
                    paymentMethod === 'credit_card' ? `Cartão ${installments}x` : 'Pix'
                  })`,
                  orderId,
                  orderCode,
                  orderSummary: `${totalBoxes} caixa(s) · ${
                    paymentMethod === 'credit_card'
                      ? `Cartão ${installments}x de ${formatBRL(splitBreakdown.installmentValue)}`
                      : `Pix ${formatBRL(splitBreakdown.buyerChargedTotal)}`
                  }`,
                  orderTotal: splitBreakdown.buyerChargedTotal,
                  orderStatusLabel: 'Aguardando conferência de estoque',
                });
              }
            }

            try {
              const chargeRes = await createAsaasSplitCharge({
                orderId,
                paymentMethod,
                installments,
                customerInfo: {
                  name: profile.name,
                  email: profile.email,
                },
              });
              await updateRealOrder(orderId, {
                asaasChargeId: chargeRes.chargeId,
                asaasChargeStatus: chargeRes.status,
                ...(chargeRes.invoiceUrl ? { asaasInvoiceUrl: chargeRes.invoiceUrl } : {}),
                ...(chargeRes.pixCopyPaste ? { asaasPixPayload: chargeRes.pixCopyPaste } : {}),
              });
              await updateRealPayment(`pay_rb_${orderId}`, {
                asaasChargeId: chargeRes.chargeId,
                asaasChargeStatus: chargeRes.status,
              }).catch(() => {});
              return chargeRes;
            } catch {
              showToast(
                'Pedido registrado! Você pode gerar o pagamento em Meus Pedidos.'
              );
              return null;
            }
          }}
        />
      )}

      {/* Real WebRTC Audio/Video Call Modal */}
      {activeCall && (
        <ActiveCallModal
          call={activeCall}
          onAcceptIncoming={() => void handleAcceptIncomingCall()}
          onDeclineIncoming={() => void handleDeclineIncomingCall()}
          onEndCall={(durationLabel) => void handleEndCall(durationLabel)}
          onSwitchCamera={handleSwitchCamera}
          onChangeVideoQuality={(mode: VideoQualityMode) => {
            setActiveCall((prev) => (prev ? { ...prev, videoQuality: mode } : null));
            void webrtcHandleRef.current?.setVideoQualityMode(mode);
            showToast(
              mode === 'economy'
                ? 'Modo Leve 4G ativado (vídeo mais fluido).'
                : mode === 'hd'
                  ? 'Modo HD ativado (melhor em Wi-Fi forte).'
                  : 'Qualidade Automática ativada.'
            );
          }}
        />
      )}

      {/* Edit Profile & Photo Modal */}
      {showEditProfile && (
        <PhoneOnboardingModal
          mode="edit"
          authUser={authUser}
          initialName={profile.name}
          initialPhone={profile.phone}
          initialStatus={profile.statusMessage}
          initialAvatarUrl={profile.avatarUrl}
          onSaveProfile={async (name, phone, statusMessage, avatarUrl) => {
            await persistProfileUpdate({ name, phone, statusMessage, avatarUrl });
            showToast('Dados do perfil atualizados.');
          }}
          onClose={() => setShowEditProfile(false)}
        />
      )}

      {/* 1-Step Commercial Activation Modal (Company/Storefront Name + Mandatory CPF + 30-Day Free Trial) */}
      {trialPromptRole && (
        <CommercialTrialModal
          targetRole={trialPromptRole}
          alreadyOnPlan={profile.subscriptionStatus !== 'free'}
          cpfAlreadyVerified={Boolean(profile.cpfVerified)}
          defaultBusinessName={
            trialPromptRole === 'manufacturer'
              ? profile.factoryName || ''
              : profile.storefrontName || ''
          }
          onConfirm={handleConfirmTrialActivation}
          onOpenHelp={() => {
            setTrialPromptRole(null);
            openHelpCenter({
              defaultTab: 'ticket',
              reason: 'Recurso / Liberação Comercial',
            });
          }}
          onCancel={() => setTrialPromptRole(null)}
        />
      )}

      {/* Commercial Subscription Billing Modal */}
      {showBillingModal && (
        <BillingManageModal
          profile={profile}
          onRenewSubscription={async () => {
            await persistProfileUpdate({ subscriptionStatus: 'active' });
            showToast('Assinatura Comercial ativada (R$ 59,90/mês).');
          }}
          onClose={() => setShowBillingModal(false)}
        />
      )}
      {/* Real-Time New Device Approval Modal (Primary / Already-Connected Device) */}
      {pendingIncomingAuthRequests.length > 0 && (
        <DeviceApprovalModal
          request={pendingIncomingAuthRequests[0]}
          onApprove={handleApproveIncomingDevice}
          onReject={handleRejectIncomingDevice}
        />
      )}

      {/* WhatsApp / Android Web Share Target Modal (Images, Audio Notes, Videos, Text) */}
      {pendingSharedPayloads.length > 0 && (
        <ShareTargetModal
          payloads={pendingSharedPayloads}
          recipients={shareTargetRecipients}
          onClose={() => void handleDismissSharedPayloads()}
          onSendSharedContent={handleSendSharedContent}
        />
      )}

      {/* Terms of Responsibility, LGPD Privacy Policy & Unified One-Time Permissions Gate */}
      {policyCheckedUid === profile.uid && !policyConsent && (
        <TermsAndPermissionsModal
          mode="gate"
          onAcceptAndAuthorize={handleAcceptPolicyAndAuthorize}
        />
      )}

      {showPoliciesModal && (
        <TermsAndPermissionsModal
          mode="review"
          existingConsent={policyConsent}
          onAcceptAndAuthorize={handleAcceptPolicyAndAuthorize}
          onClose={() => setShowPoliciesModal(false)}
        />
      )}

      {/* WhatsApp-Style Enlarged Profile Photo Viewer */}
      {avatarPreview && (
        <AvatarLightboxModal
          target={avatarPreview}
          onClose={() => setAvatarPreview(null)}
        />
      )}

      {/* Dados do contato ("Mostrar contato") */}
      {contactModalTarget && (
        <ContactInfoModal
          target={contactModalTarget}
          isFavorite={chatPrefs.favoriteChatIds.includes(contactModalTarget.chatId)}
          isMuted={chatPrefs.mutedChatIds.includes(contactModalTarget.chatId)}
          isLocked={chatPrefs.lockedChatIds.includes(contactModalTarget.chatId)}
          isBlocked={chatPrefs.blockedUids.includes(contactModalTarget.uid)}
          hasShortcut={chatPrefs.shortcutChatIds.includes(contactModalTarget.chatId)}
          onClose={() => setContactModalTarget(null)}
          onPreviewAvatar={setAvatarPreview}
          onOpenChat={() => {
            const t = contactModalTarget;
            setContactModalTarget(null);
            void openChatWithPeer({
              uid: t.uid,
              name: t.name,
              initials: t.initials,
              avatarBg: t.avatarBg,
              avatarUrl: t.avatarUrl,
              phone: t.phone,
              virtualLine: t.virtualLine,
              role: t.role,
              hasStorefront: t.hasStorefront,
              storefrontName: t.storefrontName,
              deliveryPolicyLabel: t.deliveryPolicyLabel,
              ratingAverage: t.ratingAverage,
              ratingCount: t.ratingCount,
            });
          }}
          onStartCall={(type) => {
            const t = contactModalTarget;
            setContactModalTarget(null);
            void handleStartCall(
              {
                uid: t.uid,
                name: t.name,
                initials: t.initials,
                avatarBg: t.avatarBg,
                avatarUrl: t.avatarUrl,
              },
              type
            );
          }}
          onOpenStorefront={
            contactModalTarget.hasStorefront
              ? () => {
                  const uid = contactModalTarget.uid;
                  setContactModalTarget(null);
                  void openStorefrontByUid(uid);
                }
              : undefined
          }
          onSaveToContacts={
            !contactModalTarget.isSavedContact &&
            (contactModalTarget.phone || contactModalTarget.virtualLine)
              ? async () => {
                  const phoneOrLine =
                    contactModalTarget.phone || contactModalTarget.virtualLine || '';
                  await saveRealContactToPhonebook({
                    ownerId: profile.uid,
                    name: contactModalTarget.name,
                    phone: phoneOrLine,
                  });
                  setContactModalTarget((prev) =>
                    prev ? { ...prev, isSavedContact: true } : null
                  );
                  showToast('Contato salvo na sua agenda!');
                }
              : undefined
          }
          onToggleFavorite={() =>
            toggleIdsInPrefList('favoriteChatIds', [contactModalTarget.chatId], {
              added: 'Adicionada aos favoritos.',
              removed: 'Removida dos favoritos.',
            })
          }
          onToggleMute={() =>
            toggleIdsInPrefList('mutedChatIds', [contactModalTarget.chatId], {
              added: 'Notificações silenciadas.',
              removed: 'Notificações reativadas.',
            })
          }
          onToggleLock={() => {
            const cId = contactModalTarget.chatId;
            const name = contactModalTarget.name;
            setContactModalTarget(null);
            handleRequestToggleLockChats([cId], name);
          }}
          onOpenAddToList={() => {
            const cId = contactModalTarget.chatId;
            const name = contactModalTarget.name;
            setContactModalTarget(null);
            setAddToListTarget({ chatIds: [cId], title: name });
          }}
          onOpenShortcut={() => {
            const t = contactModalTarget;
            setContactModalTarget(null);
            setShortcutModalTarget({
              chatId: t.chatId,
              peerUid: t.uid,
              peerName: t.name,
            });
          }}
          onClearChat={() => {
            const t = contactModalTarget;
            setContactModalTarget(null);
            setChatConfirmModal({
              kind: 'clear',
              chatIds: [t.chatId],
              peerUids: [t.uid],
              targetName: t.name,
            });
          }}
          onToggleBlock={() => {
            const t = contactModalTarget;
            const blocked = chatPrefs.blockedUids.includes(t.uid);
            setContactModalTarget(null);
            setChatConfirmModal({
              kind: blocked ? 'unblock' : 'block',
              chatIds: [t.chatId],
              peerUids: [t.uid],
              targetName: t.name,
            });
          }}
        />
      )}

      {/* Adicionar atalho para conversa */}
      {shortcutModalTarget && (
        <ChatShortcutModal
          peerName={shortcutModalTarget.peerName}
          peerUid={shortcutModalTarget.peerUid}
          hasShortcut={chatPrefs.shortcutChatIds.includes(shortcutModalTarget.chatId)}
          onToggleInAppShortcut={() => {
            const cId = shortcutModalTarget.chatId;
            const exists = chatPrefs.shortcutChatIds.includes(cId);
            updateChatPrefs((prev) => ({
              ...prev,
              shortcutChatIds: exists
                ? prev.shortcutChatIds.filter((id) => id !== cId)
                : [cId, ...prev.shortcutChatIds.filter((id) => id !== cId)],
            }));
            exitChatSelection();
            showToast(
              exists
                ? 'Atalho removido dos atalhos rápidos.'
                : 'Atalho adicionado ao topo das conversas!'
            );
          }}
          onNotify={showToast}
          onClose={() => setShortcutModalTarget(null)}
        />
      )}

      {/* Senha para Trancar / Destrancar conversas */}
      {lockPinModal && (
        <ChatLockPinModal
          mode={lockPinModal.mode}
          targetLabel={lockPinModal.targetLabel}
          onSubmitPin={async (pin) => {
            if (lockPinModal.mode === 'create_and_lock') {
              const hash = await hashChatLockPin(pin);
              updateChatPrefs((prev) => ({
                ...prev,
                lockPinHash: hash,
                lockedChatIds: Array.from(
                  new Set([...prev.lockedChatIds, ...lockPinModal.chatIds])
                ),
                archivedChatIds: prev.archivedChatIds.filter(
                  (id) => !lockPinModal.chatIds.includes(id)
                ),
              }));
              if (
                selectedPeer &&
                lockPinModal.chatIds.includes(
                  getDeterministicChatId(profile.uid, selectedPeer.uid)
                )
              ) {
                setSelectedPeer(null);
              }
              setLockPinModal(null);
              exitChatSelection();
              showToast('Senha criada e conversa trancada!');
              return { ok: true };
            }

            const valid = await verifyChatLockPin(pin, chatPrefs.lockPinHash || '');
            if (!valid) {
              return { ok: false, error: 'Senha incorreta. Tente novamente.' };
            }

            if (lockPinModal.mode === 'verify_to_remove') {
              updateChatPrefs((prev) => ({
                ...prev,
                lockedChatIds: prev.lockedChatIds.filter(
                  (id) => !lockPinModal.chatIds.includes(id)
                ),
              }));
              setLockPinModal(null);
              exitChatSelection();
              showToast('Conversa destrancada.');
              return { ok: true };
            }

            const cb = lockPinModal.onAfterUnlock;
            setLockPinModal(null);
            cb?.();
            return { ok: true };
          }}
          onClose={() => setLockPinModal(null)}
        />
      )}

      {/* Adicionar à lista */}
      {addToListTarget && (
        <AddToListModal
          targetChatIds={addToListTarget.chatIds}
          targetTitle={addToListTarget.title}
          lists={chatPrefs.customLists}
          onToggleChatInList={(listId, chatIds) => {
            updateChatPrefs((prev) => ({
              ...prev,
              customLists: prev.customLists.map((l) => {
                if (l.id !== listId) return l;
                const allIn = chatIds.every((id) => l.chatIds.includes(id));
                const nextSet = new Set(l.chatIds);
                if (allIn) {
                  for (const id of chatIds) nextSet.delete(id);
                } else {
                  for (const id of chatIds) nextSet.add(id);
                }
                return { ...l, chatIds: Array.from(nextSet) };
              }),
            }));
          }}
          onCreateListAndAdd={(name, chatIds) => {
            const newId = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            updateChatPrefs((prev) => ({
              ...prev,
              customLists: [
                ...prev.customLists,
                {
                  id: newId,
                  name,
                  chatIds: Array.from(new Set(chatIds)),
                  createdAtMs: Date.now(),
                },
              ],
            }));
            showToast(`Lista "${name}" criada!`);
          }}
          onDeleteList={(listId) => {
            updateChatPrefs((prev) => ({
              ...prev,
              customLists: prev.customLists.filter((l) => l.id !== listId),
            }));
            if (chatListFilter === `list:${listId}`) {
              setChatListFilter('all');
            }
            showToast('Lista removida.');
          }}
          onClose={() => {
            setAddToListTarget(null);
            exitChatSelection();
          }}
        />
      )}

      {/* Confirmação de Limpar conversa / Apagar conversa / Bloquear */}
      {chatConfirmModal && (
        <ChatActionConfirmModal
          kind={chatConfirmModal.kind}
          count={
            chatConfirmModal.kind === 'block' || chatConfirmModal.kind === 'unblock'
              ? chatConfirmModal.peerUids.length
              : chatConfirmModal.chatIds.length
          }
          targetName={chatConfirmModal.targetName}
          onConfirm={async (opts) => {
            const modal = chatConfirmModal;
            setChatConfirmModal(null);
            if (modal.kind === 'clear' || modal.kind === 'delete_chat') {
              await handleExecuteClearOrDeleteChats(
                modal.kind,
                modal.chatIds,
                opts?.deleteLocalMedia !== false
              );
            } else {
              handleExecuteBlockToggle(modal.peerUids, modal.kind);
            }
          }}
          onClose={() => setChatConfirmModal(null)}
        />
      )}

      {/* Central de Ajuda e Suporte */}
      <HelpCenterModal
        open={helpModalOpen}
        onClose={() => setHelpModalOpen(false)}
        profile={profile}
        orders={effectiveOrders}
        tickets={supportTickets}
        deliveryReports={deliveryReports}
        adminTickets={adminTickets}
        commercialBans={commercialBans}
        isSupportAdmin={isSupportAdmin}
        initialContext={helpModalContext}
        onSubmitTicket={async ({ reason, orderId, orderCode, description }) => {
          const res = await createSupportTicket({
            userId: profile.uid,
            userName: profile.name,
            userVirtualLine: profile.virtualLine || profile.phone,
            userRole: profile.commercialMode,
            reason,
            orderId,
            orderCode,
            description,
          });
          showToast(
            `Chamado ${res.ticketCode} aberto! Nossa equipe analisará em breve.`
          );
          return res;
        }}
        onResolveTicket={async (ticketId) => {
          await resolveSupportTicket(ticketId, profile.uid);
          showToast('Chamado marcado como resolvido.');
        }}
        onAdminUpdateReportStatus={
          isSupportAdmin
            ? async ({ reportId, status, resolutionNote }) => {
                await updateDeliveryReportStatus({
                  reportId,
                  status,
                  adminUid: profile.uid,
                  resolutionNote,
                });
                showToast(`Ocorrência atualizada para "${status}".`);
              }
            : undefined
        }
        onAdminBanCommercial={
          isSupportAdmin
            ? async ({ targetUid, targetName, reason, reportId, ticketId, orderCode }) => {
                await banUserCommercialRoles({
                  targetUid,
                  targetName,
                  reason,
                  adminUid: profile.uid,
                  reportId,
                  ticketId,
                  orderCode,
                });
                showToast(
                  `Modos comerciais de ${targetName} suspensos (uso pessoal preservado).`
                );
              }
            : undefined
        }
        onAdminLiftCommercialBan={
          isSupportAdmin
            ? async ({ targetUid, liftNote, reportId, ticketId }) => {
                await liftCommercialBan({
                  targetUid,
                  adminUid: profile.uid,
                  liftNote,
                  reportId,
                  ticketId,
                });
                showToast('Modos Fabricante e Revendedor liberados e reativados.');
              }
            : undefined
        }
        onOpenOfficialSupportChat={handleOpenOfficialSupportChat}
      />
    </div>
  );
}
