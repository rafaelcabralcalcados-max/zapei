import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CreditCard,
  Factory,
  HelpCircle,
  Minus,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Settings2,
  Truck,
  Upload,
  XCircle,
} from 'lucide-react';
import type {
  DualPaymentRecord,
  FavoriteGrade,
  MinimumDeliveryPolicy,
  MixedOrder,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductCategory,
  ProductUnitType,
  SplitPaymentMethod,
  SubOrder,
  UserProfile,
} from '../types/zapei';
import {
  PRODUCT_CATEGORIES,
  computeUnitPriceFromTotal,
  formatPackSummaryLabel,
  formatUnitSuffix,
  getCategoryDefinition,
  inferProductSubcategory,
  isSingleAssetCategory,
  normalizeProductCategory,
  resolveProductPackLabel,
  resolveProductQuantityPerPack,
  resolveProductUnitType,
} from '../lib/categories';
import {
  computeResellerPrice,
  formatBRL,
  getTotalPairsFromGrade,
  parseGradeString,
  runImageModerationFilter,
} from '../lib/gradeParser';
import {
  calculateOrderSplit,
  MINIMUM_FEE_THRESHOLD_BRL,
  PIX_MIN_GROSS_BRL,
} from '../lib/splitCalculator';
import { compressImageFileToDataUrl } from '../lib/phoneUtils';
import {
  canCancelUnpaidOrder,
  formatAsaasStatusLabel,
  formatReservationRemaining,
  getOrderReservationDeadlineMs,
  type AsaasOrderStatusResult,
  type CancelOrderResult,
} from '../lib/asaasService';
import { GradeVisualGrid } from './GradeVisualGrid';
import { SplitBreakdownCard } from './SplitBreakdownCard';
import { WalletIdSplitCard } from './WalletIdSplitCard';
import type { HelpCenterContext } from './HelpCenterModal';

interface ManufacturerPanelProps {
  profile: UserProfile;
  products: Product[];
  subOrders: SubOrder[];
  orders?: MixedOrder[];
  payments: DualPaymentRecord[];
  onSavePolicy: (factoryName: string, policy: MinimumDeliveryPolicy) => Promise<void>;
  onSaveWalletId: (walletId: string) => Promise<void>;
  onSyncAsaasStatus?: (order: MixedOrder) => Promise<AsaasOrderStatusResult | null>;
  onSaveFavoriteGrade: (grade: FavoriteGrade) => Promise<void>;
  onCreateProduct: (params: {
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
  }) => Promise<void>;
  onUpdateStock: (productId: string, stockBoxes: number, isSoldOutToday: boolean) => Promise<void>;
  onConfirmConference: (
    subOrder: SubOrder,
    decisions: Record<string, 'available' | 'unavailable'>
  ) => Promise<void>;
  onDispatchSubOrder: (
    subOrder: SubOrder,
    receiptNote: string,
    receiptUrl?: string
  ) => Promise<void>;
  onUpdatePayment: (
    paymentId: string,
    updates: { method?: PaymentMethod; status?: PaymentStatus }
  ) => Promise<void>;
  onCancelOrder?: (
    orderId: string,
    reason: 'factory_cancelled'
  ) => Promise<CancelOrderResult>;
  onOpenBilling: () => void;
  onOpenHelp?: (ctx: HelpCenterContext) => void;
}

type FactoryTab = 'catalog' | 'conference' | 'dispatch' | 'finance' | 'policy';

