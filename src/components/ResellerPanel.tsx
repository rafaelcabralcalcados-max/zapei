import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
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
  Store,
  Tag,
  Truck,
  X,
} from 'lucide-react';
import type {
  CategoryMargin,
  DualPaymentRecord,
  FactoryConnection,
  LogisticsType,
  MixedOrder,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductCategory,
  SplitPaymentMethod,
  SubOrder,
  UserProfile,
} from '../types/zapei';
import {
  formatAsaasStatusLabel,
  type AsaasOrderStatusResult,
  type CreateAsaasChargeResult,
} from '../lib/asaasService';
import {
  ANCHOR_DISCOUNT_PRESETS,
  computeAnchoredOriginalPrice,
  computeResellerPrice,
  formatBRL,
} from '../lib/gradeParser';
import { calculateOrderSplit } from '../lib/splitCalculator';
import {
  AsaasChargeModal,
  toAsaasChargeModalData,
  type AsaasChargeModalData,
} from './AsaasChargeModal';
import { GradeVisualGrid } from './GradeVisualGrid';
import { SplitBreakdownCard } from './SplitBreakdownCard';
import { WalletIdSplitCard } from './WalletIdSplitCard';

interface ResellerPanelProps {
  profile: UserProfile;
  connections: FactoryConnection[];
  products: Product[];
  orders: MixedOrder[];
  payments: DualPaymentRecord[];
  onSaveStorefrontIdentity: (
    storefrontName: string,
    storefrontPrivacy: 'open' | 'approved'
  ) => Promise<void>;
  onSaveAnchorDiscount?: (discountPercent: number) => Promise<void>;
  onSaveWalletId: (walletId: string) => Promise<void>;
  onConnectFactoryByPhone: (phone: string) => Promise<{ ok: boolean; message: string }>;
  onUpdateConnection: (
    connectionId: string,
    updates: Partial<{
      reviewPhotos: boolean;
      paused: boolean;
      margins: Record<ProductCategory, CategoryMargin>;
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
    logisticsAddress: string
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
  onOpenMyStorefrontPreview: () => void;
  onOpenBilling: () => void;
}

const CATEGORIES: ProductCategory[] = [
  'Calçados',
  'Bolsas',
  'Sapatos',
  'Joias',
  'Acessórios',
];

type ResellerTab = 'connections' | 'review' | 'orders' | 'finance' | 'identity';

export const ResellerPanel: React.FC<ResellerPanelProps> = ({
  profile,
  connections,
  products,
  orders,
  payments,
  onSaveStorefrontIdentity,
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
  onOpenMyStorefrontPreview,
  onOpenBilling,
}) => {
  const [activeTab, setActiveTab] = useState<ResellerTab>('connections');
  const [feedback, setFeedback] = useState('');

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

  useEffect(() => {
    setStorefrontName(profile.storefrontName || `Vitrine ${profile.name}`);
  }, [profile.storefrontName, profile.name]);

  useEffect(() => {
    setAnchorDiscountPct(profile.anchorDiscountPercent ?? 0);
  }, [profile.anchorDiscountPercent]);

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
  const [activeModalCharge, setActiveModalCharge] =
    useState<AsaasChargeModalData | null>(null);

  // R05 Logistics drafts keyed by subOrderId
  const [logTypeMap, setLogTypeMap] = useState<Record<string, LogisticsType>>({});
  const [logCompanyMap, setLogCompanyMap] = useState<Record<string, string>>({});
  const [logAddressMap, setLogAddressMap] = useState<Record<string, string>>({});

  const myConnections = useMemo(
    () => connections.filter((c) => c.resellerId === profile.uid),
    [connections, profile.uid]
  );

  const pendingReviewItems = useMemo(() => {
    const items: Array<{ product: Product; connection: FactoryConnection }> = [];
    for (const conn of myConnections) {
      if (conn.paused || !conn.reviewPhotos) continue;
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

  const totalReceivable = receivables.reduce((acc, p) => acc + p.amount, 0);
  const totalPayable = payables.reduce((acc, p) => acc + p.amount, 0);
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
      const prod = products.find(
        (p) => p.factoryId === conn.factoryId && p.moderationStatus === 'approved'
      );
      if (prod) {
        return computeResellerPrice(prod.factoryPrice, conn.margins[prod.category]);
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
              <h1 className="text-lg font-bold text-slate-900">
                {profile.storefrontName || profile.name}
              </h1>
              <p className="text-xs text-slate-500">
                Painel Comercial · {myConnections.filter((c) => !c.paused).length} fábrica(s) ativa(s)
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
            { id: 'connections', label: `Fábricas & Margens (${myConnections.length})`, icon: Link2 },
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
              Conectar Fornecedor pelo Telefone
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Digite o número de telefone de um fabricante no ChatFi para puxar os produtos automaticamente para sua vitrine e definir sua margem de lucro.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="tel"
                required
                value={factoryPhone}
                onChange={(e) => setFactoryPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="h-11 flex-1 rounded-xl border border-slate-200 px-3.5 font-mono text-sm focus:border-[#0E7A34] focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="h-11 rounded-xl bg-[#0E7A34] px-5 text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
              >
                {busy ? 'Buscando fabricante...' : 'Conectar Fabricante'}
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
              {myConnections.map((conn) => (
                <div
                  key={conn.id}
                  className={`rounded-2xl border p-5 shadow-sm transition ${
                    conn.paused
                      ? 'border-orange-300 bg-orange-50/40'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">
                          {conn.factoryName}
                        </h3>
                        {conn.paused && (
                          <span className="rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">
                            Parceria Pausada
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Política da fábrica: {conn.deliveryPolicy.label}
                      </p>
                    </div>

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
                  </div>

                  {/* Per-category margins */}
                  <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
                    {CATEGORIES.map((cat) => {
                      const margin = conn.margins[cat] ?? { mode: 'fixed', value: 100 };
                      return (
                        <div
                          key={cat}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                        >
                          <span className="block text-[11px] font-bold text-slate-700">
                            {cat}
                          </span>
                          <div className="mt-1.5 flex items-center gap-1">
                            <select
                              value={margin.mode}
                              onChange={(e) => {
                                const updated = {
                                  ...conn.margins,
                                  [cat]: {
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
                                  [cat]: { ...margin, value: val },
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
                    const simCat = simCategoryMap[conn.id] ?? 'Calçados';
                    const sampleFactoryProduct = products.find(
                      (p) => p.factoryId === conn.factoryId && p.category === simCat
                    );
                    const defaultBase = sampleFactoryProduct?.factoryPrice ?? 55;
                    const simBaseRaw =
                      simBaseCostMap[conn.id] !== undefined
                        ? Number.parseFloat(simBaseCostMap[conn.id].replace(',', '.')) || 0
                        : defaultBase;
                    const simMargin = conn.margins[simCat] ?? { mode: 'fixed', value: 100 };
                    const simPublicPrice = computeResellerPrice(simBaseRaw, simMargin);
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
                            Simulador de Precificação na Vitrine ({simCat})
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
                              {CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
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
                                className="w-16 bg-transparent font-mono font-bold text-slate-900 focus:outline-none tabular-nums"
                              />
                            </div>
                            <span className="font-mono text-xs font-bold text-[#0E7A34] tabular-nums">
                              Vitrine: {formatBRL(simPublicPrice)}
                            </span>
                          </div>
                        </div>

                        {simPublicPrice > 0 && (
                          <SplitBreakdownCard
                            compact
                            breakdown={simBreakdown}
                            title={`Split previsto na venda de 1 cx (${simCat})`}
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
                </div>
              ))}
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
                const publicPrice = computeResellerPrice(
                  product.factoryPrice,
                  connection.margins[product.category]
                );
                return (
                  <div
                    key={`${connection.id}_${product.id}`}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-48 w-full object-cover"
                    />
                    <div className="p-4 space-y-3">
                      <div>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {connection.factoryName} · {product.category}
                        </span>
                        <h3 className="text-sm font-bold text-slate-900">
                          {product.name}
                        </h3>
                      </div>

                      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                        <div>
                          <span className="block text-[10px] text-slate-500">Custo Fábrica</span>
                          <span className="font-mono font-bold text-slate-700 tabular-nums">
                            {formatBRL(product.factoryPrice)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="block text-[10px] text-slate-500">
                            Seu Preço na Vitrine
                          </span>
                          <span className="font-mono font-bold text-[#0E7A34] tabular-nums">
                            {formatBRL(publicPrice)}
                          </span>
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
                        title="Precificação & Split (1 caixa no Pix)"
                        factoryLabel={`Vai para ${connection.factoryName}`}
                        resellerLabel="Fica retido/liberado para você"
                      />

                      <GradeVisualGrid gradeRaw={product.gradeRaw} compact />

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

              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Pedido {order.orderCode} · Cliente: {order.buyerName}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Criado em {order.createdAt} · {order.subOrders.length} subpedido(s)
                      </p>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums">
                      <p className="text-slate-500">
                        Custo Fábricas: <strong>{formatBRL(order.factoryCostTotal)}</strong>
                      </p>
                      <p className="text-sm font-bold text-[#0E7A34]">
                        Total Cliente: {formatBRL(order.buyerFinalTotal)}
                      </p>
                    </div>
                  </div>

                  {/* Punctual commission-only discount (R04) */}
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

                  {/* Split Breakdown & Asaas Payment Issuance */}
                  {(() => {
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

                  {/* Sub-orders & Post-Confirmation Logistics (R05) */}
                  <div className="space-y-3">
                    {order.subOrders.map((sub) => {
                      const unlocked =
                        sub.status === 'confirmed' ||
                        sub.status === 'partial_confirmed' ||
                        sub.status === 'logistics_sent' ||
                        sub.status === 'dispatched';
                      const lType =
                        logTypeMap[sub.id] ??
                        (sub.logisticsType !== 'none'
                          ? sub.logisticsType
                          : 'transportadora');
                      const lCompany =
                        logCompanyMap[sub.id] ?? sub.logisticsCompany ?? '';
                      const lAddress =
                        logAddressMap[sub.id] ?? sub.logisticsAddress ?? '';

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
                                          : sub.status}
                              </span>
                            </div>
                            <span className="font-mono text-xs font-bold text-slate-700 tabular-nums">
                              Custo: {formatBRL(sub.factoryCost)}
                            </span>
                          </div>

                          {!unlocked ? (
                            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                              <Lock className="h-4 w-4 shrink-0 text-slate-400" />
                              <span>
                                Logística bloqueada até o fabricante confirmar a disponibilidade do estoque.
                              </span>
                            </div>
                          ) : sub.status === 'dispatched' ? (
                            <div className="rounded-lg bg-emerald-50 p-3 text-xs text-[#0E7A34]">
                              <p className="font-semibold">
                                Despachado via {sub.logisticsType} ({sub.logisticsCompany}) ·{' '}
                                {sub.receiptNote || 'Comprovante anexado'}
                              </p>
                              {sub.receiptUrl && (
                                <img
                                  src={sub.receiptUrl}
                                  alt="Comprovante de despacho"
                                  className="mt-2 h-28 rounded-lg object-cover"
                                />
                              )}
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 gap-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 sm:grid-cols-3">
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
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!lCompany.trim() || !lAddress.trim()) return;
                                  await onSubmitLogistics(
                                    sub,
                                    lType,
                                    lCompany.trim(),
                                    lAddress.trim()
                                  );
                                  setFeedback(
                                    `Logística do subpedido ${sub.subOrderCode} enviada para ${sub.factoryName}.`
                                  );
                                }}
                                className="sm:col-span-3 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27]"
                              >
                                <Truck className="h-4 w-4" />
                                Enviar Dados de Despacho para a Fábrica
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
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
                          {(['Aguardando', 'Parcial', 'Quitado', 'Em Atraso'] as PaymentStatus[]).map(
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
    </div>
  );
};
