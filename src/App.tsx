import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Factory,
  Loader2,
  MessageSquare,
  Phone,
  Search,
  Settings,
  Store,
  Users,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  createRealFactoryConnection,
  createRealMixedOrder,
  createRealProduct,
  db,
  deletePhonebookContact,
  fetchPublicUserStorefront,
  getDeterministicChatId,
  lookupRegisteredUserByPhone,
  markContactInvited,
  registerOrUpdateUserProfile,
  resyncAllPhonebookContacts,
  saveRealContactToPhonebook,
  sendRealChatMessage,
  signOutFirebase,
  subscribeChatMessages,
  subscribeConnections,
  subscribeFirebaseAuth,
  subscribeOrdersAndSubOrders,
  subscribePayments,
  subscribeProducts,
  subscribePublicDirectory,
  subscribeUserCalls,
  subscribeUserChats,
  subscribeUserContacts,
  subscribeUserProfile,
  syncPublicDirectoryEntry,
  updateRealConnection,
  updateRealOrder,
  updateRealPayment,
  updateRealProductStock,
  updateRealSubOrder,
  type PublicDirectoryUser,
} from './lib/firebase';
import {
  answerRealIncomingCall,
  startRealOutgoingCall,
  updateRealCallStatus,
  type RealWebRTCSessionHandle,
} from './lib/webrtcService';
import {
  enableRealBackgroundCallPush,
  syncExistingPushSubscription,
  triggerRemoteCallPush,
  triggerRemoteMessagePush,
  type BackgroundPushStatus,
} from './lib/pushService';
import { formatBRL, getInitials } from './lib/gradeParser';
import { formatPhoneDisplay } from './lib/phoneUtils';
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
  UserProfile,
} from './types/zapei';
import { ActiveCallModal, type ActiveCallUIState } from './components/ActiveCallModal';
import { CallsView } from './components/CallsView';
import { ChatThreadView, type ActiveChatPeer } from './components/ChatThreadView';
import { ContactsView } from './components/ContactsView';
import { ManufacturerPanel } from './components/ManufacturerPanel';
import { PhoneOnboardingModal } from './components/PhoneOnboardingModal';
import {
  PublicStorefrontView,
  type PublicStorefrontOwner,
} from './components/PublicStorefrontView';
import { ResellerPanel } from './components/ResellerPanel';
import { SettingsView } from './components/SettingsView';
import {
  BillingManageModal,
  CommercialTrialModal,
} from './components/SubscriptionModals';

type MainTab = 'chats' | 'calls' | 'contacts' | 'commercial' | 'settings';

