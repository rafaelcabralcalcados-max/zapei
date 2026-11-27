import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  FileWarning,
  Handshake,
  HelpCircle,
  History,
  Image as ImageIcon,
  Layers,
  Link2,
  Lock,
  PauseCircle,
  PlayCircle,
  QrCode,
  Receipt,
  RefreshCw,
  Send,
  Settings2,
  Star,
  Store,
  Tag,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import type {
  CategoryMargin,
  CommercialReview,
  ConnectionApprovalStatus,
  DualPaymentRecord,
  FactoryConnection,
  LogisticsType,
  MixedOrder,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductCategory,
  ResellerReleasePreference,
  SplitPaymentMethod,
  SubOrder,
  TargetCommercialRole,
  UserProfile,
} from '../types/zapei';
import { BACK_PRIORITY, useSystemBackHandler } from '../lib/backNavigation';
import {
  canCancelUnpaidOrder,
  formatAsaasStatusLabel,
  formatReservationRemaining,
  getOrderReservationDeadlineMs,
  type AsaasOrderStatusResult,
  type CancelOrderResult,
  type CreateAsaasChargeResult,
} from '../lib/asaasService';
import {
  ANCHOR_DISCOUNT_PRESETS,
  computeAnchoredOriginalPrice,
  computeResellerPrice,
  formatBRL,
} from '../lib/gradeParser';
import {
  PRODUCT_CATEGORIES,
  computeUnitPriceFromTotal,
  formatPackSummaryLabel,
  formatUnitSuffix,
  getCategoryDefinition,
  getGradeDisplayTitle,
  hasExplicitWholesalePolicy,
  hasStructuredGrade,
  inferProductSubcategory,
  isSingleAssetCategory,
  normalizeProductCategory,
  resolveMarginForProduct,
  resolveProductImages,
  resolveProductPackLabel,
  resolveProductQuantityPerPack,
  resolveProductUnitType,
} from '../lib/categories';
import { calculateOrderSplit } from '../lib/splitCalculator';
import {
  AsaasChargeModal,
  toAsaasChargeModalData,
  type AsaasChargeModalData,
} from './AsaasChargeModal';
import { GradeVisualGrid } from './GradeVisualGrid';
import { SplitBreakdownCard } from './SplitBreakdownCard';
import { WalletIdSplitCard } from './WalletIdSplitCard';
import type { HelpCenterContext } from './HelpCenterModal';
import {
  DeliveryReportModal,
  StarReviewModal,
  type ReportModalTarget,
  type ReviewModalTarget,
} from './RatingAndReportModal';
import {
  RESELLER_RELEASE_OPTIONS,
  formatCarrierDeadlineSummary,
  getBuyerReleaseOptionMeta,
  getResellerReleaseOptionMeta,
  getResellerShareReleaseStatusLabel,
  hasPreferenceDivergence,
} from '../lib/orderAgreement';
import { StarRatingBadge } from './StarRatingBadge';

interface ResellerPanelProps {
  profile: UserProfile;
  connections: FactoryConnection[];
  products: Product[];
  orders: MixedOrder[];
  payments: DualPaymentRecord[];
  writtenReviews?: CommercialReview[];
  receivedReviews?: CommercialReview[];
  onSaveStorefrontIdentity: (
    storefrontName: string,
    storefrontPrivacy: 'open' | 'approved'
  ) => Promise<void>;
  onSaveReleasePreferences?: (prefs: {
    resellerReleasePreference: ResellerReleasePreference;
    resellerReleaseNote: string;
    defaultCarrierDeadlineDays: number;
  }) => Promise<void>;
  onUpdateOrderReleasePreference?: (
    order: MixedOrder,
    preference: ResellerReleasePreference,
    note: string
  ) => Promise<void>;
  onExtendCarrierDeadline?: (order: MixedOrder, sub: SubOrder) => Promise<void>;
  onSaveAnchorDiscount?: (discountPercent: number) => Promise<void>;
  onSaveWalletId: (walletId: string) => Promise<void>;
  onConnectFactoryByPhone: (phone: string) => Promise<{ ok: boolean; message: string }>;
  onUpdateConnection: (
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
  ) => Promise<void>;
  onApplyPunctualDiscount: (
    order: MixedOrder,
    mode: 'fixed' | 'percent',
    value: number
  ) => Promise<void>;
  onSubmitLogistics: (
    subOrder: SubOrder,
    logisticsType: LogisticsType,
    logisticsCompany: string,
    logisticsAddress: string,
    carrierDeadlineDays: number
  ) => Promise<void>;
  onUpdatePayment: (
    paymentId: string,
    updates: { method?: PaymentMethod; status?: PaymentStatus }
  ) => Promise<void>;
  onSendBillingReminder: (payment: DualPaymentRecord) => Promise<void>;
  onGenerateAsaasCharge?: (
    order: MixedOrder,
    paymentMethod: SplitPaymentMethod,
    installments: number
  ) => Promise<CreateAsaasChargeResult>;
  onSyncAsaasStatus?: (order: MixedOrder) => Promise<AsaasOrderStatusResult | null>;
  onCancelOrder?: (
    orderId: string,
    reason: 'reseller_cancelled'
  ) => Promise<CancelOrderResult>;
  onOpenMyStorefrontPreview: () => void;
  onOpenBilling: () => void;
  onConfirmSubOrderDelivered?: (order: MixedOrder, sub: SubOrder) => Promise<void>;
  onSubmitReview?: (params: {
    orderId: string;
    orderCode: string;
    subOrderId?: string;
    targetUid: string;
    targetName: string;
    targetRole: TargetCommercialRole;
    reviewerRole: 'buyer' | 'reseller';
    stars: 1 | 2 | 3 | 4 | 5;
    comment: string;
  }) => Promise<void>;
  onSubmitDeliveryReport?: (params: {
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
  }) => Promise<{ reportCode: string; ticketCode: string }>;
  onOpenHelp?: (ctx: HelpCenterContext) => void;
}

type ResellerTab = 'connections' | 'review' | 'orders' | 'finance' | 'identity';