export const ManufacturerPanel: React.FC<ManufacturerPanelProps> = ({
  profile,
  products,
  subOrders,
  orders = [],
  payments,
  onSavePolicy,
  onSaveWalletId,
  onSyncAsaasStatus,
  onSaveFavoriteGrade,
  onCreateProduct,
  onUpdateStock,
  onConfirmConference,
  onDispatchSubOrder,
  onUpdatePayment,
  onCancelOrder,
  onOpenBilling,
  onOpenHelp,
}) => {
  const [activeTab, setActiveTab] = useState<FactoryTab>('catalog');
  const [feedback, setFeedback] = useState('');
  const [syncingPayId, setSyncingPayId] = useState<string | null>(null);
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState<string | null>(null);
  const [cancelLoadingId, setCancelLoadingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // F01 Policy state
  const [factoryName, setFactoryName] = useState(profile.factoryName || profile.name);
  const [policyType, setPolicyType] = useState<MinimumDeliveryPolicy['type']>(
    profile.factoryPolicy.type
  );
  const [policyValue, setPolicyValue] = useState(String(profile.factoryPolicy.value));
  const [allowPickup, setAllowPickup] = useState(profile.factoryPolicy.allowCounterPickup);

  useEffect(() => {
    setFactoryName(profile.factoryName || profile.name);
  }, [profile.factoryName, profile.name]);

  // F02 Fast Product Form state
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodCategory, setProdCategory] = useState<ProductCategory>('Calçados & Acessórios');
  const [prodSubcategory, setProdSubcategory] = useState<string>(
    PRODUCT_CATEGORIES[0].subcategories[0]
  );
  const [prodUnitType, setProdUnitType] = useState<ProductUnitType>('par');
  const [prodQtyPerPack, setProdQtyPerPack] = useState<string>('12');
  const [priceEntryMode, setPriceEntryMode] = useState<'pack' | 'unit'>('pack');
  const [prodPrice, setProdPrice] = useState('');
  const [prodStock, setProdStock] = useState('10');
  const [prodGradeRaw, setProdGradeRaw] = useState('34:1, 35:2, 36:3, 37:3, 38:2, 39:1');
  const [specValues, setSpecValues] = useState<Record<string, string>>({});
  const [prodImageUrl, setProdImageUrl] = useState('');
  const [prodImageName, setProdImageName] = useState('');
  const [moderationWarning, setModerationWarning] = useState('');
  const [favLabel, setFavLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pricingSimMethod, setPricingSimMethod] = useState<SplitPaymentMethod>('pix');
  const [pricingSimInstallments, setPricingSimInstallments] = useState(1);

  const productPhotoInputRef = useRef<HTMLInputElement | null>(null);

  const currentCatDef = useMemo(() => getCategoryDefinition(prodCategory), [prodCategory]);
  const isSingleAsset = currentCatDef.behavior === 'single_asset';
  const effectiveQtyPerPack = useMemo(() => {
    if (isSingleAsset) return 1;
    const n = Number.parseInt(prodQtyPerPack, 10);
    return Number.isFinite(n) && n >= 1 ? Math.min(10000, n) : 1;
  }, [isSingleAsset, prodQtyPerPack]);

  const handleCategoryChange = (nextCategory: ProductCategory) => {
    const def = getCategoryDefinition(nextCategory);
    setProdCategory(nextCategory);
    setProdSubcategory(def.subcategories[0] ?? '');
    setProdUnitType(def.defaultUnitType);
    setProdQtyPerPack(String(def.defaultQuantityPerPack));
    setProdGradeRaw(def.defaultGradeRaw);
    setSpecValues({});
    if (def.behavior === 'single_asset') {
      setPriceEntryMode('pack');
      setProdStock('1');
    } else if (def.defaultQuantityPerPack === 1) {
      setPriceEntryMode('pack');
    }
  };

  const applyPackPreset = (qty: number, customGrade?: string, customUnit?: ProductUnitType) => {
    const safeQty = Math.max(1, Math.round(qty));
    setProdQtyPerPack(String(safeQty));
    if (customUnit) setProdUnitType(customUnit);
    if (customGrade) {
      setProdGradeRaw(customGrade);
      return;
    }
    if (safeQty === 1) {
      setProdGradeRaw('Único:1');
      if (prodUnitType === 'kit') setProdUnitType('unidade');
    } else if (currentCatDef.behavior === 'footwear_box') {
      if (safeQty === 6) setProdGradeRaw('34:1, 35:1, 36:1, 37:1, 38:1, 39:1');
      else if (safeQty === 12) setProdGradeRaw('34:1, 35:2, 36:3, 37:3, 38:2, 39:1');
      else if (safeQty === 15) setProdGradeRaw('34:2, 35:2, 36:4, 37:4, 38:2, 39:1');
      else setProdGradeRaw(`Único:${safeQty}`);
    } else if (currentCatDef.behavior === 'apparel_flexible') {
      if (safeQty === 6) setProdGradeRaw('P:1, M:2, G:2, GG:1');
      else if (safeQty === 12) setProdGradeRaw('P:2, M:4, G:4, GG:2');
      else setProdGradeRaw(`Único:${safeQty}`);
    } else {
      setProdGradeRaw(`Único:${safeQty}`);
    }
  };

  // F04 Conference item availability drafts keyed by subOrderId -> itemId
  const [confDecisions, setConfDecisions] = useState<
    Record<string, Record<string, 'available' | 'unavailable'>>
  >({});

  // F05 Dispatch receipt drafts keyed by subOrderId
  const [receiptNotes, setReceiptNotes] = useState<Record<string, string>>({});
  const [receiptImages, setReceiptImages] = useState<Record<string, string>>({});

  const myProducts = useMemo(
    () => products.filter((p) => p.factoryId === profile.uid),
    [products, profile.uid]
  );

  const mySubOrders = useMemo(
    () => subOrders.filter((s) => s.factoryId === profile.uid),
    [subOrders, profile.uid]
  );

  const pendingConference = useMemo(
    () =>
      mySubOrders.filter((s) => {
        const parent = orders.find((o) => o.id === s.parentOrderId);
        if (parent?.status === 'cancelled') return false;
        return s.status === 'pending_inquiry' || s.status === 'checking_stock';
      }),
    [mySubOrders, orders]
  );

  const dispatchQueue = useMemo(
    () =>
      mySubOrders.filter((s) => {
        const parent = orders.find((o) => o.id === s.parentOrderId);
        if (parent?.status === 'cancelled') return false;
        return (
          s.status === 'confirmed' ||
          s.status === 'partial_confirmed' ||
          s.status === 'logistics_sent' ||
          s.status === 'dispatched'
        );
      }),
    [mySubOrders, orders]
  );

  const myPayments = useMemo(
    () =>
      payments.filter(
        (p) => p.ownerId === profile.uid && p.layer === 'factory_reseller'
      ),
    [payments, profile.uid]
  );

  const totalToReceive = myPayments
    .filter((p) => p.status !== 'Quitado' && p.status !== 'Cancelado')
    .reduce((acc, p) => acc + p.amount, 0);
  const totalReceived = myPayments
    .filter((p) => p.status === 'Quitado')
    .reduce((acc, p) => acc + p.amount, 0);

  const isPaused = profile.subscriptionStatus === 'expired';

  const parsedInputPrice = useMemo(() => {
    const val = Number.parseFloat(prodPrice.replace(',', '.'));
    return Number.isFinite(val) && val > 0 ? val : 0;
  }, [prodPrice]);

  // Total factory price of the box/pack (or single unit)
  const parsedDraftTotalFactoryPrice = useMemo(() => {
    if (parsedInputPrice <= 0) return 0;
    if (isSingleAsset || effectiveQtyPerPack <= 1 || priceEntryMode === 'pack') {
      return Number(parsedInputPrice.toFixed(2));
    }
    return Number((parsedInputPrice * effectiveQtyPerPack).toFixed(2));
  }, [parsedInputPrice, isSingleAsset, effectiveQtyPerPack, priceEntryMode]);

  const draftFactoryUnitPrice = useMemo(
    () => computeUnitPriceFromTotal(parsedDraftTotalFactoryPrice, effectiveQtyPerPack),
    [parsedDraftTotalFactoryPrice, effectiveQtyPerPack]
  );

  // Estimated storefront price with default reseller margin + unit price preview
  const estimatedPublicPackPrice = useMemo(() => {
    if (parsedDraftTotalFactoryPrice <= 0) return 0;
    return computeResellerPrice(parsedDraftTotalFactoryPrice, currentCatDef.defaultMargin);
  }, [parsedDraftTotalFactoryPrice, currentCatDef]);

  const estimatedPublicUnitPrice = useMemo(
    () => computeUnitPriceFromTotal(estimatedPublicPackPrice, effectiveQtyPerPack),
    [estimatedPublicPackPrice, effectiveQtyPerPack]
  );

  const draftSplitPreview = useMemo(
    () =>
      calculateOrderSplit({
        orderTotal: parsedDraftTotalFactoryPrice,
        factoryCostTotal: parsedDraftTotalFactoryPrice,
        paymentMethod: pricingSimMethod,
        installments: pricingSimInstallments,
        isDirectManufacturerSale: true,
      }),
    [parsedDraftTotalFactoryPrice, pricingSimMethod, pricingSimInstallments]
  );

  const handleProductPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setModerationWarning('');
    const modCheck = runImageModerationFilter(file.name);
    if (!modCheck.approved) {
      setModerationWarning(modCheck.reason || 'Imagem bloqueada pelo filtro de moderação.');
      setProdImageUrl('');
      setProdImageName('');
      return;
    }
    try {
      const compressed = await compressImageFileToDataUrl(file, 840, 0.74);
      if (compressed.length > 340000) {
        const smaller = await compressImageFileToDataUrl(file, 640, 0.62);
        setProdImageUrl(smaller);
      } else {
        setProdImageUrl(compressed);
      }
      setProdImageName(file.name);
    } catch {
      setModerationWarning('Falha ao processar a imagem escolhida.');
    }
  };

  const handleAddFavoriteGrade = async () => {
    if (!prodGradeRaw.trim() || parseGradeString(prodGradeRaw).length === 0) return;
    const totalPairs = getTotalPairsFromGrade(prodGradeRaw);
    const label =
      favLabel.trim() || `${currentCatDef.shortLabel} (${totalPairs} un)`;
    await onSaveFavoriteGrade({
      id: `fav_${Date.now()}`,
      label,
      raw: prodGradeRaw.trim(),
    });
    setFavLabel('');
    setFeedback(`Grade favorita "${label}" salva na sua conta.`);
  };

  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setModerationWarning('');
    setFeedback('');

    const titleMod = runImageModerationFilter(`${prodName} ${prodImageName}`);
    if (!titleMod.approved) {
      setModerationWarning(titleMod.reason || 'Conteúdo retido pela moderação.');
      return;
    }
    if (!prodImageUrl) {
      setModerationWarning('Envie uma foto real do produto antes de cadastrar.');
      return;
    }

    const finalUnitType: ProductUnitType = isSingleAsset ? 'unidade' : prodUnitType;
    const finalQtyPerPack = isSingleAsset ? 1 : effectiveQtyPerPack;
    const finalGradeRaw = isSingleAsset
      ? 'Único:1'
      : prodGradeRaw.trim() || `Único:${finalQtyPerPack}`;
    const parsedGrade = parseGradeString(finalGradeRaw);
    if (!isSingleAsset && parsedGrade.length === 0) {
      setModerationWarning('Digite a grade válida separada por vírgulas (ex: 34:1, 35:2, 36:3).');
      return;
    }

    const priceNum = parsedDraftTotalFactoryPrice;
    const stockNum = Number.parseInt(prodStock, 10);
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      setModerationWarning('Informe um preço válido maior que zero.');
      return;
    }

    const specsSummary = currentCatDef.specFields
      ? currentCatDef.specFields
          .map((f) => {
            const v = (specValues[f.key] || '').trim();
            return v ? `${f.label}: ${v}` : '';
          })
          .filter(Boolean)
          .join(' · ')
      : '';

    const packLabel =
      finalQtyPerPack <= 1
        ? 'Unidade'
        : finalUnitType === 'par'
          ? finalQtyPerPack >= 10
            ? 'Caixa'
            : 'Grade'
          : finalUnitType === 'kit'
            ? 'Kit'
            : 'Grade';

    setSubmitting(true);
    try {
      await onCreateProduct({
        name: prodName.trim(),
        sku: prodSku.trim() || `REF-${Date.now().toString().slice(-4)}`,
        category: prodCategory,
        subcategory: prodSubcategory || undefined,
        unitType: finalUnitType,
        quantityPerPack: finalQtyPerPack,
        packLabel,
        specsSummary: specsSummary || undefined,
        factoryPrice: priceNum,
        stockBoxes: Math.max(0, Number.isNaN(stockNum) ? 0 : stockNum),
        gradeRaw: finalGradeRaw,
        imageUrl: prodImageUrl,
      });
      setProdName('');
      setProdSku('');
      setProdPrice('');
      setSpecValues({});
      setProdStock(isSingleAsset ? '1' : '10');
      setProdImageUrl('');
      setProdImageName('');
      setFeedback('Produto cadastrado com sucesso no catálogo real!');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePolicySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = Math.max(1, Number.parseFloat(policyValue.replace(',', '.')) || 1);
    const baseLabel =
      policyType === 'boxes'
        ? `Mínimo ${numeric} ${numeric === 1 ? 'caixa' : 'caixas'}`
        : policyType === 'pieces'
          ? `Mínimo ${numeric} ${numeric === 1 ? 'peça' : 'peças'}`
          : `Mínimo ${formatBRL(numeric)}`;
    const label = allowPickup ? `${baseLabel} · Retirada no balcão` : baseLabel;

    setSubmitting(true);
    try {
      await onSavePolicy(factoryName.trim() || profile.name, {
        type: policyType,
        value: numeric,
        allowCounterPickup: allowPickup,
        label,
      });
      setFeedback('Política de entrega e nome da fábrica atualizados.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiptPhotoUpload = async (
    subOrderId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const compressed = await compressImageFileToDataUrl(file, 800, 0.7);
      setReceiptImages((prev) => ({ ...prev, [subOrderId]: compressed }));
    } catch {
      setFeedback('Não foi possível ler a foto do comprovante.');
    }
  };

  const namePlaceholder =
    currentCatDef.id === 'Automóveis & Veículos'
      ? 'Ex: Honda Civic Touring 1.5 Turbo'
      : currentCatDef.id === 'Imóveis & Casas'
        ? 'Ex: Casa 3 Quartos com Quintal'
        : currentCatDef.id === 'Eletrônicos & Celulares'
          ? 'Ex: Smartphone 256GB Lacrado'
          : currentCatDef.id === 'Moda Íntima & Lingerie'
            ? 'Ex: Conjunto Renda Premium'
            : 'Ex: Sandália Couro Tratorada';

  const unitSuffix = formatUnitSuffix(isSingleAsset ? 'unidade' : prodUnitType);

  return (
    <div className="mx-auto w-full max-w-6xl overflow-x-hidden px-3.5 sm:px-4 py-4 sm:py-5 pb-safe-nav md:pb-8 space-y-5">
      {/* Top Commercial Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0D2B3E] text-white">
              <Factory className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                {profile.factoryName || profile.name}
              </h1>
              <p className="text-xs text-slate-500">
                Painel do Fabricante · {profile.factoryPolicy.label}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenBilling}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
              profile.subscriptionStatus === 'active'
                ? 'border-emerald-200 bg-emerald-50 text-[#0E7A34]'
                : profile.subscriptionStatus === 'trial'
                  ? 'border-slate-200 bg-slate-50 text-[#0D2B3E]'
                  : 'border-orange-300 bg-orange-50 text-orange-800'
            }`}
          >
            <CreditCard className="h-4 w-4" />
            <span>
              {profile.subscriptionStatus === 'active'
                ? 'Plano Comercial Ativo — R$ 59,90/mês'
                : profile.subscriptionStatus === 'trial'
                  ? `Período de Teste: ${profile.trialDaysLeft} dias restantes`
                  : 'Vitrine Pausada — Renovar R$ 59,90/mês'}
            </span>
          </button>
        </div>

        {isPaused && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
            <span>
              Sua vitrine comercial está pausada até a renovação. Suas conversas, ligações e histórico financeiro continuam normais.
            </span>
            <button
              type="button"
              onClick={onOpenBilling}
              className="shrink-0 rounded-lg bg-[#F97316] px-3 py-1.5 font-semibold text-white hover:bg-orange-600"
            >
              Renovar
            </button>
          </div>
        )}

        {/* Sub-navigation */}
        <div className="mt-4 flex gap-1.5 overflow-x-auto border-t border-slate-100 pt-3">
          {[
            { id: 'catalog', label: `Catálogo & Estoque (${myProducts.length})`, icon: Package },
            {
              id: 'conference',
              label: `Conferência (${pendingConference.length})`,
              icon: ClipboardCheck,
            },
            { id: 'dispatch', label: `Despacho (${dispatchQueue.length})`, icon: Truck },
            { id: 'finance', label: `Financeiro (${myPayments.length})`, icon: Receipt },
            { id: 'policy', label: 'Mínimo de Entrega', icon: Settings2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as FactoryTab)}
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
            roleHint="Receba automaticamente sua cota de produção via Split Asaas."
          />
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-[#0E7A34]">
          {feedback}
        </div>
      )}

      {/* TAB 1: CATALOG + FAST PRODUCT CREATION (F02 & F03) */}
      {activeTab === 'catalog' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Create Product Form */}
          <form
            onSubmit={handleSubmitProduct}
            className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
          >
            <h2 className="text-sm font-bold text-slate-900">
              Cadastrar Novo Produto
            </h2>

            <input
              ref={productPhotoInputRef}
              type="file"
              accept="image/*"
              onChange={handleProductPhotoUpload}
              className="hidden"
            />

            {/* Real Photo Upload */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Foto real do produto
              </label>
              <button
                type="button"
                onClick={() => productPhotoInputRef.current?.click()}
                className="mt-1.5 flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center transition hover:border-[#0E7A34] hover:bg-emerald-50/40"
              >
                {prodImageUrl ? (
                  <div className="w-full space-y-2">
                    <img
                      src={prodImageUrl}
                      alt="Prévia do produto"
                      className="mx-auto h-40 w-full rounded-lg object-cover"
                    />
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0E7A34]">
                      <Camera className="h-3.5 w-3.5" />
                      Trocar foto ({prodImageName})
                    </span>
                  </div>
                ) : (
                  <>
                    <Upload className="h-7 w-7 text-slate-400" />
                    <span className="mt-2 text-xs font-semibold text-slate-700">
                      Selecionar foto da câmera ou galeria
                    </span>
                    <span className="mt-0.5 text-[11px] text-slate-500">
                      Comprimida automaticamente com filtro de moderação
                    </span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Nome do produto / modelo
                </label>
                <input
                  type="text"
                  required
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder={namePlaceholder}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#0E7A34] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Categoria Principal
                </label>
                <select
                  value={prodCategory}
                  onChange={(e) => handleCategoryChange(e.target.value as ProductCategory)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-[#0E7A34] focus:outline-none"
                >
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Subcategoria
                </label>
                <select
                  value={prodSubcategory}
                  onChange={(e) => setProdSubcategory(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-[#0E7A34] focus:outline-none"
                >
                  {currentCatDef.subcategories.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>

              {/* Domain-specific quick fields for Vehicles and Real Estate */}
              {currentCatDef.specFields && (
                <div className="sm:col-span-2 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
                  {currentCatDef.specFields.map((field) => (
                    <div key={field.key}>
                      <label className="block text-[11px] font-semibold text-slate-600">
                        {field.label}
                      </label>
                      <input
                        type="text"
                        value={specValues[field.key] ?? ''}
                        onChange={(e) =>
                          setSpecValues((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        placeholder={field.placeholder}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs focus:border-[#0E7A34] focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Flexible Pack Quantity & Unit Type (hidden cleanly for single-asset categories like Vehicles/Real Estate) */}
              {!isSingleAsset && (
                <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-bold text-slate-800">
                      Quantidade por Grade / Caixa
                    </label>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                      {(
                        [
                          { id: 'par', label: 'Par' },
                          { id: 'unidade', label: 'Unidade' },
                          { id: 'kit', label: 'Kit' },
                        ] as const
                      ).map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setProdUnitType(u.id)}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                            prodUnitType === u.id
                              ? 'bg-[#0D2B3E] text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quick presets adapted to category */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {currentCatDef.behavior === 'apparel_flexible' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => applyPackPreset(1, 'Único:1', 'unidade')}
                          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                            effectiveQtyPerPack === 1
                              ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          1 peça avulsa
                        </button>
                        <button
                          type="button"
                          onClick={() => applyPackPreset(6, 'Único:6', 'kit')}
                          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                            effectiveQtyPerPack === 6 && prodUnitType === 'kit'
                              ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          Kit 6 unid.
                        </button>
                        <button
                          type="button"
                          onClick={() => applyPackPreset(6, 'P:1, M:2, G:2, GG:1', 'unidade')}
                          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                            effectiveQtyPerPack === 6 && prodUnitType !== 'kit'
                              ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          Grade P–GG (6)
                        </button>
                        <button
                          type="button"
                          onClick={() => applyPackPreset(12, 'P:2, M:4, G:4, GG:2', 'unidade')}
                          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                            effectiveQtyPerPack === 12
                              ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          Grade 12 peças
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => applyPackPreset(1, 'Único:1', 'unidade')}
                          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                            effectiveQtyPerPack === 1
                              ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          1 unidade avulsa
                        </button>
                        {[6, 12, 15].map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() =>
                              applyPackPreset(
                                q,
                                undefined,
                                currentCatDef.behavior === 'footwear_box' ? 'par' : prodUnitType
                              )
                            }
                            className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                              effectiveQtyPerPack === q
                                ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {q} {prodUnitType === 'par' ? 'pares' : 'unid.'}
                          </button>
                        ))}
                      </>
                    )}

                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-[11px] text-slate-500">Outro:</span>
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        value={prodQtyPerPack}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setProdQtyPerPack(raw);
                          const parsed = Number.parseInt(raw, 10);
                          if (Number.isFinite(parsed) && parsed >= 1) {
                            if (parsed === 1 || prodGradeRaw.startsWith('Único:')) {
                              setProdGradeRaw(`Único:${parsed}`);
                            }
                          }
                        }}
                        aria-label="Quantidade personalizada por grade ou caixa"
                        className="h-8 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center font-mono text-xs font-bold tabular-nums focus:border-[#0E7A34] focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Referência / SKU
                </label>
                <input
                  type="text"
                  value={prodSku}
                  onChange={(e) => setProdSku(e.target.value)}
                  placeholder="Ex: REF-402"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm focus:border-[#0E7A34] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  {isSingleAsset || effectiveQtyPerPack === 1
                    ? 'Estoque disponível (unidades)'
                    : 'Estoque inicial (caixas/grades)'}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={prodStock}
                  onChange={(e) => setProdStock(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm focus:border-[#0E7A34] focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    {isSingleAsset || effectiveQtyPerPack === 1
                      ? 'Preço de venda (R$)'
                      : priceEntryMode === 'pack'
                        ? `Preço de fábrica da embalagem (${effectiveQtyPerPack} ${
                            prodUnitType === 'par' ? 'pares' : 'unid.'
                          })`
                        : `Preço unitário de fábrica (por ${unitSuffix})`}
                  </label>
                  {!isSingleAsset && effectiveQtyPerPack > 1 && (
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                      <button
                        type="button"
                        onClick={() => setPriceEntryMode('pack')}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                          priceEntryMode === 'pack'
                            ? 'bg-[#0E7A34] text-white'
                            : 'text-slate-600'
                        }`}
                      >
                        Por caixa/grade
                      </button>
                      <button
                        type="button"
                        onClick={() => setPriceEntryMode('unit')}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                          priceEntryMode === 'unit'
                            ? 'bg-[#0E7A34] text-white'
                            : 'text-slate-600'
                        }`}
                      >
                        Por {unitSuffix}
                      </button>
                    </div>
                  )}
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={prodPrice}
                  onChange={(e) => setProdPrice(e.target.value)}
                  placeholder={
                    isSingleAsset
                      ? '45000.00'
                      : effectiveQtyPerPack === 1
                        ? '89.90'
                        : priceEntryMode === 'pack'
                          ? '480.00'
                          : '40.00'
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm focus:border-[#0E7A34] focus:outline-none"
                />

                {/* Live Automatic Unit/Pair & Estimated Vitrine Calculation */}
                {parsedDraftTotalFactoryPrice > 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 space-y-1">
                    {effectiveQtyPerPack > 1 ? (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700">
                            Valor de fábrica por {unitSuffix} ({effectiveQtyPerPack}x):
                          </span>
                          <span className="font-mono font-bold text-[#0D2B3E] tabular-nums">
                            {formatBRL(draftFactoryUnitPrice)} / {unitSuffix}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-600">Total da caixa/grade na fábrica:</span>
                          <span className="font-mono font-semibold text-slate-800 tabular-nums">
                            {formatBRL(parsedDraftTotalFactoryPrice)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">Valor unitário na fábrica:</span>
                        <span className="font-mono font-bold text-[#0D2B3E] tabular-nums">
                          {formatBRL(parsedDraftTotalFactoryPrice)} / unid.
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-emerald-200/70 pt-1.5 text-xs">
                      <span className="font-semibold text-[#0E7A34]">
                        Estimativa na Vitrine (c/ margem padrão):
                      </span>
                      <span className="font-mono font-bold text-[#0E7A34] tabular-nums">
                        {formatBRL(estimatedPublicUnitPrice)} / {unitSuffix}
                        {effectiveQtyPerPack > 1 && (
                          <span className="font-normal text-slate-600">
                            {' '}
                            ({formatBRL(estimatedPublicPackPrice)} total)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {parsedDraftTotalFactoryPrice > 0 && (
              <SplitBreakdownCard
                breakdown={draftSplitPreview}
                title={`Simulação de Precificação & Split (1 ${
                  effectiveQtyPerPack > 1 ? 'embalagem' : 'unidade'
                } venda direta)`}
                factoryLabel="Quanto cai líquido para sua Fábrica"
                hideResellerIfDirect
                showMethodToggle
                onChangeMethod={setPricingSimMethod}
                onChangeInstallments={setPricingSimInstallments}
              />
            )}

            {/* Comma-Separated Grade Input + Favorites + Visual Preview (only for multi-unit / non-single-asset) */}
            {!isSingleAsset && effectiveQtyPerPack > 1 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Grade por vírgulas (tamanho:quantidade)
                </label>
                <input
                  type="text"
                  required
                  value={prodGradeRaw}
                  onChange={(e) => setProdGradeRaw(e.target.value)}
                  placeholder="34:1, 35:2, 36:3, 37:3, 38:2, 39:1"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-xs focus:border-[#0E7A34] focus:outline-none"
                />

                {/* Favorite grades chips */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.favoriteGrades.map((fav) => (
                    <button
                      key={fav.id}
                      type="button"
                      onClick={() => {
                        setProdGradeRaw(fav.raw);
                        const sum = getTotalPairsFromGrade(fav.raw);
                        if (sum >= 1) setProdQtyPerPack(String(sum));
                      }}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                    >
                      {fav.label}
                    </button>
                  ))}
                </div>

                {/* Save new favorite grade */}
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={favLabel}
                    onChange={(e) => setFavLabel(e.target.value)}
                    placeholder="Nome para salvar esta grade favorita..."
                    className="h-9 flex-1 rounded-lg border border-slate-200 px-2.5 text-xs focus:border-[#0E7A34] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddFavoriteGrade()}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    Salvar grade
                  </button>
                </div>

                {/* Live Visual Preview of how buyers will see the grade */}
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-500">
                    Prévia visual da grade para compradores (sem vírgulas):
                  </p>
                  <GradeVisualGrid
                    gradeRaw={prodGradeRaw}
                    unitLabel={prodUnitType === 'par' ? 'pares' : 'un'}
                  />
                </div>
              </div>
            )}

            {moderationWarning && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{moderationWarning}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-xl bg-[#0E7A34] text-sm font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
            >
              {submitting ? 'Publicando...' : 'Cadastrar Produto no Catálogo'}
            </button>
          </form>

          {/* Fast Stock Management List (F03) */}
          <div className="lg:col-span-7 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">
              Estoque dos Produtos
            </h2>

            {myProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <Package className="mx-auto h-9 w-9 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-800">
                  Nenhum produto cadastrado ainda
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Cadastre seu primeiro produto ao lado com foto real. Ele ficará disponível imediatamente na sua vitrine e para lojistas conectados.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {myProducts.map((product) => {
                  const qty = resolveProductQuantityPerPack(product);
                  const unitType = resolveProductUnitType(product);
                  const unitSuffix = formatUnitSuffix(unitType);
                  const unitFactory = computeUnitPriceFromTotal(product.factoryPrice, qty);
                  const packLabel = resolveProductPackLabel(product);
                  const packSummary = formatPackSummaryLabel({
                    quantityPerPack: qty,
                    unitType,
                    packLabel,
                  });
                  const mainCat = normalizeProductCategory(product.category);
                  const subCat = inferProductSubcategory(product.category, product.subcategory);
                  const singleAsset = isSingleAssetCategory(product.category);

                  return (
                    <div
                      key={product.id}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row"
                    >
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="h-28 w-full shrink-0 rounded-xl object-cover sm:h-28 sm:w-28"
                      />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              {mainCat}
                              {subCat ? ` · ${subCat}` : ''} · {product.sku}
                            </span>
                            <h3 className="text-sm font-bold text-slate-900">
                              {product.name}
                            </h3>
                            {product.specsSummary && (
                              <p className="text-xs text-slate-500">{product.specsSummary}</p>
                            )}
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <span className="block text-sm font-bold text-[#0E7A34]">
                              {formatBRL(unitFactory)} / {unitSuffix}
                            </span>
                            {qty > 1 && (
                              <span className="block text-[11px] text-slate-500">
                                {packSummary}: {formatBRL(product.factoryPrice)}
                              </span>
                            )}
                          </div>
                        </div>

                        {!singleAsset && qty > 1 && (
                          <GradeVisualGrid
                            gradeRaw={product.gradeRaw}
                            compact
                            unitLabel={unitType === 'par' ? 'pares' : 'un'}
                          />
                        )}

                        {(() => {
                          const pixPreview = calculateOrderSplit({
                            orderTotal: product.factoryPrice,
                            factoryCostTotal: product.factoryPrice,
                            paymentMethod: 'pix',
                            isDirectManufacturerSale: true,
                          });
                          return (
                            <div
                              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-mono tabular-nums ${
                                pixPreview.belowPixMinThreshold
                                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                                  : 'border-slate-200 bg-slate-50 text-slate-600'
                              }`}
                            >
                              {pixPreview.belowPixMinThreshold ? (
                                <>
                                  <strong>Abaixo de {formatBRL(MINIMUM_FEE_THRESHOLD_BRL)}:</strong> venda
                                  no Pix aplica tarifa mínima de {formatBRL(PIX_MIN_GROSS_BRL)} · Líquido
                                  fábrica: <strong>{formatBRL(pixPreview.factoryNetTotal)}</strong>
                                </>
                              ) : (
                                <>
                                  Repasse líquido fábrica (venda direta Pix):{' '}
                                  <strong>{formatBRL(pixPreview.factoryNetTotal)}</strong> (taxa
                                  plataforma {formatBRL(pixPreview.platformGrossFee)})
                                </>
                              )}
                            </div>
                          );
                        })()}

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-600">
                              Estoque:
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                void onUpdateStock(
                                  product.id,
                                  Math.max(0, product.stockBoxes - 1),
                                  product.stockBoxes - 1 <= 0 ? true : product.isSoldOutToday
                                )
                              }
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="min-w-[60px] text-center font-mono text-sm font-bold text-slate-900 tabular-nums">
                              {product.stockBoxes} {qty === 1 ? 'un' : 'cx'}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                void onUpdateStock(
                                  product.id,
                                  product.stockBoxes + 1,
                                  false
                                )
                              }
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              void onUpdateStock(
                                product.id,
                                product.stockBoxes,
                                !product.isSoldOutToday
                              )
                            }
                            className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                              product.isSoldOutToday
                                ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {product.isSoldOutToday ? 'Reativar Hoje' : 'Esgotado Hoje'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PARTIAL STOCK CUT CONFERENCE (F04) */}
      {activeTab === 'conference' && (
        <div className="space-y-4">
          {pendingConference.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <ClipboardCheck className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">
                Nenhum pedido aguardando conferência de estoque
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Quando um comprador ou revendedor enviar um pedido dos seus produtos, ele aparecerá aqui para confirmação ou corte parcial.
              </p>
            </div>
          ) : (
            pendingConference.map((sub) => {
              const decisions = confDecisions[sub.id] ?? {};
              const linkedOrder = orders.find((o) => o.id === sub.parentOrderId);
              const orderPayments = payments.filter(
                (p) => p.orderId === sub.parentOrderId
              );
              const canCancel =
                Boolean(onCancelOrder) &&
                (linkedOrder
                  ? canCancelUnpaidOrder(linkedOrder, orderPayments)
                  : !orderPayments.some((p) => p.status === 'Quitado'));
              const reservationDeadlineMs = linkedOrder
                ? getOrderReservationDeadlineMs(linkedOrder)
                : null;
              const reservationStatus = formatReservationRemaining(
                reservationDeadlineMs,
                nowMs
              );

              return (
                <div
                  key={sub.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Subpedido {sub.subOrderCode}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Recebido em {sub.updatedAt} · Marque cada item como Disponível ou Esgotado
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <span className="block text-sm font-bold text-[#0E7A34]">
                        Custo Fábrica: {formatBRL(sub.factoryCost)}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        Líquido estimado no Split (Pix):{' '}
                        {formatBRL(
                          calculateOrderSplit({
                            orderTotal: sub.buyerSubtotal > 0 ? sub.buyerSubtotal : sub.factoryCost,
                            factoryCostTotal: sub.factoryCost,
                            paymentMethod: 'pix',
                            isDirectManufacturerSale:
                              Math.abs((sub.buyerSubtotal || sub.factoryCost) - sub.factoryCost) < 0.01,
                          }).factoryNetTotal
                        )}
                      </span>
                    </div>
                  </div>

                  {canCancel && (
                    <div className="flex flex-col gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
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

                      {confirmCancelOrderId === sub.parentOrderId ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={cancelLoadingId === sub.parentOrderId}
                            onClick={async () => {
                              if (!onCancelOrder) return;
                              setCancelLoadingId(sub.parentOrderId);
                              try {
                                await onCancelOrder(sub.parentOrderId, 'factory_cancelled');
                                setConfirmCancelOrderId(null);
                                setFeedback(
                                  `Pedido ${sub.subOrderCode} cancelado e itens devolvidos ao estoque.`
                                );
                              } catch (err) {
                                setFeedback(
                                  err instanceof Error
                                    ? err.message
                                    : 'Não foi possível cancelar o pedido.'
                                );
                              } finally {
                                setCancelLoadingId(null);
                              }
                            }}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {cancelLoadingId === sub.parentOrderId
                              ? 'Cancelando...'
                              : 'Sim, Cancelar e Liberar Estoque'}
                          </button>
                          <button
                            type="button"
                            disabled={cancelLoadingId === sub.parentOrderId}
                            onClick={() => setConfirmCancelOrderId(null)}
                            className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Voltar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmCancelOrderId(sub.parentOrderId)}
                          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white transition hover:bg-red-700"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Cancelar Pedido e Liberar Estoque
                        </button>
                      )}
                    </div>
                  )}

                  <div className="space-y-2.5">
                    {sub.items.map((item) => {
                      const current = decisions[item.id] ?? 'available';
                      return (
                        <div
                          key={item.id}
                          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <img
                              src={item.imageUrl}
                              alt={item.productName}
                              className="h-14 w-14 rounded-lg object-cover"
                            />
                            <div>
                              <p className="text-sm font-bold text-slate-900">
                                {item.productName}
                              </p>
                              <p className="font-mono text-xs text-slate-600 tabular-nums">
                                {item.boxesRequested} × {formatBRL(item.unitFactoryPrice)} ={' '}
                                <strong>
                                  {formatBRL(item.boxesRequested * item.unitFactoryPrice)}
                                </strong>
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setConfDecisions((prev) => ({
                                  ...prev,
                                  [sub.id]: { ...decisions, [item.id]: 'available' },
                                }))
                              }
                              className={`flex min-h-[38px] items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                current === 'available'
                                  ? 'bg-[#0E7A34] text-white'
                                  : 'border border-slate-200 bg-white text-slate-600'
                              }`}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Disponível
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfDecisions((prev) => ({
                                  ...prev,
                                  [sub.id]: { ...decisions, [item.id]: 'unavailable' },
                                }))
                              }
                              className={`flex min-h-[38px] items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                current === 'unavailable'
                                  ? 'bg-red-600 text-white'
                                  : 'border border-slate-200 bg-white text-slate-600'
                              }`}
                            >
                              <XCircle className="h-4 w-4" />
                              Esgotado
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      const finalDecisions: Record<string, 'available' | 'unavailable'> = {};
                      sub.items.forEach((it) => {
                        finalDecisions[it.id] = decisions[it.id] ?? 'available';
                      });
                      await onConfirmConference(sub, finalDecisions);
                      setFeedback(
                        `Conferência do subpedido ${sub.subOrderCode} confirmada com baixa automática de estoque.`
                      );
                    }}
                    className="h-11 w-full rounded-xl bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27]"
                  >
                    {linkedOrder?.stockReserved
                      ? 'Confirmar Conferência e Disponibilidade'
                      : 'Confirmar Conferência e Baixar Estoque'}
                  </button>

                  {onOpenHelp && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          onOpenHelp({
                            defaultTab: 'ticket',
                            orderId: sub.parentOrderId,
                            orderCode: sub.subOrderCode,
                            reason: 'Dúvida sobre Pedido',
                          })
                        }
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-[#0D2B3E]"
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

      {/* TAB 3: DISPATCH & RECEIPT UPLOAD (F05) */}
      {activeTab === 'dispatch' && (
        <div className="space-y-4">
          {dispatchQueue.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <Truck className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">
                Nenhum pedido pronto para despacho
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Após confirmar a disponibilidade e receber os dados de transportadora/distribuidora, você anexa o canhoto real e marca o despacho aqui.
              </p>
            </div>
          ) : (
            dispatchQueue.map((sub) => {
              const linkedOrder = orders.find((o) => o.id === sub.parentOrderId);
              const orderPayments = payments.filter(
                (p) => p.orderId === sub.parentOrderId
              );
              const canCancel =
                Boolean(onCancelOrder) &&
                sub.status !== 'dispatched' &&
                (linkedOrder
                  ? canCancelUnpaidOrder(linkedOrder, orderPayments)
                  : !orderPayments.some((p) => p.status === 'Quitado'));
              const reservationDeadlineMs = linkedOrder
                ? getOrderReservationDeadlineMs(linkedOrder)
                : null;
              const reservationStatus = formatReservationRemaining(
                reservationDeadlineMs,
                nowMs
              );

              return (
              <div
                key={sub.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Subpedido {sub.subOrderCode}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {sub.status === 'dispatched'
                        ? 'Despachado com comprovante'
                        : sub.status === 'logistics_sent'
                          ? `Logística recebida: ${sub.logisticsType.toUpperCase()} — ${sub.logisticsCompany}`
                          : 'Aguardando revendedor informar transportadora/distribuidora'}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-bold text-[#0E7A34] tabular-nums">
                    {formatBRL(sub.factoryCost)}
                  </span>
                </div>

                {canCancel && (
                  <div className="flex flex-col gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
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

                    {confirmCancelOrderId === sub.parentOrderId ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={cancelLoadingId === sub.parentOrderId}
                          onClick={async () => {
                            if (!onCancelOrder) return;
                            setCancelLoadingId(sub.parentOrderId);
                            try {
                              await onCancelOrder(sub.parentOrderId, 'factory_cancelled');
                              setConfirmCancelOrderId(null);
                              setFeedback(
                                `Pedido ${sub.subOrderCode} cancelado e itens devolvidos ao estoque.`
                              );
                            } catch (err) {
                              setFeedback(
                                err instanceof Error
                                  ? err.message
                                  : 'Não foi possível cancelar o pedido.'
                              );
                            } finally {
                              setCancelLoadingId(null);
                            }
                          }}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {cancelLoadingId === sub.parentOrderId
                            ? 'Cancelando...'
                            : 'Sim, Cancelar e Liberar Estoque'}
                        </button>
                        <button
                          type="button"
                          disabled={cancelLoadingId === sub.parentOrderId}
                          onClick={() => setConfirmCancelOrderId(null)}
                          className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Voltar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmCancelOrderId(sub.parentOrderId)}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white transition hover:bg-red-700"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancelar Pedido e Liberar Estoque
                      </button>
                    )}
                  </div>
                )}

                {sub.logisticsAddress && (
                  <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                    <strong>Endereço / Ponto de Entrega:</strong> {sub.logisticsAddress}
                  </div>
                )}

                {sub.status === 'dispatched' ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-[#0E7A34] space-y-2">
                    <p className="font-semibold">
                      Despacho concluído · {sub.receiptNote || 'Comprovante anexado'}
                    </p>
                    {sub.receiptUrl && (
                      <img
                        src={sub.receiptUrl}
                        alt="Canhoto de entrega"
                        className="h-36 rounded-lg object-cover border border-emerald-200"
                      />
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        type="text"
                        value={receiptNotes[sub.id] ?? ''}
                        onChange={(e) =>
                          setReceiptNotes((prev) => ({
                            ...prev,
                            [sub.id]: e.target.value,
                          }))
                        }
                        placeholder="Observação / Nº do conhecimento ou canhoto"
                        className="h-10 rounded-xl border border-slate-200 px-3 text-xs focus:border-[#0E7A34] focus:outline-none"
                      />

                      <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:border-[#0E7A34]">
                        <Camera className="h-4 w-4" />
                        <span>
                          {receiptImages[sub.id]
                            ? 'Foto do canhoto anexada'
                            : 'Anexar foto do canhoto'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => void handleReceiptPhotoUpload(sub.id, e)}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        await onDispatchSubOrder(
                          sub,
                          receiptNotes[sub.id]?.trim() || 'Mercadoria despachada',
                          receiptImages[sub.id]
                        );
                        setFeedback(`Subpedido ${sub.subOrderCode} marcado como despachado.`);
                      }}
                      className="h-10 w-full rounded-xl bg-[#0D2B3E] text-xs font-semibold text-white hover:bg-[#143d57]"
                    >
                      Confirmar Despacho e Enviar Comprovante
                    </button>
                  </div>
                )}

                {onOpenHelp && (
                  <div className="flex justify-end border-t border-slate-100 pt-2">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenHelp({
                          defaultTab: 'ticket',
                          orderId: sub.parentOrderId,
                          orderCode: sub.subOrderCode,
                          reason: 'Dúvida sobre Pedido',
                        })
                      }
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-[#0D2B3E]"
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

      {/* TAB 4: LAYER 1 FINANCE (F06) */}
      {activeTab === 'finance' && (
        <div className="space-y-4">
          <WalletIdSplitCard
            currentWalletId={profile.asaasWalletId}
            onSaveWalletId={onSaveWalletId}
            roleHint="Informe a Wallet ID da conta Asaas da fábrica para receber o Split automático."
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold text-slate-500">
                A Receber das Vendas
              </span>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0D2B3E] tabular-nums">
                {formatBRL(totalToReceive)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold text-slate-500">
                Recebido / Quitado
              </span>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0E7A34] tabular-nums">
                {formatBRL(totalReceived)}
              </p>
            </div>
          </div>

          {myPayments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
              Nenhum lançamento financeiro de pedidos ainda.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {myPayments.map((pay) => {
                const linkedOrder = orders.find((o) => o.id === pay.orderId);
                const splitPreview = linkedOrder
                  ? calculateOrderSplit({
                      orderTotal: linkedOrder.buyerFinalTotal,
                      factoryCostTotal: linkedOrder.factoryCostTotal,
                      paymentMethod: linkedOrder.paymentMethod || 'pix',
                      installments: linkedOrder.installments || 1,
                      isDirectManufacturerSale:
                        linkedOrder.factoryIds.length === 1 &&
                        linkedOrder.factoryIds[0] === linkedOrder.resellerId &&
                        Math.abs(linkedOrder.buyerFinalTotal - linkedOrder.factoryCostTotal) < 0.01,
                    })
                  : null;
                const factoryNet =
                  typeof pay.netAmount === 'number'
                    ? pay.netAmount
                    : splitPreview?.factoryNetTotal ?? pay.amount;
                const resellerNet =
                  linkedOrder?.splitResellerNet ?? splitPreview?.resellerNetTotal;
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
                          {pay.subOrderCode || pay.orderCode} · {pay.counterpartyName}
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
                        Vencimento: {pay.dueDate} · Valor Bruto:{' '}
                        <strong className="text-slate-900">{formatBRL(pay.amount)}</strong>
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-[11px] tabular-nums">
                        <span className="text-[#0D2B3E]">
                          Líquido Fabricante: <strong>{formatBRL(factoryNet)}</strong>
                        </span>
                        {typeof resellerNet === 'number' && resellerNet > 0 && (
                          <span className="text-[#0E7A34]">
                            Líquido Revendedor: <strong>{formatBRL(resellerNet)}</strong>
                          </span>
                        )}
                        {typeof (pay.platformFeeGross ?? splitPreview?.platformGrossFee) ===
                          'number' && (
                          <span className="text-slate-600">
                            Taxa ChatFi:{' '}
                            <strong>
                              {formatBRL(
                                (pay.platformFeeGross ?? splitPreview?.platformGrossFee) || 0
                              )}
                            </strong>
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
                          {onSyncAsaasStatus && linkedOrder && (
                            <button
                              type="button"
                              disabled={syncingPayId === pay.id}
                              onClick={async () => {
                                setSyncingPayId(pay.id);
                                try {
                                  await onSyncAsaasStatus(linkedOrder);
                                  setFeedback(
                                    `Status Asaas de ${pay.subOrderCode || pay.orderCode} atualizado.`
                                  );
                                } finally {
                                  setSyncingPayId(null);
                                }
                              }}
                              className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${
                                  syncingPayId === pay.id ? 'animate-spin' : ''
                                }`}
                              />
                              Verificar Asaas
                            </button>
                          )}
                          <select
                            value={pay.method}
                            onChange={(e) =>
                              void onUpdatePayment(pay.id, {
                                method: e.target.value as PaymentMethod,
                              })
                            }
                            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700"
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
                            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800"
                          >
                            {(['Aguardando', 'Parcial', 'Quitado', 'Em Atraso', 'Cancelado'] as PaymentStatus[]).map(
                              (s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              )
                            )}
                          </select>
                        </>
                      )}

                      {onOpenHelp && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenHelp({
                              defaultTab: 'ticket',
                              orderId: pay.orderId,
                              orderCode: pay.subOrderCode || pay.orderCode,
                              reason: 'Problema com Pagamento / Pix',
                            })
                          }
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-[#0D2B3E]"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                          Precisa de ajuda?
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: MINIMUM DELIVERY POLICY (F01) */}
      {activeTab === 'policy' && (
        <form
          onSubmit={handleSavePolicySubmit}
          className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
        >
          <h2 className="text-sm font-bold text-slate-900">
            Política de Mínimo para Entrega
          </h2>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Nome da Fábrica / Empresa
            </label>
            <input
              type="text"
              required
              value={factoryName}
              onChange={(e) => setFactoryName(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#0E7A34] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Tipo de mínimo
              </label>
              <select
                value={policyType}
                onChange={(e) =>
                  setPolicyType(e.target.value as MinimumDeliveryPolicy['type'])
                }
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="boxes">Quantidade de caixas</option>
                <option value="pieces">Quantidade de peças/pares</option>
                <option value="amount">Valor mínimo em R$</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Valor mínimo
              </label>
              <input
                type="number"
                min="1"
                step="any"
                required
                value={policyValue}
                onChange={(e) => setPolicyValue(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={allowPickup}
              onChange={(e) => setAllowPickup(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#0E7A34]"
            />
            Aceitar retirada no balcão da fábrica
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="h-11 w-full rounded-xl bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
          >
            Salvar Política de Entrega
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
    </div>
  );
};