export default function App() {
  // Real Firebase Auth & Profile State
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

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

  // Real Closed-App / Locked-Screen Web Push State
  const [pushStatus, setPushStatus] = useState<BackgroundPushStatus>('prompt');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushFeedback, setPushFeedback] = useState('');
  const processedWakeCallIdsRef = useRef<Set<string>>(new Set());

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? '' : curr));
    }, 4000);
  }, []);

  // 1. Subscribe to Firebase Auth
  useEffect(() => {
    const unsub = subscribeFirebaseAuth((user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (!user) {
        setProfile(null);
        setProfileLoaded(true);
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
        setProfileLoaded(false);
      }
    });
    return () => unsub();
  }, []);

  // 2. Subscribe to User Profile
  useEffect(() => {
    if (!authUser) return undefined;
    return subscribeUserProfile(authUser.uid, authUser.email || '', (loaded) => {
      setProfile(loaded);
      setProfileLoaded(true);
    });
  }, [authUser]);

  // 2b. Sync existing browser/PWA Web Push subscription with Zapei server on login
  useEffect(() => {
    if (!authUser) return;
    void syncExistingPushSubscription(authUser).then(setPushStatus);
  }, [authUser]);

  const handleEnableBackgroundPush = useCallback(async () => {
    if (!authUser) return;
    setPushBusy(true);
    setPushFeedback('');
    try {
      const result = await enableRealBackgroundCallPush(authUser);
      setPushStatus(result.status);
      setPushFeedback(result.message);
      if (result.status === 'enabled') {
        showToast('Toque com tela bloqueada ativado neste aparelho!');
      }
    } catch (err) {
      setPushFeedback(
        err instanceof Error
          ? err.message
          : 'Não foi possível ativar notificações em segundo plano.'
      );
    } finally {
      setPushBusy(false);
    }
  }, [authUser, showToast]);

  // 3. Subscribe to all real Firestore collections once authenticated & registered
  useEffect(() => {
    if (!authUser || !profile) return undefined;
    const uid = authUser.uid;
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
  }, [authUser, profile?.uid]);

  // 3a. Ensure every logged-in user (including accounts created earlier) is findable by name
  const syncedDirectoryKeyRef = useRef<string>('');
  useEffect(() => {
    if (!profile?.uid || !profile.name.trim()) return;
    const syncKey = `${profile.uid}|${profile.name}|${profile.statusMessage}|${profile.hasStorefront}|${profile.storefrontName}|${profile.avatarUrl ? profile.avatarUrl.length : 0}`;
    if (syncedDirectoryKeyRef.current === syncKey) return;
    syncedDirectoryKeyRef.current = syncKey;
    void syncPublicDirectoryEntry(profile).catch(() => {});
  }, [profile]);

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
      return undefined;
    }
    const chatId = getDeterministicChatId(authUser.uid, selectedPeer.uid);
    return subscribeChatMessages(chatId, authUser.uid, setActiveMessages);
  }, [authUser, selectedPeer?.uid]);

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

    if (activeCall) return;

    const now = Date.now();
    const incoming = calls.find(
      (c) =>
        c.calleeId === profile.uid &&
        c.status === 'ringing' &&
        Boolean(c.offerSdp) &&
        !ignoredCallIdsRef.current.has(c.id) &&
        (c.createdAtMs === 0 || now - c.createdAtMs < 120000)
    );

    if (incoming) {
      setActiveCall({
        callId: incoming.id,
        direction: 'incoming',
        callType: incoming.callType,
        peerId: incoming.callerId,
        peerName: incoming.callerName,
        peerInitials: incoming.callerInitials,
        peerAvatarColor: incoming.callerAvatarColor,
        status: 'ringing',
        offerSdp: incoming.offerSdp,
        localStream: null,
        remoteStream: null,
      });
    }
  }, [calls, profile, activeCall]);

  // Helper: persist full profile updates cleanly
  const persistProfileUpdate = useCallback(
    async (overrides: Partial<UserProfile>) => {
      if (!authUser) return;
      const base = profile;
      await registerOrUpdateUserProfile({
        uid: authUser.uid,
        email: authUser.email || base?.email || '',
        displayName: overrides.name ?? base?.name ?? authUser.displayName ?? 'Usuário Zapei',
        phone: overrides.phone ?? base?.phone ?? '',
        statusMessage: overrides.statusMessage ?? base?.statusMessage ?? 'Disponível no Zapei',
        avatarColor: overrides.avatarBg ?? base?.avatarBg ?? '#0F5132',
        avatarUrl: overrides.avatarUrl ?? base?.avatarUrl ?? '',
        commercialMode: overrides.commercialMode ?? base?.commercialMode ?? 'buyer',
        manufacturerActivated:
          overrides.manufacturerActivated ?? base?.manufacturerActivated ?? false,
        resellerActivated: overrides.resellerActivated ?? base?.resellerActivated ?? false,
        storefrontName:
          overrides.storefrontName ?? base?.storefrontName ?? `Vitrine ${base?.name ?? ''}`,
        storefrontPrivacy: overrides.storefrontPrivacy ?? base?.storefrontPrivacy ?? 'open',
        factoryName: overrides.factoryName ?? base?.factoryName ?? base?.name ?? '',
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
      peer: { uid: string; name: string; initials: string; avatarBg: string },
      callType: 'audio' | 'video'
    ) => {
      if (!profile) return;
      webrtcHandleRef.current?.cleanup();
      webrtcHandleRef.current = null;

      setActiveCall({
        callId: 'pending',
        direction: 'outgoing',
        callType,
        peerId: peer.uid,
        peerName: peer.name,
        peerInitials: peer.initials,
        peerAvatarColor: peer.avatarBg || '#0D2B3E',
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
                  ? `Permissão de ${callType === 'video' ? 'câmera e microfone' : 'microfone'} negada ou dispositivo não encontrado. Autorize no navegador e tente novamente.`
                  : 'Não foi possível iniciar a chamada WebRTC. Verifique sua conexão e permissões.',
              }
            : null
        );
      }
    },
    [authUser, profile, showToast]
  );

  const handleAcceptIncomingCall = useCallback(async () => {
    if (!profile || !activeCall || !activeCall.offerSdp) return;
    setActiveCall((prev) => (prev ? { ...prev, status: 'connecting' } : null));

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
  }, [profile, activeCall, showToast]);

  const handleDeclineIncomingCall = useCallback(async () => {
    if (!activeCall) return;
    ignoredCallIdsRef.current.add(activeCall.callId);
    const id = activeCall.callId;
    setActiveCall(null);
    if (id !== 'pending') {
      await updateRealCallStatus(db, id, 'declined', '00:00');
    }
  }, [activeCall]);

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

  // --- CHAT & STOREFRONT NAVIGATION HANDLERS ---

  const openChatWithPeer = useCallback(
    async (peer: ActiveChatPeer) => {
      setSelectedPeer(peer);
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
    []
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

          const callType: 'audio' | 'video' = d.callType === 'video' ? 'video' : 'audio';
          const callerId = String(d.callerId || '');
          const callerName = String(d.callerName || 'Contato');
          const callerInitials = String(d.callerInitials || getInitials(callerName));
          const callerAvatarColor = String(d.callerAvatarColor || '#0F5132');
          const offerSdp = String(d.offerSdp);

          setActiveCall({
            callId: params.callId,
            direction: 'incoming',
            callType,
            peerId: callerId,
            peerName: callerName,
            peerInitials: callerInitials,
            peerAvatarColor: callerAvatarColor,
            status: params.callAction === 'answer' ? 'connecting' : 'ringing',
            offerSdp,
            localStream: null,
            remoteStream: null,
          });

          if (params.callAction === 'answer') {
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
              avatarBg: '#0F5132',
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
    [profile, contacts, openChatWithPeer, showToast]
  );

  // Check URL query parameters when app is cold-launched from a closed-app push notification
  useEffect(() => {
    if (!profile) return;
    const params = new URLSearchParams(window.location.search);
    const incomingCall = params.get('incomingCall') || undefined;
    const callAction = params.get('callAction') || undefined;
    const openChatUid = params.get('openChat') || undefined;
    if (!incomingCall && !openChatUid) return;

    window.history.replaceState({}, '', '/');
    void processPushWakeAction({ callId: incomingCall, callAction, openChatUid });
  }, [profile, processPushWakeAction]);

  // Listen for Service Worker notificationclick actions when app was running in background
  useEffect(() => {
    if (!profile || !('serviceWorker' in navigator)) return undefined;
    const onSwMessage = (event: MessageEvent) => {
      const msg = event.data as {
        type?: string;
        payload?: {
          kind?: string;
          callId?: string;
          senderId?: string;
          action?: string;
        };
      };
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
  }, [profile, processPushWakeAction]);

  const openStorefrontByUid = useCallback(
    async (uid: string) => {
      const owner = await fetchPublicUserStorefront(uid);
      if (!owner) {
        showToast('Vitrine não encontrada.');
        return;
      }
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

      // Recompute parent order totals & Layer 2 payment
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

        await updateRealOrder(parent.id, {
          factoryCostTotal: totalFactory,
          buyerSubtotal: totalBuyerSub,
          discountAmount: clampedDiscount,
          buyerFinalTotal: finalBuyer,
          status: newSubStatus,
        });
        if (profile && parent.resellerId === profile.uid) {
          await updateRealPayment(`pay_rb_${parent.id}`, {
            amount: finalBuyer,
            costReference: totalFactory,
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

      await updateRealOrder(order.id, {
        discountMode: mode,
        discountValue: value,
        discountAmount: clampedDiscount,
        buyerFinalTotal: finalTotal,
      });
      await updateRealPayment(`pay_rb_${order.id}`, {
        amount: finalTotal,
      });
    },
    []
  );

  const handleConnectFactoryByPhone = useCallback(
    async (rawPhone: string): Promise<{ ok: boolean; message: string }> => {
      if (!profile) return { ok: false, message: 'Sessão inválida.' };
      const match = await lookupRegisteredUserByPhone(rawPhone);
      if (!match) {
        return {
          ok: false,
          message:
            'Nenhum usuário cadastrado no Zapei foi encontrado com este número de telefone.',
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
          message: `${match.displayName} está no Zapei, mas ainda não ativou o perfil de Fabricante.`,
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

  // Derived lists
  const zapeiContacts = useMemo(
    () => contacts.filter((c) => c.onZapei && c.matchedUid),
    [contacts]
  );

  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) =>
        c.otherName.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q)
    );
  }, [chats, chatSearch]);

  const allSubOrders = useMemo(
    () => orders.flatMap((o) => o.subOrders),
    [orders]
  );

  // --- LOADING & REAL AUTH/PHONE GATE ---

  if (!authReady || (authUser && !profileLoaded)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <Loader2 className="h-8 w-8 animate-spin text-[#0F5132]" />
          <p className="text-xs font-semibold">Conectando ao Zapei...</p>
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
          <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0F5132] text-lg font-extrabold text-white shadow-sm">
              Z
            </div>
            <div className="hidden lg:block min-w-0">
              <span className="block text-base font-extrabold tracking-tight">Zapei</span>
              <span className="block truncate text-[11px] text-emerald-200/80">
                {profile.commercialMode === 'manufacturer'
                  ? 'Fabricante'
                  : profile.commercialMode === 'reseller'
                    ? 'Revendedor'
                    : 'Mensageiro Grátis'}
              </span>
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
                      ? 'bg-[#0F5132] text-white shadow-sm'
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

        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className="flex w-full items-center justify-center lg:justify-start gap-2.5 rounded-xl p-2 hover:bg-white/10 transition"
          >
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.name}
                className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/25"
              />
            ) : (
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: profile.avatarBg || '#0F5132' }}
              >
                {profile.initials}
              </div>
            )}
            <div className="hidden lg:block min-w-0 text-left">
              <p className="truncate text-xs font-bold text-white">{profile.name}</p>
              <p className="truncate font-mono text-[11px] text-slate-300 tabular-nums">
                {profile.phone}
              </p>
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Mobile Compact Top Header (hidden when inside an active mobile chat thread) */}
        {!mobileInChat && (
          <header className="flex md:hidden items-center justify-between gap-2 border-b border-slate-200 bg-[#0D2B3E] px-3.5 pb-2.5 pt-safe text-white shrink-0">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0F5132] text-sm font-extrabold">
                Z
              </div>
              <span className="truncate text-base font-extrabold tracking-tight">Zapei</span>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-emerald-200 tabular-nums">
              {profile.phone}
            </span>
          </header>
        )}

        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed left-3 right-3 sm:left-auto sm:right-4 top-3 z-50 sm:max-w-sm rounded-xl border border-emerald-200 bg-[#0F5132] px-4 py-2.5 text-xs font-semibold text-white shadow-lg">
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
                      className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[#0F5132] hover:bg-emerald-100"
                    >
                      + Nova conversa
                    </button>
                  </div>
                  <div className="relative mt-2.5">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder="Buscar conversas..."
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-[#0F5132] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 pb-safe-nav md:pb-2">
                  {filteredChats.length === 0 ? (
                    <div className="p-6 text-center">
                      <MessageSquare className="mx-auto h-9 w-9 text-slate-300" />
                      <p className="mt-3 text-sm font-semibold text-slate-800">
                        Nenhuma conversa iniciada ainda
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Vá até a aba <strong>Contatos</strong>, salve ou importe números da sua agenda e comece a conversar ou ligar em tempo real.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('contacts')}
                        className="mt-4 rounded-xl bg-[#0F5132] px-4 py-2 text-xs font-semibold text-white hover:bg-[#146c43]"
                      >
                        Abrir Agenda de Contatos
                      </button>
                    </div>
                  ) : (
                    filteredChats.map((thread) => {
                      const matchedContact = contacts.find(
                        (c) => c.matchedUid === thread.otherUid
                      );
                      const displayName = matchedContact?.name || thread.otherName;
                      const isSelected = selectedPeer?.uid === thread.otherUid;
                      return (
                        <button
                          key={thread.id}
                          type="button"
                          onClick={() =>
                            void openChatWithPeer({
                              uid: thread.otherUid,
                              name: displayName,
                              initials: getInitials(displayName),
                              avatarBg: matchedContact?.avatarBg || '#0F5132',
                              phone: matchedContact?.phone,
                              role: matchedContact?.role || 'normal',
                              hasStorefront: Boolean(matchedContact?.hasStorefront),
                              storefrontName: matchedContact?.storefrontName,
                              deliveryPolicyLabel: matchedContact?.deliveryPolicyLabel,
                            })
                          }
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                            isSelected ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                            style={{
                              backgroundColor: matchedContact?.avatarBg || '#0F5132',
                            }}
                          >
                            {getInitials(displayName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-bold text-slate-900">
                                {displayName}
                              </span>
                              <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                                {thread.updatedAtLabel}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p className="truncate text-xs text-slate-500">
                                {thread.lastMessage || 'Conversa iniciada'}
                              </p>
                              {matchedContact?.hasStorefront && (
                                <Store className="h-3.5 w-3.5 shrink-0 text-[#0F5132]" />
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
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
                    peer={selectedPeer}
                    messages={activeMessages}
                    onBack={() => setSelectedPeer(null)}
                    onSendText={async (text) => {
                      await sendRealChatMessage({
                        myUid: profile.uid,
                        myName: profile.name,
                        otherUid: selectedPeer.uid,
                        otherName: selectedPeer.name,
                        type: 'text',
                        text,
                      });
                      if (authUser) {
                        void triggerRemoteMessagePush(authUser, {
                          recipientId: selectedPeer.uid,
                          senderName: profile.name,
                          previewText: text,
                        });
                      }
                    }}
                    onSendAudio={async (mediaUrl, audioDuration) => {
                      await sendRealChatMessage({
                        myUid: profile.uid,
                        myName: profile.name,
                        otherUid: selectedPeer.uid,
                        otherName: selectedPeer.name,
                        type: 'audio',
                        text: `Mensagem de voz (${audioDuration})`,
                        mediaUrl,
                        audioDuration,
                      });
                      if (authUser) {
                        void triggerRemoteMessagePush(authUser, {
                          recipientId: selectedPeer.uid,
                          senderName: profile.name,
                          previewText: `Mensagem de voz (${audioDuration})`,
                        });
                      }
                    }}
                    onSendImage={async (mediaUrl, caption) => {
                      await sendRealChatMessage({
                        myUid: profile.uid,
                        myName: profile.name,
                        otherUid: selectedPeer.uid,
                        otherName: selectedPeer.name,
                        type: 'image',
                        text: caption || 'Foto',
                        mediaUrl,
                      });
                      if (authUser) {
                        void triggerRemoteMessagePush(authUser, {
                          recipientId: selectedPeer.uid,
                          senderName: profile.name,
                          previewText: caption ? `Foto: ${caption}` : 'Enviou uma foto',
                        });
                      }
                    }}
                    onStartCall={(type) => void handleStartCall(selectedPeer, type)}
                    onOpenStorefront={() => void openStorefrontByUid(selectedPeer.uid)}
                    onInspectOrder={() => {
                      if (profile.commercialMode !== 'buyer') {
                        setActiveTab('commercial');
                      } else if (selectedPeer.hasStorefront) {
                        void openStorefrontByUid(selectedPeer.uid);
                      }
                    }}
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-[#0F5132]">
                      <MessageSquare className="h-8 w-8" />
                    </div>
                    <h2 className="mt-4 text-lg font-bold text-slate-900">
                      Zapei Mensageiro em Tempo Real
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
              pushStatus={pushStatus}
              pushBusy={pushBusy}
              pushFeedback={pushFeedback}
              onEnableBackgroundPush={handleEnableBackgroundPush}
              onStartCallWithContact={(contact, type) => {
                if (!contact.matchedUid) return;
                void handleStartCall(
                  {
                    uid: contact.matchedUid,
                    name: contact.name,
                    initials: contact.initials,
                    avatarBg: contact.avatarBg,
                  },
                  type
                );
              }}
              onCallBackPeer={(peer, type) => void handleStartCall(peer, type)}
            />
          )}

          {activeTab === 'contacts' && (
            <ContactsView
              currentUserUid={profile.uid}
              contacts={contacts}
              directoryUsers={directoryUsers}
              onLookupPhone={lookupRegisteredUserByPhone}
              onOpenDirectoryChat={(person) => {
                void openChatWithPeer({
                  uid: person.uid,
                  name: person.displayName,
                  initials: person.initials,
                  avatarBg: person.avatarColor,
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
                  },
                  type
                );
              }}
              onOpenChat={(contact) => {
                if (!contact.matchedUid) return;
                void openChatWithPeer({
                  uid: contact.matchedUid,
                  name: contact.name,
                  initials: contact.initials,
                  avatarBg: contact.avatarBg,
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
              onStartCall={(contact, type) => {
                if (!contact.matchedUid) return;
                void handleStartCall(
                  {
                    uid: contact.matchedUid,
                    name: contact.name,
                    initials: contact.initials,
                    avatarBg: contact.avatarBg,
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
              payments={payments}
              onSavePolicy={async (factoryName, factoryPolicy: MinimumDeliveryPolicy) => {
                await persistProfileUpdate({ factoryName, factoryPolicy });
              }}
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
              onConnectFactoryByPhone={handleConnectFactoryByPhone}
              onUpdateConnection={(
                connectionId: string,
                updates: Partial<{
                  reviewPhotos: boolean;
                  paused: boolean;
                  margins: Record<ProductCategory, CategoryMargin>;
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
              onOpenMyStorefrontPreview={() => void openStorefrontByUid(profile.uid)}
              onOpenBilling={() => setShowBillingModal(true)}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              profile={profile}
              pushStatus={pushStatus}
              pushBusy={pushBusy}
              pushFeedback={pushFeedback}
              onEnableBackgroundPush={handleEnableBackgroundPush}
              onEditProfile={() => setShowEditProfile(true)}
              onSelectMode={(mode) => void handleSelectCommercialMode(mode)}
              onOpenBilling={() => setShowBillingModal(true)}
              onOpenCommercialPanel={() => setActiveTab('commercial')}
              onSignOut={async () => {
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
                    active ? 'text-[#0F5132]' : 'text-slate-500'
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
          onClose={() => setActiveStorefrontOwner(null)}
          onCheckoutMixedOrder={async ({
            ownerUid,
            storefrontName,
            subOrders,
            buyerSubtotal,
            factoryCostTotal,
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
                text: `Novo pedido ${orderCode} enviado (${totalBoxes} caixas)`,
                orderId,
                orderCode,
                orderSummary: `${totalBoxes} caixa(s) em ${subOrders.length} lote(s) de despacho`,
                orderTotal: buyerSubtotal,
                orderStatusLabel: 'Aguardando conferência de estoque',
              });
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
    </div>
  );
}