export const ResellerPanel: React.FC<ResellerPanelProps> = ({
  profile,
  connections,
  products,
  orders,
  payments,
  writtenReviews = [],
  receivedReviews = [],
  onSaveStorefrontIdentity,
  onSaveReleasePreferences,
  onUpdateOrderReleasePreference,
  onExtendCarrierDeadline,
  onSaveAnchorDiscount,
  onSaveWalletId,
  onConnectFactoryByPhone,
  onUpdateConnection,
  onApplyPunctualDiscount,
  onSubmitLogistics,
  onUpdatePayment,
  onSendBillingReminder,
  onGenerateAsaasCharge,
  onSyncAsaasStatus,
  onCancelOrder,
  onOpenMyStorefrontPreview,
  onOpenBilling,
  onConfirmSubOrderDelivered,
  onSubmitReview,
  onSubmitDeliveryReport,
  onOpenHelp,
}) => {
  const [activeTab, setActiveTab] = useState<ResellerTab>('connections');
  const [feedback, setFeedback] = useState('');
  const [confirmSubDeliveryId, setConfirmSubDeliveryId] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewModalTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportModalTarget | null>(null);
  const [curationPhotoIdxMap, setCurationPhotoIdxMap] = useState<Record<string, number>>({});

  // R01 Identity & Visual Anchor Discount state
  const [storefrontName, setStorefrontName] = useState(
    profile.storefrontName || `Vitrine ${profile.name}`
  );
  const [storefrontPrivacy, setStorefrontPrivacy] = useState<'open' | 'approved'>(
    profile.storefrontPrivacy
  );
  const [anchorDiscountPct, setAnchorDiscountPct] = useState<number>(
    profile.anchorDiscountPercent ?? 0
  );
  const [savingAnchorDiscount, setSavingAnchorDiscount] = useState(false);
  const [anchorSavedOk, setAnchorSavedOk] = useState(false);
  const [releasePref, setReleasePref] = useState<ResellerReleasePreference>(
    profile.resellerReleasePreference ?? 'upon_carrier_receipt'
  );
  const [releaseNote, setReleaseNote] = useState(profile.resellerReleaseNote ?? '');
  const [defaultCarrierDays, setDefaultCarrierDays] = useState<string>(
    String(profile.defaultCarrierDeadlineDays ?? 7)
  );
  const [savingReleasePrefs, setSavingReleasePrefs] = useState(false);

  useEffect(() => {
    setStorefrontName(profile.storefrontName || `Vitrine ${profile.name}`);
  }, [profile.storefrontName, profile.name]);

  useEffect(() => {
    setAnchorDiscountPct(profile.anchorDiscountPercent ?? 0);
  }, [profile.anchorDiscountPercent]);

  useEffect(() => {
    setReleasePref(profile.resellerReleasePreference ?? 'upon_carrier_receipt');
  }, [profile.resellerReleasePreference]);

  useEffect(() => {
    setReleaseNote(profile.resellerReleaseNote ?? '');
  }, [profile.resellerReleaseNote]);

  useEffect(() => {
    setDefaultCarrierDays(String(profile.defaultCarrierDeadlineDays ?? 7));
  }, [profile.defaultCarrierDeadlineDays]);

  // R02 Connect factory by phone & Margin Split Simulator state
  const [factoryPhone, setFactoryPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [simCategoryMap, setSimCategoryMap] = useState<Record<string, ProductCategory>>({});
  const [simBaseCostMap, setSimBaseCostMap] = useState<Record<string, string>>({});
  const [simMethodMap, setSimMethodMap] = useState<Record<string, SplitPaymentMethod>>({});
  const [simInstMap, setSimInstMap] = useState<Record<string, number>>({});

  // R04 Discount & Asaas Charge drafts keyed by orderId
  const [discountModeMap, setDiscountModeMap] = useState<
    Record<string, 'fixed' | 'percent'>
  >({});
  const [discountValueMap, setDiscountValueMap] = useState<Record<string, string>>({});
  const [orderPayMethodMap, setOrderPayMethodMap] = useState<
    Record<string, SplitPaymentMethod>
  >({});
  const [orderInstMap, setOrderInstMap] = useState<Record<string, number>>({});
  const [chargeLoadingId, setChargeLoadingId] = useState<string | null>(null);
  const [syncLoadingId, setSyncLoadingId] = useState<string | null>(null);
  const [chargeResultsByOrder, setChargeResultsByOrder] = useState<
    Record<string, CreateAsaasChargeResult>
  >({});
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState<string | null>(null);
  const [cancelLoadingId, setCancelLoadingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const [activeModalCharge, setActiveModalCharge] =
    useState<AsaasChargeModalData | null>(null);

  useSystemBackHandler(
    activeTab !== 'connections',
    () => setActiveTab('connections'),
    BACK_PRIORITY.PANEL_SUBTAB,
    activeTab
  );
  useSystemBackHandler(
    Boolean(confirmSubDeliveryId),
    () => setConfirmSubDeliveryId(null),
    BACK_PRIORITY.DRAWER
  );
  useSystemBackHandler(
    Boolean(confirmCancelOrderId),
    () => setConfirmCancelOrderId(null),
    BACK_PRIORITY.DRAWER
  );
  useSystemBackHandler(
    Boolean(activeModalCharge),
    () => setActiveModalCharge(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(reviewTarget),
    () => setReviewTarget(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(reportTarget),
    () => setReportTarget(null),
    BACK_PRIORITY.MODAL
  );

  // R05 Logistics drafts keyed by subOrderId
  const [logTypeMap, setLogTypeMap] = useState<Record<string, LogisticsType>>({});
  const [logCompanyMap, setLogCompanyMap] = useState<Record<string, string>>({});
  const [logAddressMap, setLogAddressMap] = useState<Record<string, string>>({});
  const [logDeadlineDaysMap, setLogDeadlineDaysMap] = useState<Record<string, string>>({});
  const [extendingSubId, setExtendingSubId] = useState<string | null>(null);
  const [orderReleasePrefDraftMap, setOrderReleasePrefDraftMap] = useState<
    Record<string, ResellerReleasePreference>
  >({});
  const [orderReleaseNoteDraftMap, setOrderReleaseNoteDraftMap] = useState<
    Record<string, string>
  >({});
  const [savingOrderPrefId, setSavingOrderPrefId] = useState<string | null>(null);
  const [expandedHistoryOrderIds, setExpandedHistoryOrderIds] = useState<Record<string, boolean>>({});

  const myConnections = useMemo(
    () => connections.filter((c) => c.resellerId === profile.uid),
    [connections, profile.uid]
  );

  const pendingReviewItems = useMemo(() => {
    const items: Array<{ product: Product; connection: FactoryConnection }> = [];
    for (const conn of myConnections) {
      if (conn.approvalStatus !== 'approved' || conn.paused || !conn.reviewPhotos) continue;
      const factoryProds = products.filter(
        (p) =>
          p.factoryId === conn.factoryId &&
          p.moderationStatus === 'approved' &&
          !conn.approvedProductIds.includes(p.id) &&
          !conn.rejectedProductIds.includes(p.id)
      );
      for (const product of factoryProds) {
        items.push({ product, connection: conn });
      }
    }
    return items;
  }, [myConnections, products]);

  const myOrders = useMemo(
    () => orders.filter((o) => o.resellerId === profile.uid),
    [orders, profile.uid]
  );

  const receivables = useMemo(
    () =>
      payments.filter(
        (p) => p.ownerId === profile.uid && p.layer === 'reseller_buyer'
      ),
    [payments, profile.uid]
  );

  const payables = useMemo(
    () =>
      payments.filter(
        (p) => p.counterpartyId === profile.uid && p.layer === 'factory_reseller'
      ),
    [payments, profile.uid]
  );

  const totalReceivable = receivables
    .filter((p) => p.status !== 'Cancelado')
    .reduce((acc, p) => acc + p.amount, 0);
  const totalPayable = payables
    .filter((p) => p.status !== 'Cancelado')
    .reduce((acc, p) => acc + p.amount, 0);
  const estimatedNetProfit = Math.max(0, totalReceivable - totalPayable);

  const handleSelectAnchorDiscount = async (pct: number) => {
    setAnchorDiscountPct(pct);
    setAnchorSavedOk(false);
    if (!onSaveAnchorDiscount) return;
    setSavingAnchorDiscount(true);
    try {
      await onSaveAnchorDiscount(pct);
      setAnchorSavedOk(true);
      setFeedback(
        pct > 0
          ? `Vitrine configurada com desconto visual de ${pct}% OFF (preço "De / Por"). Seu recebimento líquido no Split permanece intacto.`
          : 'Vitrine configurada sem desconto visual (exibindo apenas o preço final único).'
      );
    } finally {
      setSavingAnchorDiscount(false);
    }
  };

  const samplePreviewSellingPrice = useMemo(() => {
    for (const conn of myConnections) {
      if (conn.approvalStatus !== 'approved' || conn.paused) continue;
      const prod = products.find(
        (p) => p.factoryId === conn.factoryId && p.moderationStatus === 'approved'
      );
      if (prod) {
        const margin =
          resolveMarginForProduct(conn.margins, prod.category) ??
          getCategoryDefinition(prod.category).defaultMargin;
        return computeResellerPrice(prod.factoryPrice, margin);
      }
    }
    return 501.6;
  }, [myConnections, products]);

  const sampleAnchorOriginalPrice = computeAnchoredOriginalPrice(
    samplePreviewSellingPrice,
    anchorDiscountPct
  );

  const handleConnectFactory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factoryPhone.trim()) return;
    setBusy(true);
    setFeedback('');
    try {
      const res = await onConnectFactoryByPhone(factoryPhone.trim());
      setFeedback(res.message);
      if (res.ok) setFactoryPhone('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl overflow-x-hidden px-3.5 sm:px-4 py-4 sm:py-5 pb-safe-nav md:pb-8 space-y-5">
      {/* Top Commercial Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0E7A34] text-white">
              <Store className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900">
                  {profile.storefrontName || profile.name}
                </h1>
                <StarRatingBadge
                  average={
                    profile.ratingCount
                      ? profile.ratingAverage
                      : receivedReviews.length > 0
                        ? receivedReviews.reduce((acc, r) => acc + r.stars, 0) /
                          receivedReviews.length
                        : 0
                  }
                  count={profile.ratingCount || receivedReviews.length}
                  variant="card"
                  showEmpty
                />
              </div>
              <p className="text-xs text-slate-500">
                Painel Comercial · {myConnections.filter((c) => c.approvalStatus === 'approved' && !c.paused).length} fábrica(s) aprovada(s) e ativa(s)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenMyStorefrontPreview}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0D2B3E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#143d57]"
            >
              <Eye className="h-4 w-4" />
              Ver Minha Vitrine
            </button>
            <button
              type="button"
              onClick={onOpenBilling}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
                profile.subscriptionStatus === 'active'
                  ? 'border-emerald-200 bg-emerald-50 text-[#0E7A34]'
                  : profile.subscriptionStatus === 'trial'
                    ? 'border-slate-200 bg-slate-50 text-[#0D2B3E]'
                    : 'border-orange-300 bg-orange-50 text-orange-800'
              }`}
            >
              <CreditCard className="h-4 w-4" />
              {profile.subscriptionStatus === 'active'
                ? 'Plano Ativo — R$ 59,90/mês'
                : profile.subscriptionStatus === 'trial'
                  ? `Teste: ${profile.trialDaysLeft} dias`
                  : 'Vitrine Pausada'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-1.5 overflow-x-auto border-t border-slate-100 pt-3">
          {[
            { id: 'connections', label: `Anunciantes & Margens (${myConnections.length})`, icon: Link2 },
            {
              id: 'review',
              label: `Revisão de Fotos (${pendingReviewItems.length})`,
              icon: ImageIcon,
            },
            { id: 'orders', label: `Pedidos Mistos (${myOrders.length})`, icon: Layers },
            { id: 'finance', label: 'Financeiro Duplo', icon: Receipt },
            { id: 'identity', label: 'Vitrine', icon: Settings2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ResellerTab)}
                className={`flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? 'bg-[#0E7A34] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Prominent Top Asaas Wallet ID Configuration */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <WalletIdSplitCard
            compact
            currentWalletId={profile.asaasWalletId}
            onSaveWalletId={onSaveWalletId}
            roleHint="Receba automaticamente sua comissão nas vendas da vitrine via Split Asaas."
          />
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-[#0E7A34]">
          {feedback}
        </div>
      )}

      {/* TAB 1: CONNECTIONS & CATEGORY MARGINS (R02) */}
      {activeTab === 'connections' && (
        <div className="space-y-4">
          <form
            onSubmit={handleConnectFactory}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-sm font-bold text-slate-900">
              Solicitar Parceria com Anunciante / Fabricante
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Digite o telefone ou Linha Virtual (ex: CFI-1234-5678) de um fabricante no ChatFi. O pedido de parceria será enviado ao fabricante e os produtos aparecerão na sua vitrine assim que ele aceitar você como revendedor.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                required
                value={factoryPhone}
                onChange={(e) => setFactoryPhone(e.target.value)}
                placeholder="(11) 99999-9999 ou CFI-1234-5678"
                className="h-11 flex-1 rounded-xl border border-slate-200 px-3.5 font-mono text-sm focus:border-[#0E7A34] focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="h-11 rounded-xl bg-[#0E7A34] px-5 text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
              >
                {busy ? 'Enviando solicitação...' : 'Solicitar Parceria'}
              </button>
            </div>
          </form>

          {/* Visual Anchored Discount ("De / Por") Control for Public Storefront */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#0E7A34]">
                  <Tag className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Desconto Visual na Vitrine (Preço &ldquo;De / Por&rdquo;)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Exiba um preço anterior riscado (&ldquo;De&rdquo;) calculado automaticamente a partir do seu preço final de venda (&ldquo;Por&rdquo;), sem alterar seu recebimento no Split.
                  </p>
                </div>
              </div>

              {anchorSavedOk && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-[#0E7A34]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Salvo na Vitrine
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {ANCHOR_DISCOUNT_PRESETS.map((pct) => {
                const active = anchorDiscountPct === pct;
                return (
                  <button
                    key={pct}
                    type="button"
                    disabled={savingAnchorDiscount}
                    onClick={() => void handleSelectAnchorDiscount(pct)}
                    className={`min-h-[38px] rounded-xl px-3.5 text-xs font-bold transition ${
                      active
                        ? 'bg-[#0E7A34] text-white shadow-xs'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {pct === 0 ? 'Sem desconto' : `${pct}% OFF`}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Prévia na Vitrine Pública
                </span>
                {sampleAnchorOriginalPrice ? (
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-400 line-through tabular-nums">
                      De {formatBRL(sampleAnchorOriginalPrice)}
                    </span>
                    <span className="font-mono text-sm font-bold text-[#0E7A34] tabular-nums">
                      Por {formatBRL(samplePreviewSellingPrice)}
                    </span>
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-[#0E7A34]">
                      {anchorDiscountPct}% OFF
                    </span>
                  </div>
                ) : (
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-[#0E7A34] tabular-nums">
                      {formatBRL(samplePreviewSellingPrice)}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      (preço único final sem âncora promocional)
                    </span>
                  </div>
                )}
              </div>
              <p className="max-w-xs text-[11px] text-slate-500">
                Opcional por lojista: use &ldquo;Sem desconto&rdquo; ou escolha o percentual desejado conforme sua política comercial.
              </p>
            </div>
          </section>

          {myConnections.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <Link2 className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">
                Nenhuma fábrica conectada ainda
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Conecte um fabricante real acima pelo telefone cadastrado no ChatFi. Os produtos da fábrica entram na sua vitrine com sigilo total de origem.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {myConnections.map((conn) => {
                const isPendingApproval = conn.approvalStatus === 'pending';
                const isRejected = conn.approvalStatus === 'rejected';
                const isApproved = conn.approvalStatus === 'approved';
                return (
                <div
                  key={conn.id}
                  className={`rounded-2xl border p-5 shadow-sm transition ${
                    isPendingApproval
                      ? 'border-amber-300 bg-amber-50/40'
                      : isRejected
                        ? 'border-red-200 bg-red-50/30'
                        : conn.paused
                          ? 'border-orange-300 bg-orange-50/40'
                          : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">
                          {conn.factoryName}
                        </h3>
                        {isPendingApproval && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                            <Clock className="h-3 w-3" />
                            Aguardando aprovação do fabricante
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                            <XCircle className="h-3 w-3" />
                            Solicitação recusada / revogada
                          </span>
                        )}
                        {isApproved && !conn.paused && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-[#0E7A34]">
                            <CheckCircle2 className="h-3 w-3" />
                            Revendedor Aprovado
                          </span>
                        )}
                        {isApproved && conn.paused && (
                          <span className="rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">
                            Parceria Pausada
                          </span>
                        )}
                      </div>
                      {hasExplicitWholesalePolicy(conn.deliveryPolicy) && (
                        <p className="text-xs text-slate-500">
                          Regra de lote: {conn.deliveryPolicy.label}
                        </p>
                      )}
                    </div>

                    {isApproved && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex min-h-[38px] cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={conn.reviewPhotos}
                            onChange={(e) =>
                              void onUpdateConnection(conn.id, {
                                reviewPhotos: e.target.checked,
                              })
                            }
                            className="h-4 w-4 rounded text-[#0E7A34]"
                          />
                          Revisar fotos antes de publicar
                        </label>

                        <button
                          type="button"
                          onClick={() =>
                            void onUpdateConnection(conn.id, { paused: !conn.paused })
                          }
                          className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition ${
                            conn.paused
                              ? 'bg-[#0E7A34] text-white hover:bg-[#0B5D27]'
                              : 'bg-red-600 text-white hover:bg-red-700'
                          }`}
                        >
                          {conn.paused ? (
                            <>
                              <PlayCircle className="h-4 w-4" />
                              Reativar Parceria
                            </>
                          ) : (
                            <>
                              <PauseCircle className="h-4 w-4" />
                              Pausar Parceria
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {isRejected && (
                      <button
                        type="button"
                        onClick={() => {
                          void onUpdateConnection(conn.id, {
                            approvalStatus: 'pending',
                            resellerName: profile.name,
                            resellerStorefrontName: profile.storefrontName || profile.name,
                          }).then(() => {
                            setFeedback(
                              `Nova solicitação enviada para "${conn.factoryName}". Aguarde a aprovação do fabricante.`
                            );
                          });
                        }}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#0D2B3E] px-3.5 text-xs font-semibold text-white hover:bg-[#143d57]"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Solicitar novamente
                      </button>
                    )}
                  </div>

                  {isPendingApproval && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                      Sua solicitação foi enviada para <strong>{conn.factoryName}</strong>. Nenhum produto desta fábrica será exibido na sua vitrine até o fabricante aceitar você como revendedor.
                    </div>
                  )}

                  {isRejected && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                      O fabricante <strong>{conn.factoryName}</strong> recusou ou revogou sua autorização de revenda. Os produtos desta fábrica não aparecem na sua vitrine.
                    </div>
                  )}

                  {/* Per-category margins (10 categories) */}
                  {isApproved && (
                  <>
                  <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
                    {PRODUCT_CATEGORIES.map((cat) => {
                      const margin =
                        resolveMarginForProduct(conn.margins, cat.id) ?? cat.defaultMargin;
                      return (
                        <div
                          key={cat.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                        >
                          <span
                            title={cat.id}
                            className="block truncate text-[11px] font-bold text-slate-700"
                          >
                            {cat.shortLabel}
                          </span>
                          <div className="mt-1.5 flex items-center gap-1">
                            <select
                              value={margin.mode}
                              onChange={(e) => {
                                const updated = {
                                  ...conn.margins,
                                  [cat.id]: {
                                    ...margin,
                                    mode: e.target.value as 'fixed' | 'percent',
                                  },
                                };
                                void onUpdateConnection(conn.id, { margins: updated });
                              }}
                              className="h-8 rounded-lg border border-slate-200 bg-white px-1.5 text-xs font-semibold"
                            >
                              <option value="fixed">+R$</option>
                              <option value="percent">+%</option>
                            </select>
                            <input
                              type="number"
                              min="0"
                              value={margin.value}
                              onChange={(e) => {
                                const val = Math.max(
                                  0,
                                  Number.parseFloat(e.target.value) || 0
                                );
                                const updated = {
                                  ...conn.margins,
                                  [cat.id]: { ...margin, value: val },
                                };
                                void onUpdateConnection(conn.id, { margins: updated });
                              }}
                              className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs tabular-nums"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Live Pricing & Split Simulator for this factory's margins */}
                  {(() => {
                    const simCat = simCategoryMap[conn.id] ?? 'Calçados & Acessórios';
                    const simCatDef = getCategoryDefinition(simCat);
                    const sampleFactoryProduct = products.find(
                      (p) =>
                        p.factoryId === conn.factoryId &&
                        normalizeProductCategory(p.category) === normalizeProductCategory(simCat)
                    );
                    const defaultBase = sampleFactoryProduct?.factoryPrice ?? 380;
                    const simQty = sampleFactoryProduct
                      ? resolveProductQuantityPerPack(sampleFactoryProduct)
                      : simCatDef.defaultQuantityPerPack;
                    const simUnitType = sampleFactoryProduct
                      ? resolveProductUnitType(sampleFactoryProduct)
                      : simCatDef.defaultUnitType;
                    const simUnitSuffix = formatUnitSuffix(simUnitType);
                    const simBaseRaw =
                      simBaseCostMap[conn.id] !== undefined
                        ? Number.parseFloat(simBaseCostMap[conn.id].replace(',', '.')) || 0
                        : defaultBase;
                    const simMargin =
                      resolveMarginForProduct(conn.margins, simCat) ?? simCatDef.defaultMargin;
                    const simPublicPrice = computeResellerPrice(simBaseRaw, simMargin);
                    const simUnitPublicPrice = computeUnitPriceFromTotal(simPublicPrice, simQty);
                    const simMethod = simMethodMap[conn.id] ?? 'pix';
                    const simInst = simInstMap[conn.id] ?? 1;
                    const simBreakdown = calculateOrderSplit({
                      orderTotal: simPublicPrice,
                      factoryCostTotal: simBaseRaw,
                      paymentMethod: simMethod,
                      installments: simInst,
                      isDirectManufacturerSale: false,
                    });
                    return (
                      <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-800">
                            Simulador de Precificação na Vitrine ({simCatDef.shortLabel})
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={simCat}
                              onChange={(e) =>
                                setSimCategoryMap((p) => ({
                                  ...p,
                                  [conn.id]: e.target.value as ProductCategory,
                                }))
                              }
                              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold"
                            >
                              {PRODUCT_CATEGORIES.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.id}
                                </option>
                              ))}
                            </select>
                            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]">
                              <span className="text-slate-500">Custo Fábrica R$</span>
                              <input
                                type="number"
                                min="1"
                                step="any"
                                value={
                                  simBaseCostMap[conn.id] !== undefined
                                    ? simBaseCostMap[conn.id]
                                    : String(defaultBase)
                                }
                                onChange={(e) =>
                                  setSimBaseCostMap((p) => ({
                                    ...p,
                                    [conn.id]: e.target.value,
                                  }))
                                }
                                className="w-20 bg-transparent font-mono font-bold text-slate-900 focus:outline-none tabular-nums"
                              />
                            </div>
                            <span className="font-mono text-xs font-bold text-[#0E7A34] tabular-nums">
                              {simQty > 1
                                ? `Vitrine: ${formatBRL(simUnitPublicPrice)} / ${simUnitSuffix} (${formatBRL(simPublicPrice)} base)`
                                : `Vitrine: ${formatBRL(simPublicPrice)} / unid.`}
                            </span>
                          </div>
                        </div>

                        {simPublicPrice > 0 && (
                          <SplitBreakdownCard
                            compact
                            breakdown={simBreakdown}
                            title={`Split previsto na venda (${simCatDef.shortLabel})`}
                            factoryLabel={`Vai para ${conn.factoryName}`}
                            resellerLabel="Fica retido/liberado para você"
                            showMethodToggle
                            onChangeMethod={(m) =>
                              setSimMethodMap((p) => ({ ...p, [conn.id]: m }))
                            }
                            onChangeInstallments={(n) =>
                              setSimInstMap((p) => ({ ...p, [conn.id]: n }))
                            }
                          />
                        )}
                      </div>
                    );
                  })()}
                  </>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PHOTO REVIEW QUEUE (R03) */}
      {activeTab === 'review' && (
        <div className="space-y-4">
          {pendingReviewItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <ImageIcon className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">
                Nenhuma foto pendente de revisão
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Quando um fabricante conectado com a opção &ldquo;Revisar fotos antes de publicar&rdquo; cadastrar um novo produto, ele aparecerá aqui para aprovação ou recusa.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {pendingReviewItems.map(({ product, connection }) => {
                const margin =
                  resolveMarginForProduct(connection.margins, product.category) ??
                  getCategoryDefinition(product.category).defaultMargin;
                const publicPrice = computeResellerPrice(product.factoryPrice, margin);
                const qty = resolveProductQuantityPerPack(product);
                const unitType = resolveProductUnitType(product);
                const unitSuffix = formatUnitSuffix(unitType);
                const unitPublic = computeUnitPriceFromTotal(publicPrice, qty);
                const unitFactory = computeUnitPriceFromTotal(product.factoryPrice, qty);
                const packSummary = formatPackSummaryLabel({
                  quantityPerPack: qty,
                  unitType,
                  packLabel: resolveProductPackLabel(product),
                });
                const mainCat = normalizeProductCategory(product.category);
                const subCat = inferProductSubcategory(product.category, product.subcategory);
                const singleAsset = isSingleAssetCategory(product.category);
                const productImages = resolveProductImages(product);
                const cardKey = `${connection.id}_${product.id}`;
                const activeImgIdx = Math.min(
                  curationPhotoIdxMap[cardKey] ?? 0,
                  Math.max(0, productImages.length - 1)
                );

                return (
                  <div
                    key={cardKey}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="relative h-48 w-full bg-slate-100">
                      <img
                        src={productImages[activeImgIdx] || product.imageUrl}
                        alt={product.name}
                        className="h-full w-full object-cover"
                      />
                      {productImages.length > 1 && (
                        <>
                          <span className="absolute right-2.5 top-2.5 rounded-md bg-slate-900/75 px-2 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums">
                            {activeImgIdx + 1}/{productImages.length}
                          </span>
                          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-slate-900/65 px-2.5 py-1">
                            {productImages.map((_, idx) => (
                              <button
                                key={`${cardKey}-dot-${idx}`}
                                type="button"
                                onClick={() =>
                                  setCurationPhotoIdxMap((prev) => ({
                                    ...prev,
                                    [cardKey]: idx,
                                  }))
                                }
                                aria-label={`Ver foto ${idx + 1}`}
                                className={`h-2 rounded-full transition-all ${
                                  idx === activeImgIdx
                                    ? 'w-5 bg-[#4ADE80]'
                                    : 'w-2 bg-white/60 hover:bg-white'
                                }`}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="p-4 space-y-3">
                      <div>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {connection.factoryName} · {mainCat}
                          {subCat ? ` · ${subCat}` : ''}
                        </span>
                        <h3 className="text-sm font-bold text-slate-900">
                          {product.name}
                        </h3>
                        {product.specsSummary && (
                          <p className="text-xs text-slate-500">{product.specsSummary}</p>
                        )}
                      </div>

                      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                        <div>
                          <span className="block text-[10px] text-slate-500">Custo Fábrica</span>
                          <span className="font-mono font-bold text-slate-700 tabular-nums">
                            {formatBRL(unitFactory)} / {unitSuffix}
                          </span>
                          {qty > 1 && (
                            <span className="block font-mono text-[10px] text-slate-500 tabular-nums">
                              {packSummary}: {formatBRL(product.factoryPrice)}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="block text-[10px] text-slate-500">
                            Seu Preço na Vitrine
                          </span>
                          <span className="font-mono font-bold text-[#0E7A34] tabular-nums">
                            {formatBRL(unitPublic)} / {unitSuffix}
                          </span>
                          {qty > 1 && (
                            <span className="block font-mono text-[10px] text-slate-500 tabular-nums">
                              {packSummary}: {formatBRL(publicPrice)}
                            </span>
                          )}
                        </div>
                      </div>

                      <SplitBreakdownCard
                        compact
                        breakdown={calculateOrderSplit({
                          orderTotal: publicPrice,
                          factoryCostTotal: product.factoryPrice,
                          paymentMethod: 'pix',
                          isDirectManufacturerSale: false,
                        })}
                        title={`Precificação & Split (${qty > 1 ? packSummary : '1 unidade'} no Pix)`}
                        factoryLabel={`Vai para ${connection.factoryName}`}
                        resellerLabel="Fica retido/liberado para você"
                      />

                      {!singleAsset && hasStructuredGrade(product.gradeRaw) && (
                        <GradeVisualGrid
                          gradeRaw={product.gradeRaw}
                          compact
                          title={getGradeDisplayTitle(product.category)}
                          unitLabel={unitType === 'par' ? 'pares' : 'un'}
                        />
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void onUpdateConnection(connection.id, {
                              rejectedProductIds: [
                                ...connection.rejectedProductIds,
                                product.id,
                              ],
                            })
                          }
                          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100"
                        >
                          <X className="h-4 w-4" />
                          Recusar
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void onUpdateConnection(connection.id, {
                              approvedProductIds: [
                                ...connection.approvedProductIds,
                                product.id,
                              ],
                            })
                          }
                          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27]"
                        >
                          <Check className="h-4 w-4" />
                          Aprovar na Vitrine
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MIXED ORDERS HUB & POST-CONFIRMATION LOGISTICS (R04 & R05) */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {myOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <Layers className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">
                Nenhum pedido recebido na sua vitrine ainda
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Quando um cliente finalizar um pedido na sua vitrine, ele será desdobrado automaticamente por fabricante aqui.
              </p>
            </div>
          ) : (
            myOrders.map((order) => {
              const commissionPool = Math.max(
                0,
                order.buyerSubtotal - order.factoryCostTotal
              );
              const dMode = discountModeMap[order.id] ?? order.discountMode;
              const dValStr =
                discountValueMap[order.id] ?? String(order.discountValue || '');
              const orderPayments = payments.filter((p) => p.orderId === order.id);
              const canCancel = canCancelUnpaidOrder(order, orderPayments);
              const reservationDeadlineMs = getOrderReservationDeadlineMs(order);
              const reservationStatus = formatReservationRemaining(
                reservationDeadlineMs,
                nowMs
              );

              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">
                          Pedido {order.orderCode} · Cliente: {order.buyerName}
                        </h3>
                        {order.status === 'cancelled' && (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                            <XCircle className="h-3 w-3" />
                            Cancelado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Criado em {order.createdAt} · {order.subOrders.length} subpedido(s)
                      </p>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums">
                      <p className="text-slate-500">
                        Custo Fábricas: <strong>{formatBRL(order.factoryCostTotal)}</strong>
                      </p>
                      <p
                        className={`text-sm font-bold ${
                          order.status === 'cancelled'
                            ? 'text-slate-400 line-through'
                            : 'text-[#0E7A34]'
                        }`}
                      >
                        Total Cliente: {formatBRL(order.buyerFinalTotal)}
                      </p>
                    </div>
                  </div>

                  {order.status === 'cancelled' && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <div>
                        <p className="font-bold">
                          {order.cancelReason === 'expired_2h'
                            ? 'Reserva de 2h expirada — Pedido cancelado e estoque devolvido ao fabricante'
                            : 'Pedido cancelado · Estoque devolvido ao fabricante'}
                        </p>
                        <p className="mt-0.5 text-[11px] text-red-700">
                          Os itens reservados foram liberados automaticamente e eventuais cobranças pendentes no Asaas foram encerradas.
                        </p>
                      </div>
                    </div>
                  )}

                  {canCancel && (
                    <div className="flex flex-col gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-2 text-xs text-amber-900">
                        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <div>
                          <p className="font-semibold">
                            Reserva de estoque válida por 2h enquanto aguarda pagamento
                          </p>
                          <p className="font-mono text-[11px] text-amber-800">
                            {reservationStatus.label}
                          </p>
                        </div>
                      </div>

                      {onCancelOrder && (
                        confirmCancelOrderId === order.id ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={cancelLoadingId === order.id}
                              onClick={async () => {
                                setCancelLoadingId(order.id);
                                try {
                                  await onCancelOrder(order.id, 'reseller_cancelled');
                                  setConfirmCancelOrderId(null);
                                  setFeedback(
                                    `Pedido ${order.orderCode} cancelado e estoque devolvido ao fabricante.`
                                  );
                                } catch (err) {
                                  setFeedback(
                                    err instanceof Error
                                      ? err.message
                                      : 'Falha ao cancelar pedido.'
                                  );
                                } finally {
                                  setCancelLoadingId(null);
                                }
                              }}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {cancelLoadingId === order.id
                                ? 'Cancelando...'
                                : 'Sim, Cancelar e Liberar Estoque'}
                            </button>
                            <button
                              type="button"
                              disabled={cancelLoadingId === order.id}
                              onClick={() => setConfirmCancelOrderId(null)}
                              className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Manter Pedido
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmCancelOrderId(order.id)}
                            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white transition hover:bg-red-700"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Cancelar Pedido e Liberar Estoque
                          </button>
                        )
                      )}
                    </div>
                  )}

                  {/* Punctual commission-only discount (R04) */}
                  {order.status !== 'cancelled' && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-slate-800">
                          Desconto Pontual (exclusivo sobre sua comissão)
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Margem disponível para desconto: {formatBRL(commissionPool)} (custo da fábrica preservado).
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={dMode}
                          onChange={(e) =>
                            setDiscountModeMap((p) => ({
                              ...p,
                              [order.id]: e.target.value as 'fixed' | 'percent',
                            }))
                          }
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold"
                        >
                          <option value="fixed">R$</option>
                          <option value="percent">%</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={dValStr}
                          onChange={(e) =>
                            setDiscountValueMap((p) => ({
                              ...p,
                              [order.id]: e.target.value,
                            }))
                          }
                          placeholder="0"
                          className="h-9 w-24 rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const val = Math.max(
                              0,
                              Number.parseFloat(dValStr.replace(',', '.')) || 0
                            );
                            await onApplyPunctualDiscount(order, dMode, val);
                            setFeedback(
                              `Desconto aplicado no pedido ${order.orderCode} sem alterar o custo das fábricas.`
                            );
                          }}
                          className="h-9 rounded-lg bg-[#0D2B3E] px-3 text-xs font-semibold text-white hover:bg-[#143d57]"
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Split Breakdown & Asaas Payment Issuance */}
                  {order.status !== 'cancelled' && (() => {
                    const selectedMethod =
                      orderPayMethodMap[order.id] ?? order.paymentMethod ?? 'pix';
                    const selectedInst =
                      orderInstMap[order.id] ?? order.installments ?? 1;
                    const liveBreakdown = calculateOrderSplit({
                      orderTotal: order.buyerFinalTotal,
                      factoryCostTotal: order.factoryCostTotal,
                      paymentMethod: selectedMethod,
                      installments: selectedInst,
                      isDirectManufacturerSale:
                        order.factoryIds.length === 1 &&
                        order.factoryIds[0] === order.resellerId &&
                        Math.abs(order.buyerFinalTotal - order.factoryCostTotal) < 0.01,
                      subOrders: order.subOrders.map((s) => ({
                        id: s.id,
                        subOrderCode: s.subOrderCode,
                        factoryId: s.factoryId,
                        factoryName: s.factoryName,
                        factoryCost: s.factoryCost,
                      })),
                    });
                    const chargeRes = chargeResultsByOrder[order.id];
                    const resolvedChargeId = chargeRes?.chargeId || order.asaasChargeId;
                    const resolvedStatus = chargeRes?.status || order.asaasChargeStatus;
                    const resolvedInvoiceUrl = chargeRes?.invoiceUrl || order.asaasInvoiceUrl;
                    const resolvedPixPayload =
                      chargeRes?.pixCopyPaste || order.asaasPixPayload;

                    return (
                      <div className="space-y-3">
                        <SplitBreakdownCard
                          breakdown={liveBreakdown}
                          title={`Extrato do Split & Taxas — Pedido ${order.orderCode}`}
                          factoryLabel="Líquido Fabricante"
                          resellerLabel="Líquido Revendedor (Você)"
                          asaasChargeStatus={resolvedStatus}
                          asaasChargeId={resolvedChargeId}
                          showMethodToggle
                          onChangeMethod={(m) =>
                            setOrderPayMethodMap((p) => ({ ...p, [order.id]: m }))
                          }
                          onChangeInstallments={(n) =>
                            setOrderInstMap((p) => ({ ...p, [order.id]: n }))
                          }
                        />

                        <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="space-y-0.5">
                              <p className="text-xs font-bold text-slate-900">
                                Cobrança Asaas com Split Automático
                              </p>
                              <p className="text-[11px] font-mono text-slate-500">
                                {resolvedChargeId
                                  ? `ID: ${resolvedChargeId} · Status: ${formatAsaasStatusLabel(resolvedStatus).label}`
                                  : 'Nenhuma cobrança emitida ainda para este pedido'}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              {onGenerateAsaasCharge && (
                                <button
                                  type="button"
                                  disabled={chargeLoadingId === order.id}
                                  onClick={async () => {
                                    setChargeLoadingId(order.id);
                                    setFeedback('');
                                    try {
                                      const res = await onGenerateAsaasCharge(
                                        order,
                                        selectedMethod,
                                        selectedInst
                                      );
                                      setChargeResultsByOrder((p) => ({
                                        ...p,
                                        [order.id]: res,
                                      }));
                                      setActiveModalCharge(
                                        toAsaasChargeModalData(res, order.orderCode, order.id)
                                      );
                                      setFeedback(
                                        res.mode === 'live'
                                          ? `Cobrança Asaas (${res.chargeId}) emitida com split para o pedido ${order.orderCode}!`
                                          : `Cobrança Asaas preparada (${res.chargeId}).`
                                      );
                                    } catch (err) {
                                      setFeedback(
                                        err instanceof Error
                                          ? err.message
                                          : 'Falha ao gerar cobrança Asaas.'
                                      );
                                    } finally {
                                      setChargeLoadingId(null);
                                    }
                                  }}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0E7A34] px-3 text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
                                >
                                  {selectedMethod === 'pix' ? (
                                    <QrCode className="h-3.5 w-3.5" />
                                  ) : (
                                    <CreditCard className="h-3.5 w-3.5" />
                                  )}
                                  {chargeLoadingId === order.id
                                    ? 'Gerando...'
                                    : resolvedChargeId
                                      ? 'Regerar Cobrança Asaas'
                                      : 'Gerar Cobrança Asaas'}
                                </button>
                              )}

                              {resolvedChargeId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (chargeRes) {
                                      setActiveModalCharge(
                                        toAsaasChargeModalData(
                                          chargeRes,
                                          order.orderCode,
                                          order.id
                                        )
                                      );
                                    } else {
                                      setActiveModalCharge({
                                        orderId: order.id,
                                        orderCode: order.orderCode,
                                        mode: resolvedInvoiceUrl ? 'live' : 'preview',
                                        chargeId: resolvedChargeId,
                                        asaasStatus: resolvedStatus,
                                        invoiceUrl: resolvedInvoiceUrl,
                                        pixCopyPaste: resolvedPixPayload,
                                        splitBreakdown: liveBreakdown,
                                      });
                                    }
                                  }}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0D2B3E] px-3 text-xs font-semibold text-white hover:bg-[#143d57]"
                                >
                                  <QrCode className="h-3.5 w-3.5" />
                                  QR Code & Fatura
                                </button>
                              )}

                              {onSyncAsaasStatus && resolvedChargeId && (
                                <button
                                  type="button"
                                  disabled={syncLoadingId === order.id}
                                  onClick={async () => {
                                    setSyncLoadingId(order.id);
                                    try {
                                      await onSyncAsaasStatus(order);
                                      setFeedback(
                                        `Status Asaas do pedido ${order.orderCode} atualizado.`
                                      );
                                    } catch (err) {
                                      setFeedback(
                                        err instanceof Error
                                          ? err.message
                                          : 'Falha ao consultar status Asaas.'
                                      );
                                    } finally {
                                      setSyncLoadingId(null);
                                    }
                                  }}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                >
                                  <RefreshCw
                                    className={`h-3.5 w-3.5 ${
                                      syncLoadingId === order.id ? 'animate-spin' : ''
                                    }`}
                                  />
                                  Já paguei / Verificar Status
                                </button>
                              )}
                            </div>
                          </div>

                          {chargeRes?.missingWallets && chargeRes.missingWallets.length > 0 && (
                            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                              Wallet ID pendente para:{' '}
                              {chargeRes.missingWallets.map((w) => w.label).join(', ')}. Cadastre
                              no campo Wallet ID Asaas no topo antes de emitir no modo produção.
                            </p>
                          )}

                          {(resolvedPixPayload || resolvedInvoiceUrl) && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              {resolvedPixPayload && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    void navigator.clipboard
                                      ?.writeText(resolvedPixPayload)
                                      .then(() => setFeedback('Código Pix Copia e Cola copiado!'));
                                  }}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-semibold text-[#0E7A34] hover:bg-emerald-100"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  Copiar Código Pix
                                </button>
                              )}
                              {resolvedInvoiceUrl && (
                                <a
                                  href={resolvedInvoiceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-[#0D2B3E] hover:bg-slate-100"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Abrir Fatura / Pagar com Cartão
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Mutual Awareness & Payment Release Terms (Reseller + Buyer) */}
                  {(() => {
                    const currentResellerPref =
                      order.resellerReleasePreference ??
                      profile.resellerReleasePreference ??
                      'upon_carrier_receipt';
                    const draftPref =
                      orderReleasePrefDraftMap[order.id] ?? currentResellerPref;
                    const draftNote =
                      orderReleaseNoteDraftMap[order.id] ??
                      order.resellerReleaseNote ??
                      profile.resellerReleaseNote ??
                      '';
                    const resellerMeta = getResellerReleaseOptionMeta(currentResellerPref);
                    const buyerMeta = getBuyerReleaseOptionMeta(order.buyerReleaseOption);
                    const shareStatusMeta = getResellerShareReleaseStatusLabel(
                      order.resellerShareReleaseStatus
                    );
                    const divergence = hasPreferenceDivergence(
                      currentResellerPref,
                      order.buyerReleaseOption
                    );
                    const canEditOrderPref =
                      Boolean(onUpdateOrderReleasePreference) &&
                      order.status !== 'completed' &&
                      order.status !== 'cancelled';

                    return (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                            <Handshake className="h-4 w-4 text-[#0E7A34]" />
                            Ciência Mútua · Condições de Liberação do Pagamento
                          </span>
                          <span
                            className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                              shareStatusMeta.tone === 'green'
                                ? 'bg-emerald-100 text-[#0E7A34]'
                                : shareStatusMeta.tone === 'amber'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {shareStatusMeta.label}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-0.5">
                            <span className="block text-[10px] font-semibold uppercase text-slate-400">
                              Opção escolhida pelo Cliente Final
                            </span>
                            <span className="block font-bold text-[#0E7A34]">
                              {buyerMeta.title}
                            </span>
                            <span className="block text-[11px] text-slate-500">
                              {buyerMeta.description}
                            </span>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-0.5">
                            <span className="block text-[10px] font-semibold uppercase text-slate-400">
                              Sua preferência registrada neste pedido
                            </span>
                            <span className="block font-bold text-slate-900">
                              {resellerMeta.title}
                            </span>
                            {order.resellerReleaseNote && (
                              <span className="block text-[11px] text-slate-600">
                                Obs.: {order.resellerReleaseNote}
                              </span>
                            )}
                          </div>
                        </div>

                        {divergence && (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                            <span>
                              <strong>Atenção:</strong> sua preferência ({resellerMeta.shortLabel}) difere da escolha do cliente ({buyerMeta.shortLabel}). Alinhe pelo chat ou registre abaixo antes de despachar.
                            </span>
                          </div>
                        )}

                        {canEditOrderPref && onUpdateOrderReleasePreference && (
                          <div className="grid grid-cols-1 gap-2 border-t border-slate-200/80 pt-2 sm:grid-cols-12">
                            <select
                              value={draftPref}
                              onChange={(e) =>
                                setOrderReleasePrefDraftMap((p) => ({
                                  ...p,
                                  [order.id]: e.target.value as ResellerReleasePreference,
                                }))
                              }
                              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold sm:col-span-5"
                            >
                              {RESELLER_RELEASE_OPTIONS.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.title}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={draftNote}
                              onChange={(e) =>
                                setOrderReleaseNoteDraftMap((p) => ({
                                  ...p,
                                  [order.id]: e.target.value,
                                }))
                              }
                              placeholder="Observação opcional (ex.: envio após liberação / prazo)"
                              maxLength={240}
                              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs sm:col-span-4"
                            />
                            <button
                              type="button"
                              disabled={savingOrderPrefId === order.id}
                              onClick={async () => {
                                setSavingOrderPrefId(order.id);
                                try {
                                  await onUpdateOrderReleasePreference(
                                    order,
                                    draftPref,
                                    draftNote.trim()
                                  );
                                  setFeedback(
                                    `Preferência de liberação do pedido ${order.orderCode} atualizada e registrada no histórico.`
                                  );
                                } finally {
                                  setSavingOrderPrefId(null);
                                }
                              }}
                              className="h-9 rounded-lg bg-[#0D2B3E] px-3 text-xs font-semibold text-white hover:bg-[#143d57] disabled:opacity-50 sm:col-span-3"
                            >
                              {savingOrderPrefId === order.id
                                ? 'Salvando...'
                                : 'Atualizar Regra'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Sub-orders & Post-Confirmation Logistics (R05) */}
                  <div className="space-y-3">
                    {order.subOrders.map((sub) => {
                      const unlocked =
                        sub.status === 'confirmed' ||
                        sub.status === 'partial_confirmed' ||
                        sub.status === 'logistics_sent' ||
                        sub.status === 'dispatched' ||
                        sub.status === 'completed';
                      const lType =
                        logTypeMap[sub.id] ??
                        (sub.logisticsType !== 'none'
                          ? sub.logisticsType
                          : 'transportadora');
                      const lCompany =
                        logCompanyMap[sub.id] ?? sub.logisticsCompany ?? '';
                      const lAddress =
                        logAddressMap[sub.id] ?? sub.logisticsAddress ?? '';
                      const lDeadlineDays =
                        logDeadlineDaysMap[sub.id] ??
                        String(
                          sub.carrierDeadlineDays ??
                            profile.defaultCarrierDeadlineDays ??
                            7
                        );

                      return (
                        <div
                          key={sub.id}
                          className="rounded-xl border border-slate-200 p-3.5 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="text-xs font-bold text-slate-900">
                                {sub.subOrderCode} · {sub.factoryName}
                              </span>
                              <span className="ml-2 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                {sub.status === 'pending_inquiry'
                                  ? 'Aguardando fábrica confirmar estoque'
                                  : sub.status === 'partial_confirmed'
                                    ? 'Confirmado com corte parcial'
                                    : sub.status === 'confirmed'
                                      ? 'Estoque confirmado pela fábrica'
                                      : sub.status === 'logistics_sent'
                                        ? 'Logística enviada à fábrica'
                                        : sub.status === 'dispatched'
                                          ? 'Despachado pela fábrica'
                                          : sub.status === 'completed'
                                            ? 'Recebimento confirmado'
                                            : sub.status === 'cancelled'
                                              ? 'Cancelado'
                                              : sub.status}
                              </span>
                            </div>
                            <span className="font-mono text-xs font-bold text-slate-700 tabular-nums">
                              Custo: {formatBRL(sub.factoryCost)}
                            </span>
                          </div>

                          {order.status === 'cancelled' || sub.status === 'cancelled' ? (
                            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                              <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                              <span>Subpedido cancelado e itens liberados para o estoque da fábrica.</span>
                            </div>
                          ) : !unlocked ? (
                            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                              <Lock className="h-4 w-4 shrink-0 text-slate-400" />
                              <span>
                                Logística bloqueada até o fabricante confirmar a disponibilidade do estoque.
                              </span>
                            </div>
                          ) : sub.status === 'dispatched' || sub.status === 'completed' ? (
                            <div className="rounded-lg bg-emerald-50 p-3 text-xs text-[#0E7A34] space-y-2">
                              <p className="font-semibold">
                                Despachado via {sub.logisticsType} ({sub.logisticsCompany}) ·{' '}
                                {sub.receiptNote || 'Comprovante anexado'}
                              </p>
                              {(sub.carrierDeadlineDays || sub.carrierDeadlineAtMs) && (
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#0D2B3E]">
                                  <span className="inline-flex items-center gap-1.5 font-medium">
                                    <CalendarClock className="h-3.5 w-3.5" />
                                    {formatCarrierDeadlineSummary({
                                      deadlineDays: sub.carrierDeadlineDays,
                                      deadlineAtMs: sub.carrierDeadlineAtMs,
                                      extensions: sub.carrierDeadlineExtensions,
                                      nowMs,
                                    })}
                                  </span>
                                  {sub.status === 'dispatched' && onExtendCarrierDeadline && (
                                    <button
                                      type="button"
                                      disabled={extendingSubId === sub.id}
                                      onClick={async () => {
                                        setExtendingSubId(sub.id);
                                        try {
                                          await onExtendCarrierDeadline(order, sub);
                                          setFeedback(
                                            `Prazo da transportadora do subpedido ${sub.subOrderCode} prorrogado em +5 dias.`
                                          );
                                        } finally {
                                          setExtendingSubId(null);
                                        }
                                      }}
                                      className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                                    >
                                      <Clock className="h-3 w-3" />
                                      {extendingSubId === sub.id ? 'Prorrogando...' : '+5 dias (Prorrogar)'}
                                    </button>
                                  )}
                                </div>
                              )}
                              {sub.receiptUrl && (
                                <img
                                  src={sub.receiptUrl}
                                  alt="Comprovante de despacho"
                                  className="mt-2 h-28 rounded-lg object-cover"
                                />
                              )}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {sub.status === 'logistics_sent' && (
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                  <div className="space-y-0.5">
                                    <p className="font-semibold text-slate-900">
                                      Logística informada: {sub.logisticsType.toUpperCase()} — {sub.logisticsCompany}
                                    </p>
                                    <p className="text-[11px] text-slate-500">
                                      {formatCarrierDeadlineSummary({
                                        deadlineDays: sub.carrierDeadlineDays,
                                        deadlineAtMs: sub.carrierDeadlineAtMs,
                                        extensions: sub.carrierDeadlineExtensions,
                                        nowMs,
                                      })}
                                    </p>
                                  </div>
                                  {onExtendCarrierDeadline && (
                                    <button
                                      type="button"
                                      disabled={extendingSubId === sub.id}
                                      onClick={async () => {
                                        setExtendingSubId(sub.id);
                                        try {
                                          await onExtendCarrierDeadline(order, sub);
                                          setFeedback(
                                            `Prazo da transportadora do subpedido ${sub.subOrderCode} prorrogado em +5 dias.`
                                          );
                                        } finally {
                                          setExtendingSubId(null);
                                        }
                                      }}
                                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                                    >
                                      <Clock className="h-3.5 w-3.5" />
                                      {extendingSubId === sub.id ? 'Prorrogando...' : '+5 dias (Prorrogar)'}
                                    </button>
                                  )}
                                </div>
                              )}

                              <div className="grid grid-cols-1 gap-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 sm:grid-cols-4">
                                <select
                                  value={lType}
                                  onChange={(e) =>
                                    setLogTypeMap((p) => ({
                                      ...p,
                                      [sub.id]: e.target.value as LogisticsType,
                                    }))
                                  }
                                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold"
                                >
                                  <option value="transportadora">Transportadora</option>
                                  <option value="distribuidora">Distribuidora</option>
                                </select>
                                <input
                                  type="text"
                                  value={lCompany}
                                  onChange={(e) =>
                                    setLogCompanyMap((p) => ({
                                      ...p,
                                      [sub.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Nome da transportadora/distribuidora"
                                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs"
                                />
                                <input
                                  type="text"
                                  value={lAddress}
                                  onChange={(e) =>
                                    setLogAddressMap((p) => ({
                                      ...p,
                                      [sub.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Endereço / ponto de despacho"
                                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs"
                                />
                                <input
                                  type="number"
                                  min="1"
                                  max="180"
                                  value={lDeadlineDays}
                                  onChange={(e) =>
                                    setLogDeadlineDaysMap((p) => ({
                                      ...p,
                                      [sub.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Prazo (dias)"
                                  title="Prazo estimado da transportadora em dias"
                                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!lCompany.trim() || !lAddress.trim()) return;
                                    const parsedDays = Math.min(
                                      180,
                                      Math.max(1, Math.round(Number(lDeadlineDays) || 7))
                                    );
                                    await onSubmitLogistics(
                                      sub,
                                      lType,
                                      lCompany.trim(),
                                      lAddress.trim(),
                                      parsedDays
                                    );
                                    setFeedback(
                                      `Dados da transportadora e prazo de ${parsedDays} dia(s) enviados para ${sub.factoryName}.`
                                    );
                                  }}
                                  className="sm:col-span-4 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27]"
                                >
                                  <Truck className="h-4 w-4" />
                                  Enviar Dados e Prazo da Transportadora para a Fábrica
                                </button>
                              </div>
                            </div>
                          )}

                          {sub.factoryId !== profile.uid &&
                            order.status !== 'cancelled' &&
                            sub.status !== 'cancelled' && (() => {
                              const canConfirmReceipt =
                                Boolean(onConfirmSubOrderDelivered) &&
                                sub.status === 'dispatched';
                              const canRateFactory =
                                Boolean(onSubmitReview) &&
                                (sub.status === 'dispatched' || sub.status === 'completed');
                              const canReportFactory =
                                Boolean(onSubmitDeliveryReport) &&
                                (sub.status === 'confirmed' ||
                                  sub.status === 'partial_confirmed' ||
                                  sub.status === 'logistics_sent' ||
                                  sub.status === 'dispatched' ||
                                  sub.status === 'completed');
                              const existingFactoryReview = writtenReviews.find(
                                (r) =>
                                  r.orderId === order.id &&
                                  r.targetUid === sub.factoryId &&
                                  r.targetRole === 'manufacturer'
                              );
                              if (!canConfirmReceipt && !canRateFactory && !canReportFactory) {
                                return null;
                              }
                              return (
                                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                                  {canConfirmReceipt && onConfirmSubOrderDelivered && (
                                    <button
                                      type="button"
                                      disabled={confirmSubDeliveryId === sub.id}
                                      onClick={async () => {
                                        setConfirmSubDeliveryId(sub.id);
                                        try {
                                          await onConfirmSubOrderDelivered(order, sub);
                                          setFeedback(
                                            `Recebimento do subpedido ${sub.subOrderCode} confirmado.`
                                          );
                                        } finally {
                                          setConfirmSubDeliveryId(null);
                                        }
                                      }}
                                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-[#0E7A34] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-60"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      {confirmSubDeliveryId === sub.id
                                        ? 'Confirmando...'
                                        : 'Confirmar Recebimento'}
                                    </button>
                                  )}

                                  {canRateFactory && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReviewTarget({
                                          orderId: order.id,
                                          orderCode: order.orderCode,
                                          subOrderId: sub.id,
                                          targetUid: sub.factoryId,
                                          targetName: sub.factoryName,
                                          targetRole: 'manufacturer',
                                          reviewerRole: 'reseller',
                                          existingReview: existingFactoryReview,
                                        })
                                      }
                                      className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                                        existingFactoryReview
                                          ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100/70'
                                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                      }`}
                                    >
                                      <Star
                                        className={`h-3.5 w-3.5 ${
                                          existingFactoryReview
                                            ? 'fill-amber-400 text-amber-500'
                                            : 'text-amber-500'
                                        }`}
                                      />
                                      {existingFactoryReview
                                        ? `Avaliado: ${existingFactoryReview.stars}★`
                                        : 'Avaliar Fabricante'}
                                    </button>
                                  )}

                                  {canReportFactory && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReportTarget({
                                          orderId: order.id,
                                          orderCode: order.orderCode,
                                          subOrderId: sub.id,
                                          subOrderCode: sub.subOrderCode,
                                          reportedUid: sub.factoryId,
                                          reportedName: sub.factoryName,
                                          reportedRole: 'manufacturer',
                                          reporterRole: 'reseller',
                                        })
                                      }
                                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                    >
                                      <FileWarning className="h-3.5 w-3.5" />
                                      Ocorrência na entrega
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                        </div>
                      );
                    })}
                  </div>

                  {(order.orderAgreementHistory?.length ?? 0) > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedHistoryOrderIds((p) => ({
                            ...p,
                            [order.id]: !p[order.id],
                          }))
                        }
                        className="inline-flex items-center gap-1.5 font-semibold text-[#0D2B3E] hover:underline"
                      >
                        <History className="h-3.5 w-3.5" />
                        {expandedHistoryOrderIds[order.id]
                          ? `Ocultar histórico registrado do pedido (${order.orderAgreementHistory?.length})`
                          : `Ver histórico registrado do pedido (${order.orderAgreementHistory?.length})`}
                      </button>
                      {expandedHistoryOrderIds[order.id] && (
                        <div className="mt-2 space-y-1.5">
                          {(order.orderAgreementHistory || []).map((entry) => (
                            <div
                              key={entry.id}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px]"
                            >
                              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                                <span className="font-semibold text-slate-600">
                                  {entry.actorName}
                                </span>
                                <span className="font-mono">{entry.dateLabel}</span>
                              </div>
                              <p className="mt-0.5 text-slate-700">{entry.summary}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {onOpenHelp && (
                    <div className="flex justify-end border-t border-slate-100 pt-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          onOpenHelp({
                            defaultTab: 'ticket',
                            orderId: order.id,
                            orderCode: order.orderCode,
                            reason: 'Dúvida sobre Pedido',
                          })
                        }
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-[#0D2B3E]"
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                        Precisa de ajuda?
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 4: DUAL FINANCE (R06) */}
      {activeTab === 'finance' && (
        <div className="space-y-5">
          <WalletIdSplitCard
            currentWalletId={profile.asaasWalletId}
            onSaveWalletId={onSaveWalletId}
            roleHint="Informe a Wallet ID Asaas da sua loja para recebimento automático do Split."
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold text-slate-500">
                A Receber de Clientes
              </span>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0E7A34] tabular-nums">
                {formatBRL(totalReceivable)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold text-slate-500">
                A Pagar às Fábricas
              </span>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0D2B3E] tabular-nums">
                {formatBRL(totalPayable)}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <span className="text-xs font-semibold text-[#0E7A34]">
                Lucro Líquido Estimado
              </span>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0E7A34] tabular-nums">
                {formatBRL(estimatedNetProfit)}
              </p>
            </div>
          </div>

          {/* Layer 2: Receivables */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                A Receber de Clientes ({receivables.length})
              </h3>
            </div>
            {receivables.length === 0 ? (
              <p className="p-5 text-xs text-slate-500">
                Nenhum recebimento registrado ainda.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {receivables.map((pay) => {
                  const linkedOrder = orders.find((o) => o.id === pay.orderId);
                  const split = linkedOrder
                    ? calculateOrderSplit({
                        orderTotal: linkedOrder.buyerFinalTotal,
                        factoryCostTotal: linkedOrder.factoryCostTotal,
                        paymentMethod: linkedOrder.paymentMethod || 'pix',
                        installments: linkedOrder.installments || 1,
                        isDirectManufacturerSale: false,
                      })
                    : null;
                  const factoryNet =
                    linkedOrder?.splitFactoryNet ??
                    split?.factoryNetTotal ??
                    pay.costReference ??
                    0;
                  const resellerNet =
                    typeof pay.netAmount === 'number'
                      ? pay.netAmount
                      : linkedOrder?.splitResellerNet ?? split?.resellerNetTotal ?? 0;
                  const platformFee =
                    pay.platformFeeGross ??
                    linkedOrder?.platformFeeGross ??
                    split?.platformGrossFee;
                  const statusInfo = formatAsaasStatusLabel(
                    linkedOrder?.asaasChargeStatus || pay.asaasChargeStatus || pay.status
                  );

                  return (
                    <div
                      key={pay.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-slate-900">
                            Pedido {pay.orderCode} · {pay.counterpartyName}
                          </p>
                          <span
                            className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                              statusInfo.tone === 'confirmed'
                                ? 'bg-emerald-100 text-[#0E7A34]'
                                : statusInfo.tone === 'overdue'
                                  ? 'bg-red-100 text-red-700'
                                  : statusInfo.tone === 'partial'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {statusInfo.tone === 'confirmed' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <Clock className="h-3 w-3" />
                            )}
                            Asaas: {statusInfo.shortLabel}
                          </span>
                        </div>

                        <p className="font-mono text-xs text-slate-500 tabular-nums">
                          Vencimento: {pay.dueDate} · Total Pedido:{' '}
                          <strong className="text-slate-900">{formatBRL(pay.amount)}</strong>
                        </p>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-[11px] tabular-nums">
                          <span className="text-[#0D2B3E]">
                            Líquido Fabricante: <strong>{formatBRL(factoryNet)}</strong>
                          </span>
                          <span className="text-[#0E7A34]">
                            Líquido Revendedor: <strong>{formatBRL(resellerNet)}</strong>
                          </span>
                          {typeof platformFee === 'number' && (
                            <span className="text-slate-600">
                              Taxa ChatFi: <strong>{formatBRL(platformFee)}</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {pay.status === 'Cancelado' || linkedOrder?.status === 'cancelled' ? (
                          <span className="inline-flex h-9 items-center gap-1 rounded-lg bg-red-100 px-3 text-xs font-bold text-red-700">
                            <XCircle className="h-3.5 w-3.5" />
                            Cancelado
                          </span>
                        ) : (
                          <>
                            {onSyncAsaasStatus && linkedOrder?.asaasChargeId && (
                              <button
                                type="button"
                                disabled={syncLoadingId === linkedOrder.id}
                                onClick={async () => {
                                  setSyncLoadingId(linkedOrder.id);
                                  try {
                                    await onSyncAsaasStatus(linkedOrder);
                                    setFeedback(
                                      `Status Asaas do pedido ${pay.orderCode} atualizado.`
                                    );
                                  } finally {
                                    setSyncLoadingId(null);
                                  }
                                }}
                                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                              >
                                <RefreshCw
                                  className={`h-3.5 w-3.5 ${
                                    syncLoadingId === linkedOrder.id ? 'animate-spin' : ''
                                  }`}
                                />
                                Verificar Status
                              </button>
                            )}
                            <select
                              value={pay.method}
                              onChange={(e) =>
                                void onUpdatePayment(pay.id, {
                                  method: e.target.value as PaymentMethod,
                                })
                              }
                              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                            >
                              {(['À vista', 'Cartão', 'Cheque', 'Notinha'] as PaymentMethod[]).map(
                                (m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                )
                              )}
                            </select>
                            <select
                              value={pay.status}
                              onChange={(e) =>
                                void onUpdatePayment(pay.id, {
                                  status: e.target.value as PaymentStatus,
                                })
                              }
                              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold"
                            >
                              {(['Aguardando', 'Parcial', 'Quitado', 'Em Atraso', 'Cancelado'] as PaymentStatus[]).map(
                                (s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                )
                              )}
                            </select>
                            <button
                              type="button"
                              onClick={async () => {
                                await onSendBillingReminder(pay);
                                setFeedback(
                                  `Lembrete financeiro do pedido ${pay.orderCode} enviado no chat de ${pay.counterpartyName}.`
                                );
                              }}
                              className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#F97316] px-3 text-xs font-semibold text-white hover:bg-orange-600"
                            >
                              <Send className="h-3.5 w-3.5" />
                              Cobrar no Chat
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Layer 1: Payables */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                A Pagar às Fábricas ({payables.length})
              </h3>
            </div>
            {payables.length === 0 ? (
              <p className="p-5 text-xs text-slate-500">
                Nenhum repasse para fábrica pendente.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {payables.map((pay) => {
                  const linkedOrder = orders.find((o) => o.id === pay.orderId);
                  const split = linkedOrder
                    ? calculateOrderSplit({
                        orderTotal: linkedOrder.buyerFinalTotal,
                        factoryCostTotal: linkedOrder.factoryCostTotal,
                        paymentMethod: linkedOrder.paymentMethod || 'pix',
                        installments: linkedOrder.installments || 1,
                        isDirectManufacturerSale: false,
                      })
                    : null;
                  const factoryNet =
                    typeof pay.netAmount === 'number'
                      ? pay.netAmount
                      : linkedOrder?.splitFactoryNet ?? split?.factoryNetTotal ?? pay.amount;
                  const resellerNet =
                    linkedOrder?.splitResellerNet ?? split?.resellerNetTotal;
                  const statusInfo = formatAsaasStatusLabel(
                    linkedOrder?.asaasChargeStatus || pay.asaasChargeStatus || pay.status
                  );

                  return (
                    <div
                      key={pay.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-slate-900">
                            {pay.subOrderCode || pay.orderCode}
                          </p>
                          <span
                            className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                              statusInfo.tone === 'confirmed'
                                ? 'bg-emerald-100 text-[#0E7A34]'
                                : statusInfo.tone === 'overdue'
                                  ? 'bg-red-100 text-red-700'
                                  : statusInfo.tone === 'partial'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {statusInfo.tone === 'confirmed' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <Clock className="h-3 w-3" />
                            )}
                            Asaas: {statusInfo.shortLabel}
                          </span>
                        </div>
                        <p className="font-mono text-xs text-slate-500 tabular-nums">
                          Vencimento: {pay.dueDate} · {pay.method} · Status:{' '}
                          <strong>{pay.status}</strong>
                        </p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-[11px] tabular-nums">
                          <span className="text-[#0D2B3E]">
                            Líquido Fabricante: <strong>{formatBRL(factoryNet)}</strong>
                          </span>
                          {typeof resellerNet === 'number' && (
                            <span className="text-[#0E7A34]">
                              Líquido Revendedor: <strong>{formatBRL(resellerNet)}</strong>
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-sm font-bold text-[#0D2B3E] tabular-nums">
                        {formatBRL(pay.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 5: STOREFRONT IDENTITY (R01) */}
      {activeTab === 'identity' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await onSaveStorefrontIdentity(
              storefrontName.trim() || profile.name,
              storefrontPrivacy
            );
            setFeedback('Identidade da sua vitrine comercial atualizada.');
          }}
          className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
        >
          <h2 className="text-sm font-bold text-slate-900">
            Dados da Minha Vitrine
          </h2>
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-[#0E7A34]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Na sua vitrine pública, o comprador final vê apenas o nome da sua loja e lotes anônimos (Lote A, Lote B). Nunca exibimos o rótulo &ldquo;revendedor&rdquo; nem os nomes/telefones das fábricas parceiras.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Nome público da vitrine
            </label>
            <input
              type="text"
              required
              value={storefrontName}
              onChange={(e) => setStorefrontName(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#0E7A34] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Privacidade de acesso
            </label>
            <select
              value={storefrontPrivacy}
              onChange={(e) =>
                setStorefrontPrivacy(e.target.value as 'open' | 'approved')
              }
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="open">Aberta para todos os contatos da agenda</option>
              <option value="approved">Apenas contatos aprovados</option>
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
            <label className="block text-xs font-bold text-slate-800">
              Desconto Visual na Vitrine (&ldquo;De / Por&rdquo;)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ANCHOR_DISCOUNT_PRESETS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  disabled={savingAnchorDiscount}
                  onClick={() => void handleSelectAnchorDiscount(pct)}
                  className={`min-h-[34px] rounded-lg px-3 text-xs font-bold transition ${
                    anchorDiscountPct === pct
                      ? 'bg-[#0E7A34] text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {pct === 0 ? 'Sem desconto' : `${pct}% OFF`}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              {sampleAnchorOriginalPrice
                ? `Prévia: De ${formatBRL(sampleAnchorOriginalPrice)} → Por ${formatBRL(samplePreviewSellingPrice)} (${anchorDiscountPct}% OFF). O Split e o seu lucro líquido não mudam.`
                : 'Exibindo apenas o preço final único nos cards da vitrine.'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Handshake className="h-3.5 w-3.5 text-[#0E7A34]" />
                Preferência Padrão de Liberação do Pagamento (Exibida ao Cliente)
              </label>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Deixe claro para seus clientes antes do pedido qual é sua preferência de liberação e prazo padrão de transportadora.
              </p>
            </div>

            <div className="space-y-2">
              {RESELLER_RELEASE_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-xs transition ${
                    releasePref === opt.id
                      ? 'border-[#0E7A34] bg-white ring-1 ring-[#0E7A34]'
                      : 'border-slate-200 bg-white/80 hover:bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="reseller-release-pref"
                    checked={releasePref === opt.id}
                    onChange={() => setReleasePref(opt.id)}
                    className="mt-0.5 accent-[#0E7A34]"
                  />
                  <div>
                    <span className="block font-bold text-slate-900">{opt.title}</span>
                    <span className="block text-[11px] text-slate-500">{opt.description}</span>
                  </div>
                </label>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Observação sobre envio / comprovação (opcional)
                </label>
                <input
                  type="text"
                  value={releaseNote}
                  onChange={(e) => setReleaseNote(e.target.value)}
                  maxLength={240}
                  placeholder="Ex.: Envio em até 24h úteis após confirmação com comprovante"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs focus:border-[#0E7A34] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700">
                  Prazo padrão transportadora (dias)
                </label>
                <input
                  type="number"
                  min="1"
                  max="180"
                  value={defaultCarrierDays}
                  onChange={(e) => setDefaultCarrierDays(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs focus:border-[#0E7A34] focus:outline-none"
                />
              </div>
            </div>

            {onSaveReleasePreferences && (
              <button
                type="button"
                disabled={savingReleasePrefs}
                onClick={async () => {
                  setSavingReleasePrefs(true);
                  try {
                    const days = Math.min(
                      180,
                      Math.max(1, Math.round(Number(defaultCarrierDays) || 7))
                    );
                    await onSaveReleasePreferences({
                      resellerReleasePreference: releasePref,
                      resellerReleaseNote: releaseNote.trim(),
                      defaultCarrierDeadlineDays: days,
                    });
                    setFeedback('Preferência de liberação e prazo padrão salvos na sua vitrine.');
                  } finally {
                    setSavingReleasePrefs(false);
                  }
                }}
                className="h-9 w-full rounded-lg bg-[#0D2B3E] text-xs font-semibold text-white hover:bg-[#143d57] disabled:opacity-50"
              >
                {savingReleasePrefs
                  ? 'Salvando preferência...'
                  : 'Salvar Regra de Liberação e Prazo Padrão'}
              </button>
            )}
          </div>

          <button
            type="submit"
            className="h-11 w-full rounded-xl bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27]"
          >
            Salvar Configurações da Vitrine
          </button>

          <div className="border-t border-slate-100 pt-4">
            <WalletIdSplitCard
              compact
              currentWalletId={profile.asaasWalletId}
              onSaveWalletId={onSaveWalletId}
            />
          </div>
        </form>
      )}

      <AsaasChargeModal
        isOpen={Boolean(activeModalCharge)}
        data={activeModalCharge}
        onClose={() => setActiveModalCharge(null)}
        onVerifyStatus={async (orderId) => {
          const order = myOrders.find((o) => o.id === orderId);
          if (!order || !onSyncAsaasStatus) return null;
          return onSyncAsaasStatus(order);
        }}
        onCopySuccess={(msg) => setFeedback(msg)}
      />

      {reviewTarget && onSubmitReview && (
        <StarReviewModal
          key={`${reviewTarget.orderId}_${reviewTarget.targetUid}_${reviewTarget.targetRole}`}
          target={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onSubmitReview={async (params) => {
            await onSubmitReview(params);
            setFeedback(
              `Avaliação de ${params.stars} estrela(s) registrada para ${params.targetName}.`
            );
          }}
        />
      )}

      {reportTarget && onSubmitDeliveryReport && (
        <DeliveryReportModal
          key={`${reportTarget.orderId}_${reportTarget.reportedUid}_${reportTarget.reportedRole}`}
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmitReport={async (params) => {
            const res = await onSubmitDeliveryReport(params);
            setFeedback(
              `Ocorrência ${res.reportCode} registrada e vinculada ao chamado ${res.ticketCode}.`
            );
            return res;
          }}
        />
      )}
    </div>
  );
};
