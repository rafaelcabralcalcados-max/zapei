import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Clock,
  Factory,
  Loader2,
  MessageSquare,
  Phone,
  Search,
  Settings,
  Store,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  approveDeviceAuthRequest,
  auth,
  createDeviceAuthRequest,
  createRealFactoryConnection,
  createRealMixedOrder,
  createRealProduct,
  db,
  deletePhonebookContact,
  disconnectUserDevice,
  ensureCurrentDeviceRegisteredSilently,
  fetchPublicUserStorefront,
  fetchUserProfileOnce,
  getDeterministicChatId,
  lookupRegisteredUserByPhone,
  markContactInvited,
  registerOrCheckCurrentDevice,
  registerOrUpdateUserProfile,
  rejectDeviceAuthRequest,
  resyncAllPhonebookContacts,
  saveRealContactToPhonebook,
  sendRealChatMessage,
  signOutFirebase,
  subscribeAuthRequestById,
  subscribeChatMessages,
  subscribeConnections,
  subscribeFirebaseAuth,
  subscribeOrdersAndSubOrders,
  subscribePayments,
  subscribePendingAuthRequestsForUser,
  subscribeProducts,
  subscribePublicDirectory,
  subscribeUserCalls,
  subscribeUserChats,
  subscribeUserContacts,
  subscribeUserDevices,
  subscribeUserProfile,
  syncPublicDirectoryEntry,
  takeOverAsPrimaryDevice,
  updateRealConnection,
  updateRealOrder,
  updateRealPayment,
  updateRealProductStock,
  updateRealSubOrder,
  updateUserPresenceHeartbeat,
  updateUserPresencePrivacy,
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
  playMessageSentSound,
  queryMediaPermissionSnapshot,
  startRealOutgoingCall,
  updateRealCallStatus,
  type RealWebRTCSessionHandle,
  type VideoQualityMode,
} from './lib/webrtcService';
import {
  enableRealBackgroundCallPush,
  syncExistingPushSubscriptionWithRetry,
  triggerRemoteCallPush,
} from './lib/pushService';
import {
  formatPacketTimeLabel,
  installConnectivitySyncListeners,
  isDeviceOnline,
  packetToChatMessage,
  sendOrQueueMessage,
  subscribeOutbox,
  type ZapeiMessagePacket,
} from './lib/messageTransport';
import { getLocalMedia } from './lib/localMediaCache';
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
import { calculateOrderSplit } from './lib/splitCalculator';
import {
  createAsaasSplitCharge,
  fetchAsaasOrderStatus,
  type AsaasOrderStatusResult,
  type CreateAsaasChargeResult,
} from './lib/asaasService';
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
  CommercialMode,
  ConnectedDevice,
  Contact,
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
  ChatThreadView,
  type ActiveChatPeer,
  type ForwardTarget,
} from './components/ChatThreadView';
import { ContactsView } from './components/ContactsView';
import { DeviceApprovalModal } from './components/DeviceApprovalModal';
import { DeviceAuthorizationGate } from './components/DeviceAuthorizationGate';
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
  const [products, setProducts] = useState<Product[]>([]);
  const [connections, setConnections] = useState<FactoryConnection[]>([]);
  const [orders, setOrders] = useState<MixedOrder[]>([]);
  const [payments, setPayments] = useState<DualPaymentRecord[]>([]);

  // Active Chat Thread & Messages
  const [selectedPeer, setSelectedPeer] = useState<ActiveChatPeer | null>(null);
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);

  // Real WebRTC Call State
  const [activeCall, setActiveCall] = useState<ActiveCallUIState | null>(null);
  const webrtcHandleRef = useRef<RealWebRTCSessionHandle | null>(null);
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
  const seenActiveMsgIdsRef = useRef<Set<string>>(new Set());
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
        setCalls([]);
        setProducts([]);
        setConnections([]);
        setOrders([]);
        setPayments([]);
        setSelectedPeer(null);
        setActiveMessages([]);
        setActiveStorefrontOwner(null);
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
    seenChatSigRef.current.clear();
    const unsubs = [
      subscribeUserContacts(uid, setContacts),
      subscribePublicDirectory(uid, setDirectoryUsers),
      subscribeUserChats(uid, setChats),
      subscribeUserCalls(uid, setCalls),
      subscribeProducts(uid, setProducts),
      subscribeConnections(uid, setConnections),
      subscribeOrdersAndSubOrders(uid, setOrders),
      subscribePayments(uid, setPayments),
    ];
    return () => unsubs.forEach((u) => u());
  }, [authUid, profileUid, deviceAuthState]);

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
    const publish = (onlineNow: boolean) => {
      void updateUserPresenceHeartbeat(authUid, {
        isOnline: onlineNow,
        showOnlineStatus: showOnlineSetting,
        showLastSeen: showLastSeenSetting,
      });
    };

    const isVisible =
      typeof document === 'undefined' || document.visibilityState === 'visible';
    publish(isVisible);

    // Only keep periodic heartbeat running if user exposes online or last seen
    const intervalId =
      showOnlineSetting || showLastSeenSetting
        ? window.setInterval(() => {
            if (document.visibilityState === 'visible') {
              publish(true);
            }
          }, 45_000)
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
      seenActiveMsgIdsRef.current.clear();
      return undefined;
    }
    const chatId = getDeterministicChatId(authUser.uid, selectedPeer.uid);
    seenActiveMsgIdsRef.current.clear();
    return subscribeChatMessages(chatId, authUser.uid, setActiveMessages);
  }, [authUser, selectedPeer?.uid]);

  // 4b. WhatsApp-style incoming text/audio/photo message chime & floating banner across ALL chats
  useEffect(() => {
    if (!profile) {
      seenChatSigRef.current.clear();
      return;
    }

    const isInitialHydrationWindow = Date.now() - chatsSubStartedAtRef.current < 2500;
    let newestIncoming: ChatThreadSummary | null = null;
    for (const c of chats) {
      const sig = `${c.updatedAtMs}|${c.lastSenderId || ''}|${c.lastMessage}`;
      const prevSig = seenChatSigRef.current.get(c.id);
      seenChatSigRef.current.set(c.id, sig);

      const isBrandNewChatAfterBoot = prevSig === undefined && !isInitialHydrationWindow;
      const isUpdatedExistingChat = prevSig !== undefined && prevSig !== sig;

      if (
        (isBrandNewChatAfterBoot || isUpdatedExistingChat) &&
        c.lastSenderId &&
        c.lastSenderId !== profile.uid &&
        c.lastMessage
      ) {
        if (!newestIncoming || c.updatedAtMs >= newestIncoming.updatedAtMs) {
          newestIncoming = c;
        }
      }
    }

    if (newestIncoming) {
      const lowerPreview = (newestIncoming.lastMessage || '').toLowerCase();
      const isIncomingAudio =
        lowerPreview.startsWith('mensagem de voz') ||
        lowerPreview.startsWith('áudio') ||
        lowerPreview.startsWith('audio') ||
        newestIncoming.lastMessage.startsWith('🎤');
      playMessageNotificationSound(isIncomingAudio ? 'audio' : 'text');

      const viewingSameChat =
        activeTab === 'chats' && selectedPeer?.uid === newestIncoming.otherUid;
      if (!viewingSameChat) {
        const contactMatch = contacts.find((ct) => ct.matchedUid === newestIncoming.otherUid);
        const dirMatch = directoryUsers.find((u) => u.uid === newestIncoming.otherUid);
        const senderName =
          contactMatch?.name || dirMatch?.displayName || newestIncoming.otherName || 'Nova mensagem';
        showIncomingMsgBanner({
          senderId: newestIncoming.otherUid,
          senderName,
          initials: getInitials(senderName),
          avatarBg: contactMatch?.avatarBg || dirMatch?.avatarColor || '#0E7A34',
          avatarUrl: dirMatch?.avatarUrl,
          preview: newestIncoming.lastMessage,
        });
      }
    }
  }, [chats, profile, activeTab, selectedPeer?.uid, contacts, directoryUsers, showIncomingMsgBanner]);

  // 4c. Chime when a new text/audio/photo arrives inside the currently open chat thread
  useEffect(() => {
    if (!profile || !selectedPeer || activeMessages.length === 0) return;
    if (seenActiveMsgIdsRef.current.size === 0) {
      for (const m of activeMessages) seenActiveMsgIdsRef.current.add(m.id);
      return;
    }
    let newPeerKind: 'text' | 'audio' | null = null;
    for (const m of activeMessages) {
      if (!seenActiveMsgIdsRef.current.has(m.id)) {
        seenActiveMsgIdsRef.current.add(m.id);
        if (m.senderId !== profile.uid) {
          newPeerKind = m.type === 'audio' ? 'audio' : 'text';
        }
      }
    }
    if (newPeerKind) {
      playMessageNotificationSound(newPeerKind);
    }
  }, [activeMessages, profile, selectedPeer]);

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
        ignoredCallIdsRef.current.has(c.id)
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
            reg.showNotification(
              incoming.callType === 'video'
                ? `Chamada de vídeo · ${incoming.callerName}`
                : `Ligação de voz · ${incoming.callerName}`,
              {
                body: 'ChatFi está chamando · Toque para atender agora',
                icon: '/pwa-192x192.png',
                badge: '/pwa-192x192.png',
                tag: `zapei-call-${incoming.id}`,
                requireInteraction: true,
                data: {
                  type: 'incoming_call',
                  callId: incoming.id,
                  url: `/?incomingCall=${encodeURIComponent(incoming.id)}`,
                },
              }
            )
          )
          .catch(() => {});
      }
    }
  }, [calls, profile, activeCall, directoryUsers]);

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

  // --- CHAT & STOREFRONT NAVIGATION HANDLERS ---

  const openChatWithPeer = useCallback(
    async (peer: ActiveChatPeer) => {
      const livePhoto =
        peer.avatarUrl || directoryUsers.find((u) => u.uid === peer.uid)?.avatarUrl;
      setSelectedPeer({ ...peer, avatarUrl: livePhoto });
      setActiveTab('chats');
      // Refresh live storefront info for this peer
      const live = await fetchPublicUserStorefront(peer.uid);
      if (live) {
        setSelectedPeer((curr) =>
          curr && curr.uid === peer.uid
            ? {
                ...curr,
                hasStorefront:
                  live.hasStorefront && live.subscriptionStatus !== 'expired',
                storefrontName: live.storefrontName,
                role:
                  live.commercialMode === 'manufacturer'
                    ? 'manufacturer'
                    : live.commercialMode === 'reseller'
                      ? 'reseller'
                      : 'normal',
                deliveryPolicyLabel: live.deliveryPolicy.label,
              }
            : curr
        );
      }
    },
    [directoryUsers]
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
              role:
                live.commercialMode === 'manufacturer'
                  ? 'manufacturer'
                  : live.commercialMode === 'reseller'
                    ? 'reseller'
                    : 'normal',
              hasStorefront: live.hasStorefront && live.subscriptionStatus !== 'expired',
              storefrontName: live.storefrontName,
              deliveryPolicyLabel: live.deliveryPolicy.label,
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
      window.history.replaceState({}, '', '/');
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
        if (msg.payload.senderId !== profile.uid) {
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
            if ((item.kind === 'image' || item.kind === 'audio') && blob.size <= 330 * 1024) {
              const dataUrl = await blobToDataUrl(blob);
              await sendOrQueueMessage(
                {
                  senderId: profile.uid,
                  senderName: profile.name,
                  recipientId: target.uid,
                  recipientName: target.name,
                  type: item.kind,
                  text:
                    item.kind === 'audio'
                      ? `Mensagem de voz (${item.durationLabel || '0:00'})`
                      : (idx === 0 && caption) || 'Foto',
                  mediaUrl: dataUrl,
                  audioDuration: item.kind === 'audio' ? item.durationLabel || '0:00' : undefined,
                  pushPreviewText:
                    item.kind === 'audio'
                      ? `Áudio (${item.durationLabel || '0:00'})`
                      : caption
                        ? `Foto: ${caption}`
                        : 'Enviou uma foto',
                  pushMessageType: item.kind,
                },
                authUser
              );
            } else {
              throw new Error(
                'Sem conexão para enviar arquivos grandes compartilhados. Conecte-se à internet e tente novamente.'
              );
            }
          } else {
            await sendMediaWithTransitBridge({
              myUid: profile.uid,
              myName: profile.name,
              recipientId: target.uid,
              recipientName: target.name,
              mediaType: item.kind,
              blob,
              mimeType,
              durationLabel:
                item.kind === 'audio'
                  ? item.durationLabel || '0:00'
                  : item.kind === 'video'
                    ? item.durationLabel || undefined
                    : undefined,
              caption:
                item.kind === 'image' || item.kind === 'video'
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

      playMessageSentSound();
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

      const alreadyActivated =
        (targetMode === 'manufacturer' && profile.manufacturerActivated) ||
        (targetMode === 'reseller' && profile.resellerActivated);

      if (!alreadyActivated) {
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
    async (businessName: string) => {
      if (!profile || !trialPromptRole) return;
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
          ? `Fábrica "${cleanedName}" ativada! Você já pode cadastrar seus produtos.`
          : `Vitrine "${cleanedName}" ativada! Você já pode conectar seus fornecedores.`
      );
    },
    [profile, trialPromptRole, persistProfileUpdate, showToast]
  );

  const handleConfirmConference = useCallback(
    async (
      sub: SubOrder,
      decisions: Record<string, 'available' | 'unavailable'>
    ) => {
      const updatedItems = sub.items.map((item) => ({
        ...item,
        availability: decisions[item.id] ?? 'available',
      }));

      // Deduct stock for confirmed available items
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
      });

      // Recompute parent order totals & Split breakdown & Layer 2 payment
      const parent = orders.find((o) => o.id === sub.parentOrderId);
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
          });
        }
      }
    },
    [products, orders, profile]
  );

  // Reseller-side automatic Layer 2 reconciliation when a connected factory performs a partial stock cut
  useEffect(() => {
    if (!profile) return;
    for (const order of orders) {
      if (order.resellerId !== profile.uid) continue;
      const layer2Pay = payments.find(
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
  }, [orders, payments, profile]);

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

  const handleConnectFactoryByPhone = useCallback(
    async (rawPhone: string): Promise<{ ok: boolean; message: string }> => {
      if (!profile) return { ok: false, message: 'Sessão inválida.' };
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
      if (match.role !== 'manufacturer') {
        return {
          ok: false,
          message: `${match.displayName} está no ChatFi, mas ainda não ativou o perfil de Fabricante.`,
        };
      }
      await createRealFactoryConnection({
        resellerId: profile.uid,
        factory: match,
      });
      return {
        ok: true,
        message: `Fábrica "${match.displayName}" conectada com sucesso! Configure suas margens por categoria abaixo.`,
      };
    },
    [profile]
  );

  // Derived lists & WhatsApp-style unified search
  const directoryByUid = useMemo(() => {
    const map = new Map<string, PublicDirectoryUser>();
    for (const u of directoryUsers) {
      map.set(u.uid, u);
    }
    return map;
  }, [directoryUsers]);

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

  // Merge Firestore cached/live chats with locally queued offline messages
  const mergedChats = useMemo(() => {
    if (!profile || myOutboxPackets.length === 0) return chats;
    const map = new Map<string, ChatThreadSummary>();
    for (const c of chats) {
      map.set(c.id, c);
    }
    for (const pkt of myOutboxPackets) {
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
    return Array.from(map.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [chats, myOutboxPackets, profile]);

  // Merge Firestore active chat messages with any pending offline outbox messages for this peer
  const mergedActiveMessages = useMemo(() => {
    if (!profile || !selectedPeer) return activeMessages;
    const activeChatId = getDeterministicChatId(profile.uid, selectedPeer.uid);
    const pendingForChat = pendingOutboxByChatId.get(activeChatId);
    if (!pendingForChat || pendingForChat.length === 0) return activeMessages;

    const existingIds = new Set(activeMessages.map((m) => m.id));
    const extras = pendingForChat
      .filter((pkt) => !existingIds.has(pkt.id))
      .map(packetToChatMessage);
    if (extras.length === 0) return activeMessages;
    return [...activeMessages, ...extras];
  }, [activeMessages, pendingOutboxByChatId, profile, selectedPeer]);

  const filteredChats = useMemo(() => {
    if (!normalizedChatQuery) return mergedChats;
    return mergedChats.filter((c) => {
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
    });
  }, [mergedChats, contacts, directoryByUid, normalizedChatQuery]);

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
    () => orders.flatMap((o) => o.subOrders),
    [orders]
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
          await registerOrUpdateUserProfile({
            uid: authUser.uid,
            email: authUser.email || '',
            displayName: name,
            phone,
            statusMessage,
            avatarUrl,
          });
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
    return (
      <DeviceAuthorizationGate
        userName={profile.name}
        userIdentifier={profile.virtualLine || profile.phone}
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

  const hasCommercialPanel = profile.commercialMode !== 'buyer';

  const navItems: Array<{
    id: MainTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'chats', label: 'Conversas', icon: MessageSquare },
    { id: 'calls', label: 'Ligações', icon: Phone },
    { id: 'contacts', label: 'Contatos', icon: Users },
    ...(hasCommercialPanel
      ? [
          {
            id: 'commercial' as MainTab,
            label: profile.commercialMode === 'manufacturer' ? 'Fábrica' : 'Vitrine',
            icon: profile.commercialMode === 'manufacturer' ? Factory : Briefcase,
          },
        ]
      : []),
    { id: 'settings', label: 'Ajustes', icon: Settings },
  ];

  const mobileInChat = activeTab === 'chats' && Boolean(selectedPeer);

  return (
    <div className="flex h-[100dvh] w-full max-w-full overflow-hidden bg-[#F8FAFC] text-slate-900">
      {/* Desktop Left Navigation Rail */}
      <aside className="hidden md:flex md:w-20 lg:w-60 shrink-0 flex-col justify-between border-r border-slate-200 bg-[#0D2B3E] text-white">
        <div>
          <div className="border-b border-white/10 p-3">
            <div className="flex w-full items-center justify-center lg:justify-start gap-2.5 rounded-xl p-2 hover:bg-white/10 transition">
              <button
                type="button"
                onClick={() =>
                  setAvatarPreview({
                    name: profile.name,
                    initials: profile.initials,
                    avatarBg: profile.avatarBg,
                    avatarUrl: profile.avatarUrl,
                    subtitle: profile.virtualLine || profile.phone,
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
                    className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white/25"
                  />
                ) : (
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white/20"
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
                <p className="truncate font-mono text-[11px] text-slate-300 tabular-nums">
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
                  className={`flex min-h-[44px] w-full items-center justify-center lg:justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    active
                      ? 'bg-[#0E7A34] text-white shadow-sm'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="hidden lg:inline truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center justify-center lg:justify-start gap-3 px-4 py-4 border-t border-white/10">
          <ChatFiLogo className="h-10 w-10 shrink-0 rounded-xl shadow-sm" />
          <div className="hidden lg:block min-w-0">
            <span className="block text-base font-extrabold tracking-tight">ChatFi</span>
            <span className="block truncate text-[11px] text-emerald-200/80">
              {profile.commercialMode === 'manufacturer'
                ? 'Fabricante'
                : profile.commercialMode === 'reseller'
                  ? 'Revendedor'
                  : 'Mensageiro Grátis'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Mobile Compact Top Header (hidden when inside an active mobile chat thread) */}
        {!mobileInChat && (
          <header className="flex md:hidden items-center justify-between gap-2 border-b border-slate-200 bg-[#0D2B3E] px-3.5 pb-2.5 pt-safe text-white shrink-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <ChatFiLogo className="h-8 w-8 shrink-0 rounded-lg shadow-sm" />
              <span className="truncate text-base font-extrabold tracking-tight">ChatFi</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <PWAInstallButton compact />
            </div>
          </header>
        )}

        {/* Floating Incoming Message Alert Banner */}
        {incomingMsgBanner && (
          <div className="fixed left-3 right-3 sm:left-auto sm:right-4 top-3 z-50 sm:w-96 pt-safe">
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-white/95 p-3 shadow-xl backdrop-blur">
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
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {activeTab === 'chats' && (
            <div className="flex h-full min-h-0 w-full overflow-hidden">
              {/* Chat List Sidebar */}
              <section
                className={`w-full md:w-80 lg:w-96 shrink-0 flex-col border-r border-slate-200 bg-white ${
                  selectedPeer ? 'hidden md:flex' : 'flex'
                }`}
              >
                <div className="border-b border-slate-100 p-3.5">
                  <div className="flex items-center justify-between">
                    <h1 className="text-base font-bold text-slate-900">Conversas</h1>
                    <button
                      type="button"
                      onClick={() => setActiveTab('contacts')}
                      className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[#0E7A34] hover:bg-emerald-100"
                    >
                      + Nova conversa
                    </button>
                  </div>
                  <div className="relative mt-2.5">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      inputMode="search"
                      name="chatfi_chat_search"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder="Buscar conversa, contato, telefone ou CFI-..."
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm focus:border-[#0E7A34] focus:bg-white focus:outline-none"
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
                </div>

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
                        const isSelected = selectedPeer?.uid === thread.otherUid;
                        return (
                          <div
                            key={thread.id}
                            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                              isSelected ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setAvatarPreview({
                                  name: displayName,
                                  initials: getInitials(displayName),
                                  avatarBg,
                                  avatarUrl: photoUrl,
                                  subtitle: matchedContact?.phone || dir?.virtualLine,
                                })
                              }
                              title={`Ver foto de ${displayName}`}
                              aria-label={`Ampliar foto de ${displayName}`}
                              className="relative shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/40"
                            >
                              {photoUrl ? (
                                <img
                                  src={photoUrl}
                                  alt={displayName}
                                  className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                                />
                              ) : (
                                <div
                                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                                  style={{ backgroundColor: avatarBg }}
                                >
                                  {getInitials(displayName)}
                                </div>
                              )}
                              {isUserEffectivelyOnline(dir) && (
                                <span
                                  className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-[#0E7A34] ring-2 ring-white"
                                  aria-label="Online"
                                />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
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
                                })
                              }
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-bold text-slate-900">
                                  {displayName}
                                </span>
                                <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                                  {thread.updatedAtLabel}
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center justify-between gap-2">
                                <p className="flex min-w-0 items-center gap-1 truncate text-xs text-slate-500">
                                  {(pendingOutboxByChatId.get(thread.id)?.length || 0) > 0 && (
                                    <Clock
                                      className="h-3.5 w-3.5 shrink-0 text-amber-600"
                                      aria-label="Aguardando rede"
                                    />
                                  )}
                                  <span className="truncate">
                                    {thread.lastMessage || 'Conversa iniciada'}
                                  </span>
                                </p>
                                {(matchedContact?.hasStorefront || dir?.hasStorefront) && (
                                  <Store className="h-3.5 w-3.5 shrink-0 text-[#0E7A34]" />
                                )}
                              </div>
                            </button>
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
                                  subtitle: person.phone || person.subtitle,
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
                    peer={selectedPeer}
                    peerPresence={directoryByUid.get(selectedPeer.uid) ?? null}
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
                    onSendText={async (text) => {
                      const { queuedOffline } = await sendOrQueueMessage(
                        {
                          senderId: profile.uid,
                          senderName: profile.name,
                          recipientId: selectedPeer.uid,
                          recipientName: selectedPeer.name,
                          type: 'text',
                          text,
                          pushPreviewText: text,
                          pushMessageType: 'text',
                        },
                        authUser
                      );
                      playMessageSentSound();
                      if (queuedOffline) {
                        showToast('Salva na fila — será enviada assim que o sinal voltar.');
                      }
                    }}
                    onSendAudio={async (audioBlob, audioDuration) => {
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
                              text: `Mensagem de voz (${audioDuration})`,
                              mediaUrl: dataUrl,
                              audioDuration,
                              pushPreviewText: `Áudio (${audioDuration})`,
                              pushMessageType: 'audio',
                            },
                            authUser
                          );
                          playMessageSentSound();
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
                        authUser,
                      });
                      playMessageSentSound();
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
                          playMessageSentSound();
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
                      playMessageSentSound();
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
                      playMessageSentSound();
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
                          mimeType: cached?.mimeType || blobToSend.type,
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
                        playMessageSentSound();
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
                      playMessageSentSound();
                      showToast(
                        queuedOffline
                          ? `Salvo na fila para ${target.name} (aguardando rede).`
                          : `Encaminhado para ${target.name}!`
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
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                    <ChatFiLogo className="h-20 w-20 rounded-3xl shadow-md ring-8 ring-emerald-50" />
                    <h2 className="mt-5 text-lg font-bold text-slate-900">
                      ChatFi Mensageiro em Tempo Real
                    </h2>
                    <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
                      Selecione uma conversa à esquerda ou abra sua agenda de contatos para enviar mensagens, gravar áudios, enviar fotos ou fazer chamadas reais de voz e vídeo.
                    </p>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'calls' && (
            <CallsView
              myUid={profile.uid}
              calls={calls}
              zapeiContacts={zapeiContacts}
              directoryUsers={directoryUsers}
              onStartCallWithPeer={(peer, type) => void handleStartCall(peer, type)}
            />
          )}

          {activeTab === 'contacts' && (
            <ContactsView
              currentUserUid={profile.uid}
              contacts={contacts}
              directoryUsers={directoryUsers}
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

          {activeTab === 'commercial' && profile.commercialMode === 'manufacturer' && (
            <ManufacturerPanel
              profile={profile}
              products={products}
              subOrders={allSubOrders}
              orders={orders}
              payments={payments}
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
                const parent = orders.find((o) => o.id === sub.parentOrderId);
                if (parent) {
                  const allDispatched = parent.subOrders.every(
                    (s) => s.id === sub.id || s.status === 'dispatched'
                  );
                  if (allDispatched) {
                    await updateRealOrder(parent.id, { status: 'dispatched' });
                  }
                }
              }}
              onUpdatePayment={(paymentId, updates) =>
                updateRealPayment(paymentId, updates)
              }
              onOpenBilling={() => setShowBillingModal(true)}
            />
          )}

          {activeTab === 'commercial' && profile.commercialMode === 'reseller' && (
            <ResellerPanel
              profile={profile}
              connections={connections}
              products={products}
              orders={orders}
              payments={payments}
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
              onUpdateConnection={(
                connectionId: string,
                updates: Partial<{
                  reviewPhotos: boolean;
                  paused: boolean;
                  margins: Record<string, CategoryMargin>;
                  approvedProductIds: string[];
                  rejectedProductIds: string[];
                }>
              ) => updateRealConnection(connectionId, updates)}
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
                await updateRealPayment(pay.id, { lastReminderSent: nowLabel });
              }}
              onGenerateAsaasCharge={handleGenerateAsaasChargeForOrder}
              onSyncAsaasStatus={handleSyncAsaasOrderStatus}
              onOpenMyStorefrontPreview={() => void openStorefrontByUid(profile.uid)}
              onOpenBilling={() => setShowBillingModal(true)}
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

        {/* Mobile Bottom Navigation Bar */}
        {!mobileInChat && (
          <nav className="fixed bottom-0 left-0 right-0 z-30 flex md:hidden w-full max-w-full items-center justify-around border-t border-slate-200 bg-white px-1 pt-1.5 pb-safe shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex min-h-[46px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 text-[11px] font-semibold transition ${
                    active ? 'text-[#0E7A34]' : 'text-slate-500'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="w-full truncate text-center">{item.label}</span>
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
          orders={orders}
          initialSubView={activeStorefrontInitialTab}
          onClose={() => {
            setActiveStorefrontOwner(null);
            setActiveStorefrontInitialTab('catalog');
          }}
          onGenerateOrderCharge={handleGenerateAsaasChargeForOrder}
          onSyncOrderStatus={handleSyncAsaasOrderStatus}
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

      {/* 1-Step Commercial Activation Modal (Company/Storefront Name + 30-Day Free Trial) */}
      {trialPromptRole && (
        <CommercialTrialModal
          targetRole={trialPromptRole}
          alreadyOnPlan={profile.subscriptionStatus !== 'free'}
          onConfirm={handleConfirmTrialActivation}
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
    </div>
  );
}
