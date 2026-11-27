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
  Images,
  Minus,
  Package,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Settings2,
  Star,
  Truck,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import type {
  CommercialReview,
  DualPaymentRecord,
  FactoryConnection,
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
  MAX_PRODUCT_IMAGES,
  PRODUCT_CATEGORIES,
  categoryUsesApparelSizes,
  categoryUsesFootwearSizes,
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
  parseSpecsSummaryEntries,
  resolveProductImages,
  resolveProductPackLabel,
  resolveProductQuantityPerPack,
  resolveProductUnitType,
} from '../lib/categories';
import { CategoryIcon } from '../lib/categoryIcons';
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
import {
  compressImageFileToDataUrl,
  compressImageFileToMaxBytes,
} from '../lib/phoneUtils';
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
import { StarRatingBadge } from './StarRatingBadge';

interface ManufacturerPanelProps {
  profile: UserProfile;
  products: Product[];
  subOrders: SubOrder[];
  orders?: MixedOrder[];
  payments: DualPaymentRecord[];
  connections?: FactoryConnection[];
  receivedReviews?: CommercialReview[];
  onRespondResellerRequest?: (
    connection: FactoryConnection,
    decision: 'approved' | 'rejected'
  ) => Promise<void>;
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
    imageUrls?: string[];
  }) => Promise<void>;
  onUpdateProduct?: (
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
  ) => Promise<void>;
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

type FactoryTab = 'catalog' | 'resellers' | 'conference' | 'dispatch' | 'finance' | 'policy';

export const ManufacturerPanel: React.FC<ManufacturerPanelProps> = ({
  profile,
  products,
  subOrders,
  orders = [],
  payments,
  connections = [],
  receivedReviews = [],
  onRespondResellerRequest,
  onSavePolicy,
  onSaveWalletId,
  onSyncAsaasStatus,
  onSaveFavoriteGrade,
  onCreateProduct,
  onUpdateProduct,
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
  const [respondingConnId, setRespondingConnId] = useState<string | null>(null);
  const [syncingPayId, setSyncingPayId] = useState<string | null>(null);
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState<string | null>(null);
  const [cancelLoadingId, setCancelLoadingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const factoryConnections = useMemo(
    () => connections.filter((c) => c.factoryId === profile.uid),
    [connections, profile.uid]
  );
  const pendingResellers = useMemo(
    () => factoryConnections.filter((c) => c.approvalStatus === 'pending'),
    [factoryConnections]
  );
  const approvedResellers = useMemo(
    () => factoryConnections.filter((c) => c.approvalStatus === 'approved'),
    [factoryConnections]
  );
  const rejectedResellers = useMemo(
    () => factoryConnections.filter((c) => c.approvalStatus === 'rejected'),
    [factoryConnections]
  );

  const handleResellerDecision = async (
    conn: FactoryConnection,
    decision: 'approved' | 'rejected'
  ) => {
    if (!onRespondResellerRequest) return;
    setRespondingConnId(conn.id);
    setFeedback('');
    try {
      await onRespondResellerRequest(conn, decision);
      const label = conn.resellerStorefrontName || conn.resellerName || 'Revendedor';
      setFeedback(
        decision === 'approved'
          ? `Revendedor "${label}" aprovado! Os produtos da sua fábrica já estão liberados para a vitrine dele.`
          : `Autorização de "${label}" recusada/revogada. Os produtos foram removidos da vitrine dele.`
      );
    } finally {
      setRespondingConnId(null);
    }
  };
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // F01 Policy state (optional wholesale minimum)
  const [factoryName, setFactoryName] = useState(profile.factoryName || profile.name);
  const [useWholesaleMinimum, setUseWholesaleMinimum] = useState<boolean>(() =>
    hasExplicitWholesalePolicy(profile.factoryPolicy)
  );
  const [policyType, setPolicyType] = useState<MinimumDeliveryPolicy['type']>(
    profile.factoryPolicy.type || 'pieces'
  );
  const [policyValue, setPolicyValue] = useState(String(Math.max(1, profile.factoryPolicy.value || 1)));
  const [allowPickup, setAllowPickup] = useState(Boolean(profile.factoryPolicy.allowCounterPickup));

  useEffect(() => {
    setFactoryName(profile.factoryName || profile.name);
  }, [profile.factoryName, profile.name]);

  // Progressive Dynamic Ad Form state (no footwear lock-in!)
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodCategory, setProdCategory] = useState<ProductCategory | ''>('');
  const [prodSubcategory, setProdSubcategory] = useState<string>('');
  const [prodAudience, setProdAudience] = useState<string>('');
  const [sellAsPack, setSellAsPack] = useState<boolean>(false);
  const [prodUnitType, setProdUnitType] = useState<ProductUnitType>('unidade');
  const [prodQtyPerPack, setProdQtyPerPack] = useState<string>('1');
  const [priceEntryMode, setPriceEntryMode] = useState<'pack' | 'unit'>('pack');
  const [prodPrice, setProdPrice] = useState('');
  const [prodStock, setProdStock] = useState('1');
  const [prodGradeRaw, setProdGradeRaw] = useState('Único:1');
  const [specValues, setSpecValues] = useState<Record<string, string>>({});
  const [prodImageUrls, setProdImageUrls] = useState<string[]>([]);
  const [prodImageNames, setProdImageNames] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [moderationWarning, setModerationWarning] = useState('');
  const [favLabel, setFavLabel] = useState('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pricingSimMethod, setPricingSimMethod] = useState<SplitPaymentMethod>('pix');
  const [pricingSimInstallments, setPricingSimInstallments] = useState(1);

  const productPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const productFormRef = useRef<HTMLFormElement | null>(null);

  const currentCatDef = useMemo(
    () => (prodCategory ? getCategoryDefinition(prodCategory) : null),
    [prodCategory]
  );
  const isSingleAsset = currentCatDef?.behavior === 'single_asset';
  const usesFootwearSizes = useMemo(
    () =>
      Boolean(prodCategory) &&
      categoryUsesFootwearSizes(prodCategory, prodSubcategory),
    [prodCategory, prodSubcategory]
  );
  const usesApparelSizes = useMemo(
    () => Boolean(prodCategory) && categoryUsesApparelSizes(prodCategory),
    [prodCategory]
  );
  const showAudienceSelector = useMemo(
    () =>
      Boolean(currentCatDef?.audienceOptions?.length) &&
      (usesFootwearSizes || usesApparelSizes),
    [currentCatDef, usesFootwearSizes, usesApparelSizes]
  );

  const effectiveQtyPerPack = useMemo(() => {
    if (!currentCatDef || isSingleAsset || !sellAsPack) return 1;
    const n = Number.parseInt(prodQtyPerPack, 10);
    return Number.isFinite(n) && n >= 1 ? Math.min(10000, n) : 1;
  }, [currentCatDef, isSingleAsset, sellAsPack, prodQtyPerPack]);

  const sizePalette = useMemo<string[]>(() => {
    if (usesFootwearSizes) {
      if (prodAudience === 'Infantil') {
        return ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33'];
      }
      if (prodAudience === 'Juvenil') {
        return ['28', '29', '30', '31', '32', '33', '34', '35', '36'];
      }
      return ['34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44'];
    }
    if (usesApparelSizes) {
      if (prodAudience === 'Infantil' || prodSubcategory === 'Infantil') {
        return ['RN', '1 ano', '2 anos', '4 anos', '6 anos', '8 anos', '10 anos', '12 anos', '14 anos'];
      }
      return ['PP', 'P', 'M', 'G', 'GG', 'XG', 'G1', 'G2'];
    }
    return [];
  }, [usesFootwearSizes, usesApparelSizes, prodAudience, prodSubcategory]);

  const gradeCountMap = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const item of parseGradeString(prodGradeRaw)) {
      if (item.size.toLowerCase() === 'único' || item.size.toLowerCase() === 'unico') continue;
      map[item.size] = (map[item.size] || 0) + item.pairs;
    }
    return map;
  }, [prodGradeRaw]);

  const updateSizeChipQty = (size: string, delta: number) => {
    const nextMap: Record<string, number> = { ...gradeCountMap };
    const nextVal = Math.max(0, (nextMap[size] || 0) + delta);
    if (nextVal === 0) {
      delete nextMap[size];
    } else {
      nextMap[size] = nextVal;
    }
    const orderedKeys = [
      ...sizePalette.filter((s) => (nextMap[s] || 0) > 0),
      ...Object.keys(nextMap).filter((k) => !sizePalette.includes(k) && (nextMap[k] || 0) > 0),
    ];
    if (orderedKeys.length === 0) {
      setProdGradeRaw('Único:1');
      if (sellAsPack) setProdQtyPerPack('1');
      return;
    }
    const raw = orderedKeys.map((k) => `${k}:${nextMap[k]}`).join(', ');
    const sum = orderedKeys.reduce((acc, k) => acc + nextMap[k], 0);
    setProdGradeRaw(raw);
    if (sellAsPack) {
      setProdQtyPerPack(String(Math.max(1, sum)));
    }
  };

  const applySizedPreset = (raw: string, asPack: boolean, unit: ProductUnitType) => {
    const sum = getTotalPairsFromGrade(raw);
    setSellAsPack(asPack);
    setProdUnitType(unit);
    setProdGradeRaw(raw);
    setProdQtyPerPack(String(asPack ? Math.max(1, sum) : 1));
    if (!asPack) setPriceEntryMode('pack');
  };

  const handleCategoryChange = (nextCategory: ProductCategory) => {
    const def = getCategoryDefinition(nextCategory);
    const firstSub = def.subcategories[0] ?? '';
    const isFootwear = categoryUsesFootwearSizes(nextCategory, firstSub);
    const isApparel = categoryUsesApparelSizes(nextCategory);

    setProdCategory(nextCategory);
    setProdSubcategory(firstSub);
    setProdAudience(def.audienceOptions?.[0] ?? '');
    setSpecValues({});
    setModerationWarning('');
    setPriceEntryMode('pack');

    if (def.behavior === 'single_asset') {
      setSellAsPack(false);
      setProdUnitType('unidade');
      setProdQtyPerPack('1');
      setProdGradeRaw('Único:1');
      setProdStock('1');
    } else if (isFootwear) {
      setSellAsPack(true);
      setProdUnitType('par');
      setProdQtyPerPack('12');
      setProdGradeRaw('34:1, 35:2, 36:3, 37:3, 38:2, 39:1');
      setProdStock('10');
    } else if (isApparel) {
      setSellAsPack(true);
      setProdUnitType('unidade');
      setProdQtyPerPack('6');
      setProdGradeRaw('P:1, M:2, G:2, GG:1');
      setProdStock('10');
    } else {
      // General categories default cleanly to single unit (no box/lot!)
      setSellAsPack(false);
      setProdUnitType('unidade');
      setProdQtyPerPack('1');
      setProdGradeRaw('Único:1');
      setProdStock('1');
    }
  };

  const handleSubcategoryChange = (nextSub: string) => {
    setProdSubcategory(nextSub);
    if (!prodCategory) return;
    const def = getCategoryDefinition(prodCategory);
    if (def.behavior === 'footwear_box' && def.nonSizedSubcategories?.includes(nextSub)) {
      setProdAudience('');
      setSellAsPack(false);
      setProdUnitType('unidade');
      setProdQtyPerPack('1');
      setProdGradeRaw('Único:1');
    } else if (def.behavior === 'footwear_box' && !usesFootwearSizes) {
      setProdAudience(def.audienceOptions?.[0] ?? 'Adulto');
      setProdUnitType('par');
    }
    if (def.behavior === 'apparel_flexible' && nextSub === 'Infantil') {
      setProdAudience('Infantil');
      if (sellAsPack) {
        setProdGradeRaw('2 anos:1, 4 anos:1, 6 anos:2, 8 anos:1, 10 anos:1');
        setProdQtyPerPack('6');
      }
    }
  };

  const handleAudienceChange = (nextAudience: string) => {
    setProdAudience(nextAudience);
    if (usesFootwearSizes && sellAsPack) {
      if (nextAudience === 'Infantil') {
        setProdGradeRaw('20:1, 22:2, 24:2, 26:2, 27:1');
        setProdQtyPerPack('8');
      } else if (nextAudience === 'Juvenil') {
        setProdGradeRaw('28:1, 30:2, 32:2, 34:2, 35:1');
        setProdQtyPerPack('8');
      } else {
        setProdGradeRaw('34:1, 35:2, 36:3, 37:3, 38:2, 39:1');
        setProdQtyPerPack('12');
      }
    } else if (usesApparelSizes && sellAsPack) {
      if (nextAudience === 'Infantil') {
        setProdGradeRaw('2 anos:1, 4 anos:1, 6 anos:2, 8 anos:1, 10 anos:1');
        setProdQtyPerPack('6');
      } else {
        setProdGradeRaw('P:1, M:2, G:2, GG:1');
        setProdQtyPerPack('6');
      }
    }
  };

  const applyPackPreset = (qty: number, customGrade?: string, customUnit?: ProductUnitType) => {
    const safeQty = Math.max(1, Math.round(qty));
    setSellAsPack(safeQty > 1);
    setProdQtyPerPack(String(safeQty));
    if (customUnit) setProdUnitType(customUnit);
    if (customGrade) {
      setProdGradeRaw(customGrade);
      return;
    }
    if (safeQty === 1) {
      setProdGradeRaw('Único:1');
      if (prodUnitType === 'kit') setProdUnitType('unidade');
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

  const editingProduct = useMemo(
    () => (editingProductId ? myProducts.find((p) => p.id === editingProductId) ?? null : null),
    [editingProductId, myProducts]
  );

  const startEditingProduct = (product: Product) => {
    const normalizedCat = normalizeProductCategory(product.category);
    const catDef = getCategoryDefinition(normalizedCat);
    const subCat =
      inferProductSubcategory(product.category, product.subcategory) ||
      catDef.subcategories[0] ||
      '';
    const unitType = resolveProductUnitType(product);
    const qty = resolveProductQuantityPerPack(product);
    const single = catDef.behavior === 'single_asset';

    const parsedSpecs: Record<string, string> = {};
    let extractedAudience = '';
    if (product.specsSummary) {
      for (const entry of parseSpecsSummaryEntries(product.specsSummary)) {
        const lowerLabel = entry.label.toLowerCase();
        if (lowerLabel === 'público' || lowerLabel === 'publico') {
          extractedAudience = entry.value;
          continue;
        }
        const matchedField = catDef.specFields?.find(
          (f) => f.label.trim().toLowerCase() === lowerLabel
        );
        if (matchedField && entry.value) {
          parsedSpecs[matchedField.key] = entry.value;
        }
      }
    }

    setEditingProductId(product.id);
    setProdName(product.name);
    setProdSku(product.sku || '');
    setProdCategory(normalizedCat);
    setProdSubcategory(subCat);
    setProdAudience(
      extractedAudience ||
        (catDef.audienceOptions &&
        !catDef.nonSizedSubcategories?.includes(subCat)
          ? catDef.audienceOptions[0]
          : '')
    );
    setSellAsPack(!single && qty > 1);
    setProdUnitType(unitType);
    setProdQtyPerPack(String(qty));
    setPriceEntryMode('pack');
    setProdPrice(String(product.factoryPrice));
    setProdStock(String(product.stockBoxes));
    setProdGradeRaw(product.gradeRaw || (qty === 1 ? 'Único:1' : catDef.defaultGradeRaw));
    setSpecValues(parsedSpecs);
    const existingImgs = resolveProductImages(product);
    setProdImageUrls(existingImgs);
    setProdImageNames(existingImgs.map((_, idx) => `Foto ${idx + 1} atual`));
    setModerationWarning('');
    setFeedback('');

    window.setTimeout(() => {
      productFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  };

  const cancelEditingProduct = () => {
    setEditingProductId(null);
    setProdName('');
    setProdSku('');
    setProdCategory('');
    setProdSubcategory('');
    setProdAudience('');
    setSellAsPack(false);
    setProdUnitType('unidade');
    setProdQtyPerPack('1');
    setPriceEntryMode('pack');
    setProdPrice('');
    setProdStock('1');
    setProdGradeRaw('Único:1');
    setSpecValues({});
    setProdImageUrls([]);
    setProdImageNames([]);
    setModerationWarning('');
  };

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
    if (parsedDraftTotalFactoryPrice <= 0 || !currentCatDef) return 0;
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
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (fileList.length === 0) return;

    const remainingSlots = MAX_PRODUCT_IMAGES - prodImageUrls.length;
    if (remainingSlots <= 0) {
      setModerationWarning(`Você já adicionou o limite de ${MAX_PRODUCT_IMAGES} imagens neste anúncio.`);
      return;
    }

    setModerationWarning('');
    setUploadingPhotos(true);
    const filesToProcess = fileList.slice(0, remainingSlots);
    const skippedCount = fileList.length - filesToProcess.length;

    const addedUrls: string[] = [];
    const addedNames: string[] = [];
    let blockedReason = '';

    try {
      for (const file of filesToProcess) {
        const modCheck = runImageModerationFilter(file.name);
        if (!modCheck.approved) {
          blockedReason = modCheck.reason || 'Imagem bloqueada pelo filtro de moderação.';
          continue;
        }
        const compressed = await compressImageFileToMaxBytes(file, 190000);
        if (compressed) {
          addedUrls.push(compressed);
          addedNames.push(file.name);
        }
      }

      if (addedUrls.length > 0) {
        setProdImageUrls((prev) => [...prev, ...addedUrls].slice(0, MAX_PRODUCT_IMAGES));
        setProdImageNames((prev) => [...prev, ...addedNames].slice(0, MAX_PRODUCT_IMAGES));
      }

      if (blockedReason) {
        setModerationWarning(blockedReason);
      } else if (skippedCount > 0) {
        setModerationWarning(
          `Máximo de ${MAX_PRODUCT_IMAGES} imagens por anúncio. Apenas as ${filesToProcess.length} primeiras selecionadas foram adicionadas.`
        );
      }
    } catch {
      setModerationWarning('Falha ao processar uma ou mais imagens escolhidas.');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleRemoveProductPhoto = (index: number) => {
    setProdImageUrls((prev) => prev.filter((_, idx) => idx !== index));
    setProdImageNames((prev) => prev.filter((_, idx) => idx !== index));
    setModerationWarning('');
  };

  const handleSetCoverPhoto = (index: number) => {
    if (index <= 0 || index >= prodImageUrls.length) return;
    setProdImageUrls((prev) => {
      const next = [...prev];
      const [chosen] = next.splice(index, 1);
      return [chosen, ...next];
    });
    setProdImageNames((prev) => {
      const next = [...prev];
      const [chosen] = next.splice(index, 1);
      return [chosen ?? 'Foto de capa', ...next];
    });
  };

  const handleAddFavoriteGrade = async () => {
    if (!currentCatDef || !prodGradeRaw.trim() || parseGradeString(prodGradeRaw).length === 0) return;
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

    if (!prodCategory || !currentCatDef) {
      setModerationWarning('Escolha primeiro a categoria do anúncio.');
      return;
    }

    const titleMod = runImageModerationFilter(`${prodName} ${prodImageNames.join(' ')}`);
    if (!titleMod.approved) {
      setModerationWarning(titleMod.reason || 'Conteúdo retido pela moderação.');
      return;
    }
    if (prodImageUrls.length === 0) {
      setModerationWarning('Envie pelo menos 1 foto real do item (você pode enviar até 3) antes de publicar.');
      return;
    }

    const finalUnitType: ProductUnitType = isSingleAsset
      ? 'unidade'
      : usesFootwearSizes
        ? 'par'
        : sellAsPack
          ? prodUnitType
          : 'unidade';
    const finalQtyPerPack = isSingleAsset || !sellAsPack ? 1 : effectiveQtyPerPack;

    let finalGradeRaw = 'Único:1';
    if (!isSingleAsset) {
      if (usesFootwearSizes || usesApparelSizes) {
        const cleaned = prodGradeRaw.trim();
        if (cleaned && parseGradeString(cleaned).length > 0) {
          finalGradeRaw = cleaned;
        } else {
          finalGradeRaw = `Único:${finalQtyPerPack}`;
        }
      } else {
        finalGradeRaw = `Único:${finalQtyPerPack}`;
      }
    }

    const parsedGrade = parseGradeString(finalGradeRaw);
    if (!isSingleAsset && sellAsPack && (usesFootwearSizes || usesApparelSizes) && parsedGrade.length === 0) {
      setModerationWarning('Selecione ao menos um tamanho ou numeração com quantidade maior que zero.');
      return;
    }

    const priceNum = parsedDraftTotalFactoryPrice;
    const stockNum = Number.parseInt(prodStock, 10);
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      setModerationWarning('Informe um preço válido maior que zero.');
      return;
    }

    const specParts: string[] = [];
    if (showAudienceSelector && prodAudience.trim()) {
      specParts.push(`Público: ${prodAudience.trim()}`);
    }
    if (currentCatDef.specFields) {
      for (const f of currentCatDef.specFields) {
        const v = (specValues[f.key] || '').trim();
        if (v) specParts.push(`${f.label}: ${v}`);
      }
    }
    const specsSummary = specParts.join(' · ').slice(0, 240);

    const packLabel =
      finalQtyPerPack <= 1
        ? finalUnitType === 'par'
          ? 'Par'
          : 'Unidade'
        : finalUnitType === 'par'
          ? finalQtyPerPack >= 10
            ? 'Caixa'
            : 'Grade'
          : finalUnitType === 'kit'
            ? 'Kit'
            : 'Grade';

    setSubmitting(true);
    try {
      const safeStockBoxes = Math.max(0, Number.isNaN(stockNum) ? 0 : stockNum);
      if (editingProductId && onUpdateProduct) {
        await onUpdateProduct(editingProductId, {
          name: prodName.trim(),
          sku: prodSku.trim() || editingProduct?.sku || `REF-${Date.now().toString().slice(-4)}`,
          category: prodCategory,
          subcategory: prodSubcategory || '',
          unitType: finalUnitType,
          quantityPerPack: finalQtyPerPack,
          packLabel,
          specsSummary: specsSummary || '',
          factoryPrice: priceNum,
          stockBoxes: safeStockBoxes,
          gradeRaw: finalGradeRaw,
          imageUrl: prodImageUrls[0],
          imageUrls: prodImageUrls,
          isSoldOutToday:
            safeStockBoxes > 0 && editingProduct?.stockBoxes === 0
              ? false
              : editingProduct?.isSoldOutToday,
        });
        cancelEditingProduct();
        setFeedback('Anúncio atualizado com sucesso!');
      } else {
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
          stockBoxes: safeStockBoxes,
          gradeRaw: finalGradeRaw,
          imageUrl: prodImageUrls[0],
          imageUrls: prodImageUrls,
        });
        cancelEditingProduct();
        setFeedback('Anúncio publicado com sucesso!');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePolicySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (!useWholesaleMinimum) {
        await onSavePolicy(factoryName.trim() || profile.name, {
          type: 'pieces',
          value: 1,
          allowCounterPickup: false,
          label: '',
        });
        setFeedback('Configurações do anunciante atualizadas (sem mínimo de lote obrigatório).');
        return;
      }

      const numeric = Math.max(1, Number.parseFloat(policyValue.replace(',', '.')) || 1);
      const baseLabel =
        policyType === 'boxes'
          ? `Mínimo ${numeric} ${numeric === 1 ? 'caixa' : 'caixas'}`
          : policyType === 'pieces'
            ? `Mínimo ${numeric} ${numeric === 1 ? 'peça' : 'peças'}`
            : `Mínimo ${formatBRL(numeric)}`;
      const label = allowPickup ? `${baseLabel} · Retirada no local` : baseLabel;

      await onSavePolicy(factoryName.trim() || profile.name, {
        type: policyType,
        value: numeric,
        allowCounterPickup: allowPickup,
        label,
      });
      setFeedback('Regra de lote e nome do anunciante atualizados.');
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
    currentCatDef?.namePlaceholder || 'Ex: Título claro do seu anúncio';

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
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900">
                  {profile.factoryName || profile.name}
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
                Painel do Anunciante / Fabricante
                {hasExplicitWholesalePolicy(profile.factoryPolicy)
                  ? ` · ${profile.factoryPolicy.label}`
                  : ''}
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

        {pendingResellers.length > 0 && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>
                  {pendingResellers.length}{' '}
                  {pendingResellers.length === 1
                    ? 'revendedor aguarda sua aprovação'
                    : 'revendedores aguardam sua aprovação'}
                </strong>{' '}
                para vender os produtos da sua fábrica.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('resellers')}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700"
            >
              Analisar solicitações
            </button>
          </div>
        )}

        {/* Sub-navigation */}
        <div className="mt-4 flex gap-1.5 overflow-x-auto border-t border-slate-100 pt-3">
          {[
            { id: 'catalog', label: `Meus Anúncios (${myProducts.length})`, icon: Package },
            {
              id: 'resellers',
              label: `Revendedores (${approvedResellers.length})`,
              icon: Users,
              badge: pendingResellers.length,
            },
            {
              id: 'conference',
              label: `Conferência (${pendingConference.length})`,
              icon: ClipboardCheck,
            },
            { id: 'dispatch', label: `Despacho (${dispatchQueue.length})`, icon: Truck },
            { id: 'finance', label: `Financeiro (${myPayments.length})`, icon: Receipt },
            { id: 'policy', label: 'Entrega & Lote', icon: Settings2 },
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
                {'badge' in tab && typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                    {tab.badge}
                  </span>
                )}
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
            roleHint="Receba automaticamente o valor das suas vendas via Split Asaas."
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
          {/* Create / Edit Dynamic Progressive Ad Form */}
          <form
            ref={productFormRef}
            onSubmit={handleSubmitProduct}
            className={`lg:col-span-5 rounded-2xl border bg-white p-5 shadow-sm space-y-4 transition ${
              editingProductId
                ? 'border-amber-300 ring-1 ring-amber-200'
                : 'border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                {editingProductId ? 'Editar Anúncio' : 'Criar Novo Anúncio'}
              </h2>
              {editingProductId && (
                <button
                  type="button"
                  onClick={cancelEditingProduct}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Cancelar edição
                </button>
              )}
            </div>

            {editingProduct && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Editando <strong>{editingProduct.name}</strong>. Altere os campos abaixo e clique em{' '}
                <strong>Salvar Alterações</strong>.
              </div>
            )}

            {/* ETAPA 1: Categoria do Anúncio */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  1. Escolha a categoria do anúncio
                </span>
                {currentCatDef && (
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-[#0E7A34]">
                    {currentCatDef.shortLabel}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {PRODUCT_CATEGORIES.map((cat) => {
                  const selected = prodCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => handleCategoryChange(cat.id)}
                      className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-semibold transition ${
                        selected
                          ? 'border-[#0E7A34] bg-emerald-50 text-[#0E7A34] ring-1 ring-[#0E7A34]'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <CategoryIcon categoryId={cat.id} className="h-4 w-4 shrink-0" />
                      <span className="truncate">{cat.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {!currentCatDef ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
                <p className="text-xs font-semibold text-slate-700">
                  Selecione uma categoria acima para continuar
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  O formulário exibirá apenas os campos ideais para o tipo de item que você deseja anunciar (calçados, roupas, motos/veículos, eletrônicos, casa ou geral).
                </p>
              </div>
            ) : (
              <>
                {/* ETAPA 2: Subcategoria e Público/Recorte (quando aplicável) */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-3">
                  <span className="block text-xs font-bold text-slate-800">
                    2. Tipo e recorte ({currentCatDef.shortLabel})
                  </span>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className={showAudienceSelector ? '' : 'sm:col-span-2'}>
                      <label className="block text-[11px] font-semibold text-slate-600">
                        Subcategoria
                      </label>
                      <select
                        value={prodSubcategory}
                        onChange={(e) => handleSubcategoryChange(e.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                      >
                        {currentCatDef.subcategories.map((sub) => (
                          <option key={sub} value={sub}>
                            {sub}
                          </option>
                        ))}
                      </select>
                    </div>

                    {showAudienceSelector && currentCatDef.audienceOptions && (
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600">
                          Público / Recorte
                        </label>
                        <select
                          value={prodAudience}
                          onChange={(e) => handleAudienceChange(e.target.value)}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                        >
                          {currentCatDef.audienceOptions.map((aud) => (
                            <option key={aud} value={aud}>
                              {aud}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                {/* ETAPA 3: Fotos (até 3), Título e Campos Específicos da Categoria */}
                <input
                  ref={productPhotoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleProductPhotoUpload}
                  className="hidden"
                />

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      3. Fotos reais do anúncio (até {MAX_PRODUCT_IMAGES} imagens)
                    </label>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-600 tabular-nums">
                      {prodImageUrls.length}/{MAX_PRODUCT_IMAGES}
                    </span>
                  </div>

                  {prodImageUrls.length === 0 ? (
                    <button
                      type="button"
                      disabled={uploadingPhotos}
                      onClick={() => productPhotoInputRef.current?.click()}
                      className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center transition hover:border-[#0E7A34] hover:bg-emerald-50/40 disabled:opacity-60"
                    >
                      <Upload className="h-7 w-7 text-slate-400" />
                      <span className="mt-2 text-xs font-semibold text-slate-700">
                        {uploadingPhotos
                          ? 'Otimizando imagens...'
                          : `Selecionar até ${MAX_PRODUCT_IMAGES} fotos da câmera ou galeria`}
                      </span>
                      <span className="mt-0.5 text-[11px] text-slate-500">
                        A 1ª foto será a capa do anúncio · Compressão automática
                      </span>
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: MAX_PRODUCT_IMAGES }).map((_, slotIdx) => {
                          const imgUrl = prodImageUrls[slotIdx];
                          if (imgUrl) {
                            return (
                              <div
                                key={`slot-${slotIdx}`}
                                className={`group relative aspect-square overflow-hidden rounded-xl border bg-slate-100 ${
                                  slotIdx === 0
                                    ? 'border-[#0E7A34] ring-2 ring-[#0E7A34]/20'
                                    : 'border-slate-200'
                                }`}
                              >
                                <img
                                  src={imgUrl}
                                  alt={`Foto ${slotIdx + 1} do anúncio`}
                                  className="h-full w-full object-cover"
                                />
                                {slotIdx === 0 ? (
                                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-md bg-[#0E7A34] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs">
                                    <Star className="h-2.5 w-2.5 fill-current" />
                                    Capa
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleSetCoverPhoto(slotIdx)}
                                    title="Definir como foto de capa"
                                    className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-md bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-semibold text-white transition hover:bg-[#0E7A34]"
                                  >
                                    <Star className="h-2.5 w-2.5" />
                                    Capa
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveProductPhoto(slotIdx)}
                                  aria-label={`Remover foto ${slotIdx + 1}`}
                                  title="Remover foto"
                                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/75 text-white transition hover:bg-red-600"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            );
                          }

                          return (
                            <button
                              key={`empty-slot-${slotIdx}`}
                              type="button"
                              disabled={uploadingPhotos}
                              onClick={() => productPhotoInputRef.current?.click()}
                              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500 transition hover:border-[#0E7A34] hover:bg-emerald-50/40 hover:text-[#0E7A34] disabled:opacity-60"
                            >
                              <Camera className="h-5 w-5" />
                              <span className="text-[11px] font-semibold">
                                + Foto {slotIdx + 1}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {prodImageUrls.length < MAX_PRODUCT_IMAGES && (
                        <button
                          type="button"
                          disabled={uploadingPhotos}
                          onClick={() => productPhotoInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0E7A34] hover:underline disabled:opacity-60"
                        >
                          <Camera className="h-3.5 w-3.5" />
                          {uploadingPhotos
                            ? 'Otimizando imagens...'
                            : `Adicionar mais fotos (faltam ${
                                MAX_PRODUCT_IMAGES - prodImageUrls.length
                              })`}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Título do anúncio
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

                  {/* Dynamic Category Attributes (Vehicles, Real Estate, Electronics, House, General, Condition & Delivery) */}
                  {currentCatDef.specFields && currentCatDef.specFields.length > 0 && (
                    <div className="sm:col-span-2 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                      {currentCatDef.specFields.map((field) => (
                        <div key={field.key}>
                          <label className="block text-[11px] font-semibold text-slate-600">
                            {field.label}
                          </label>
                          {field.type === 'select' && field.options ? (
                            <select
                              value={specValues[field.key] ?? ''}
                              onChange={(e) =>
                                setSpecValues((prev) => ({
                                  ...prev,
                                  [field.key]: e.target.value,
                                }))
                              }
                              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                            >
                              <option value="">Selecionar...</option>
                              {field.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
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
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* FOOTWEAR & APPAREL: Interactive Size / Numbering Grid (ZERO shoe numbers on apparel/vehicles/general!) */}
                  {(usesFootwearSizes || usesApparelSizes) && (
                    <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">
                          {usesFootwearSizes
                            ? `Grade de Numerações (${prodAudience || 'Adulto'})`
                            : `Tamanhos e Quantidade (${prodAudience || 'Adulto'})`}
                        </span>
                        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSellAsPack(false);
                              setProdQtyPerPack('1');
                              setProdUnitType(usesFootwearSizes ? 'par' : 'unidade');
                              setPriceEntryMode('pack');
                            }}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                              !sellAsPack
                                ? 'bg-[#0D2B3E] text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {usesFootwearSizes ? 'Par avulso' : 'Peça avulsa'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSellAsPack(true);
                              setProdUnitType(usesFootwearSizes ? 'par' : 'unidade');
                              const sum = getTotalPairsFromGrade(prodGradeRaw);
                              if (sum > 1 && hasStructuredGrade(prodGradeRaw)) {
                                setProdQtyPerPack(String(sum));
                              } else if (usesFootwearSizes) {
                                const raw =
                                  prodAudience === 'Infantil'
                                    ? '20:1, 22:2, 24:2, 26:2, 27:1'
                                    : '34:1, 35:2, 36:3, 37:3, 38:2, 39:1';
                                applySizedPreset(raw, true, 'par');
                              } else {
                                const raw =
                                  prodAudience === 'Infantil' || prodSubcategory === 'Infantil'
                                    ? '2 anos:1, 4 anos:1, 6 anos:2, 8 anos:1, 10 anos:1'
                                    : 'P:1, M:2, G:2, GG:1';
                                applySizedPreset(raw, true, 'unidade');
                              }
                            }}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                              sellAsPack
                                ? 'bg-[#0D2B3E] text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {usesFootwearSizes ? 'Grade / Caixa' : 'Grade / Kit'}
                          </button>
                        </div>
                      </div>

                      {/* Quick Category + Audience Presets */}
                      <div className="flex flex-wrap gap-1.5">
                        {usesFootwearSizes ? (
                          prodAudience === 'Infantil' ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  applySizedPreset('20:1, 22:2, 24:2, 26:2, 27:1', true, 'par')
                                }
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                              >
                                Infantil 20–27 (8 pares)
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  applySizedPreset('28:1, 29:2, 30:2, 31:2, 32:2, 33:1', true, 'par')
                                }
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                              >
                                Infantil 28–33 (10 pares)
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  applySizedPreset('34:1, 35:2, 36:3, 37:3, 38:2, 39:1', true, 'par')
                                }
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                              >
                                Adulto 34–39 (12 pares)
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  applySizedPreset('38:1, 39:2, 40:3, 41:3, 42:2, 43:1', true, 'par')
                                }
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                              >
                                Adulto 38–43 (12 pares)
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  applySizedPreset('34:1, 35:1, 36:1, 37:1, 38:1, 39:1', true, 'par')
                                }
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                              >
                                6 pares (34–39)
                              </button>
                            </>
                          )
                        ) : prodAudience === 'Infantil' || prodSubcategory === 'Infantil' ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                applySizedPreset(
                                  '2 anos:1, 4 anos:1, 6 anos:2, 8 anos:1, 10 anos:1',
                                  true,
                                  'unidade'
                                )
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                            >
                              Infantil 2–10 anos (6 peças)
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                applySizedPreset(
                                  '4 anos:2, 6 anos:2, 8 anos:2, 10 anos:2, 12 anos:2',
                                  true,
                                  'unidade'
                                )
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                            >
                              Infantil 4–12 anos (10 peças)
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                applySizedPreset('P:1, M:2, G:2, GG:1', true, 'unidade')
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                            >
                              Grade P–GG (6 peças)
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                applySizedPreset('P:2, M:4, G:4, GG:2', true, 'unidade')
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                            >
                              Grade P–GG (12 peças)
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setProdGradeRaw('Único:1');
                            if (sellAsPack) setProdQtyPerPack('1');
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100"
                        >
                          Limpar
                        </button>
                      </div>

                      {/* Interactive Size/Number Quantity Chips */}
                      <div>
                        <p className="mb-1.5 text-[11px] text-slate-500">
                          {usesFootwearSizes
                            ? 'Toque em + ou − para definir a quantidade de cada numeração:'
                            : 'Toque em + ou − para definir a quantidade de cada tamanho:'}
                        </p>
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                          {sizePalette.map((sz) => {
                            const count = gradeCountMap[sz] || 0;
                            return (
                              <div
                                key={sz}
                                className={`flex flex-col items-center rounded-lg border p-1.5 transition ${
                                  count > 0
                                    ? 'border-[#0E7A34] bg-emerald-50/70'
                                    : 'border-slate-200 bg-white'
                                }`}
                              >
                                <span className="text-[11px] font-bold text-[#0D2B3E]">{sz}</span>
                                <div className="mt-1 flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => updateSizeChipQty(sz, -1)}
                                    disabled={count === 0}
                                    className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                                  >
                                    <Minus className="h-3 w-3" />
                                  </button>
                                  <span className="min-w-[18px] text-center font-mono text-xs font-bold text-[#F97316] tabular-nums">
                                    {count}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => updateSizeChipQty(sz, 1)}
                                    className="flex h-6 w-6 items-center justify-center rounded bg-[#0E7A34] text-white hover:bg-[#0B5D27]"
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Optional Favorite Grades & Direct Grade Preview */}
                      {hasStructuredGrade(prodGradeRaw) && (
                        <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
                          <GradeVisualGrid
                            gradeRaw={prodGradeRaw}
                            compact
                            title={getGradeDisplayTitle(prodCategory)}
                            unitLabel={usesFootwearSizes ? 'pares' : 'un'}
                          />
                          <div className="flex gap-1.5 pt-1">
                            <input
                              type="text"
                              value={favLabel}
                              onChange={(e) => setFavLabel(e.target.value)}
                              placeholder="Salvar grade favorita (opcional)..."
                              className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-[11px] focus:border-[#0E7A34] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => void handleAddFavoriteGrade()}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              <BookmarkPlus className="h-3 w-3" />
                              Salvar
                            </button>
                          </div>
                        </div>
                      )}

                      {profile.favoriteGrades.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {profile.favoriteGrades.map((fav) => (
                            <button
                              key={fav.id}
                              type="button"
                              onClick={() =>
                                applySizedPreset(
                                  fav.raw,
                                  getTotalPairsFromGrade(fav.raw) > 1,
                                  usesFootwearSizes ? 'par' : 'unidade'
                                )
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-[#0E7A34] hover:text-[#0E7A34]"
                            >
                              {fav.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* GENERAL CATEGORIES: Optional Kit/Package toggle (off by default — zero forced box/lot!) */}
                  {!isSingleAsset && !usesFootwearSizes && !usesApparelSizes && (
                    <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={sellAsPack}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSellAsPack(checked);
                            if (checked) {
                              setProdUnitType('kit');
                              setProdQtyPerPack('6');
                              setProdGradeRaw('Único:6');
                            } else {
                              setProdUnitType('unidade');
                              setProdQtyPerPack('1');
                              setProdGradeRaw('Único:1');
                              setPriceEntryMode('pack');
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-[#0E7A34]"
                        />
                        Vender como kit ou pacote com várias unidades (opcional)
                      </label>

                      {sellAsPack && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {[2, 6, 12].map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => applyPackPreset(q, `Único:${q}`, 'kit')}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                                effectiveQtyPerPack === q
                                  ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              Kit {q} unid.
                            </button>
                          ))}
                          <div className="flex items-center gap-1 ml-auto">
                            <span className="text-[11px] text-slate-500">Qtd. no kit:</span>
                            <input
                              type="number"
                              min="2"
                              max="10000"
                              value={prodQtyPerPack}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setProdQtyPerPack(raw);
                                const parsed = Number.parseInt(raw, 10);
                                if (Number.isFinite(parsed) && parsed >= 1) {
                                  setProdGradeRaw(`Único:${parsed}`);
                                }
                              }}
                              className="h-8 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center font-mono text-xs font-bold tabular-nums focus:border-[#0E7A34] focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Código / Referência (opcional)
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
                      {isSingleAsset
                        ? 'Quantidade disponível'
                        : effectiveQtyPerPack === 1
                          ? usesFootwearSizes
                            ? 'Quantidade disponível (pares)'
                            : 'Quantidade disponível (unidades)'
                          : 'Estoque disponível (grades/kits)'}
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
                          ? 'Preço do anúncio (R$)'
                          : priceEntryMode === 'pack'
                            ? `Preço total da grade/kit (${effectiveQtyPerPack} ${
                                prodUnitType === 'par' ? 'pares' : 'unid.'
                              })`
                            : `Preço por ${unitSuffix} (R$)`}
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
                            Total grade/kit
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
                          ? '18500.00'
                          : effectiveQtyPerPack === 1
                            ? '149.90'
                            : priceEntryMode === 'pack'
                              ? '480.00'
                              : '40.00'
                      }
                      className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm focus:border-[#0E7A34] focus:outline-none"
                    />

                    {/* Live Automatic Price Breakdown */}
                    {parsedDraftTotalFactoryPrice > 0 && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 space-y-1">
                        {effectiveQtyPerPack > 1 ? (
                          <>
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-700">
                                Valor por {unitSuffix} ({effectiveQtyPerPack}x):
                              </span>
                              <span className="font-mono font-bold text-[#0D2B3E] tabular-nums">
                                {formatBRL(draftFactoryUnitPrice)} / {unitSuffix}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-600">Total da grade/kit:</span>
                              <span className="font-mono font-semibold text-slate-800 tabular-nums">
                                {formatBRL(parsedDraftTotalFactoryPrice)}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-700">Valor do anúncio:</span>
                            <span className="font-mono font-bold text-[#0D2B3E] tabular-nums">
                              {formatBRL(parsedDraftTotalFactoryPrice)}
                            </span>
                          </div>
                        )}
                        {!isSingleAsset && (
                          <div className="flex items-center justify-between border-t border-emerald-200/70 pt-1.5 text-xs">
                            <span className="font-semibold text-[#0E7A34]">
                              Referência com margem de revenda:
                            </span>
                            <span className="font-mono font-bold text-[#0E7A34] tabular-nums">
                              {formatBRL(estimatedPublicUnitPrice)}
                              {effectiveQtyPerPack > 1 ? ` / ${unitSuffix}` : ''}
                              {effectiveQtyPerPack > 1 && (
                                <span className="font-normal text-slate-600">
                                  {' '}
                                  ({formatBRL(estimatedPublicPackPrice)} total)
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {parsedDraftTotalFactoryPrice > 0 && (
                  <SplitBreakdownCard
                    breakdown={draftSplitPreview}
                    title="Simulação de Recebimento (venda direta)"
                    factoryLabel="Quanto cai líquido para você"
                    hideResellerIfDirect
                    showMethodToggle
                    onChangeMethod={setPricingSimMethod}
                    onChangeInstallments={setPricingSimInstallments}
                  />
                )}

                {moderationWarning && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{moderationWarning}</span>
                  </div>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="h-11 flex-1 rounded-xl bg-[#0E7A34] text-sm font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
                  >
                    {submitting
                      ? editingProductId
                        ? 'Salvando alterações...'
                        : 'Publicando...'
                      : editingProductId
                        ? 'Salvar Alterações do Anúncio'
                        : 'Publicar Anúncio'}
                  </button>
                  {editingProductId && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={cancelEditingProduct}
                      className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </>
            )}
          </form>

          {/* Fast Stock Management List */}
          <div className="lg:col-span-7 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">
              Anúncios Publicados
            </h2>

            {myProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <Package className="mx-auto h-9 w-9 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-800">
                  Nenhum anúncio publicado ainda
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Escolha uma categoria ao lado e publique seu primeiro anúncio com foto real. Ele ficará disponível imediatamente na sua vitrine.
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
                  const specEntries = parseSpecsSummaryEntries(product.specsSummary);
                  const showGradeGrid =
                    !singleAsset && hasStructuredGrade(product.gradeRaw);

                  const isEditingThis = editingProductId === product.id;

                  return (
                    <div
                      key={product.id}
                      className={`flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition sm:flex-row ${
                        isEditingThis
                          ? 'border-amber-400 bg-amber-50/30 ring-1 ring-amber-200'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:h-28 sm:w-28">
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                        {resolveProductImages(product).length > 1 && (
                          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            <Images className="h-3 w-3" />
                            {resolveProductImages(product).length} fotos
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              {mainCat}
                              {subCat ? ` · ${subCat}` : ''}
                              {product.sku ? ` · ${product.sku}` : ''}
                            </span>
                            <h3 className="text-sm font-bold text-slate-900">
                              {product.name}
                            </h3>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            {qty > 1 ? (
                              <>
                                <span className="block text-sm font-bold text-[#0E7A34]">
                                  {formatBRL(unitFactory)} / {unitSuffix}
                                </span>
                                <span className="block text-[11px] text-slate-500">
                                  {packSummary}: {formatBRL(product.factoryPrice)}
                                </span>
                              </>
                            ) : (
                              <span className="block text-sm font-bold text-[#0E7A34]">
                                {formatBRL(product.factoryPrice)}
                              </span>
                            )}
                          </div>
                        </div>

                        {specEntries.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {specEntries.map((entry, idx) => (
                              <span
                                key={`${entry.label}-${idx}`}
                                className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
                              >
                                {entry.label ? (
                                  <>
                                    <span className="font-semibold text-slate-500 mr-1">
                                      {entry.label}:
                                    </span>
                                    <span className="font-medium text-slate-800">
                                      {entry.value}
                                    </span>
                                  </>
                                ) : (
                                  <span className="font-medium text-slate-800">
                                    {entry.value}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        {showGradeGrid && (
                          <GradeVisualGrid
                            gradeRaw={product.gradeRaw}
                            compact
                            title={getGradeDisplayTitle(product.category)}
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
                                  no Pix aplica tarifa mínima de {formatBRL(PIX_MIN_GROSS_BRL)} · Líquido:{' '}
                                  <strong>{formatBRL(pixPreview.factoryNetTotal)}</strong>
                                </>
                              ) : (
                                <>
                                  Repasse líquido (venda direta Pix):{' '}
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
                              Disponível:
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
                              {singleAsset
                                ? product.stockBoxes
                                : qty === 1
                                  ? `${product.stockBoxes} ${
                                      unitType === 'par'
                                        ? product.stockBoxes === 1
                                          ? 'par'
                                          : 'pares'
                                        : 'un'
                                    }`
                                  : `${product.stockBoxes} ${
                                      packLabel.toLowerCase() === 'caixa'
                                        ? 'cx'
                                        : packLabel.toLowerCase()
                                    }`}
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

                          <div className="flex flex-wrap items-center gap-2">
                            {onUpdateProduct && (
                              <button
                                type="button"
                                onClick={() => startEditingProduct(product)}
                                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                  isEditingThis
                                    ? 'bg-amber-600 text-white hover:bg-amber-700'
                                    : 'border border-emerald-200 bg-emerald-50 text-[#0E7A34] hover:bg-emerald-100'
                                }`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {isEditingThis ? 'Editando' : 'Editar'}
                              </button>
                            )}

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

      {/* TAB 5: ADVERTISER PROFILE & OPTIONAL WHOLESALE POLICY */}
      {activeTab === 'policy' && (
        <form
          onSubmit={handleSavePolicySubmit}
          className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
        >
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Perfil do Anunciante e Regra de Lote (Opcional)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              A regra de pedido mínimo é opcional e só aparece nos anúncios vendidos em grade/lote quando você ativá-la abaixo.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Nome do Anunciante / Loja / Fábrica
            </label>
            <input
              type="text"
              required
              value={factoryName}
              onChange={(e) => setFactoryName(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#0E7A34] focus:outline-none"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={useWholesaleMinimum}
              onChange={(e) => setUseWholesaleMinimum(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#0E7A34]"
            />
            Exigir pedido mínimo para vendas em atacado / lote
          </label>

          {useWholesaleMinimum && (
            <>
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
                Aceitar retirada no local
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="h-11 w-full rounded-xl bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
          >
            Salvar Configurações
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
      {/* TAB: RESELLER APPROVAL & AUTHORIZATION */}
      {activeTab === 'resellers' && (
        <div className="space-y-5">
          {/* Pending Requests */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Solicitações Pendentes ({pendingResellers.length})
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Revendedores só conseguem exibir os produtos da sua fábrica na vitrine depois que você clicar em &ldquo;Aceitar Revendedor&rdquo;.
                </p>
              </div>
            </div>

            {pendingResellers.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                Nenhuma solicitação pendente de aprovação no momento.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {pendingResellers.map((conn) => {
                  const busy = respondingConnId === conn.id;
                  return (
                    <div
                      key={conn.id}
                      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            {conn.resellerStorefrontName || conn.resellerName || 'Revendedor ChatFi'}
                          </h3>
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            Pendente
                          </span>
                        </div>
                        {conn.resellerName &&
                          conn.resellerStorefrontName &&
                          conn.resellerName !== conn.resellerStorefrontName && (
                            <p className="text-xs text-slate-600">
                              Responsável: {conn.resellerName}
                            </p>
                          )}
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Solicitou autorização para revender o catálogo da sua fábrica acima do seu preço de fábrica.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleResellerDecision(conn, 'approved')}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {busy ? 'Salvando...' : 'Aceitar Revendedor'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleResellerDecision(conn, 'rejected')}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          <XCircle className="h-4 w-4" />
                          Recusar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Approved Resellers */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900">
              Revendedores Aprovados ({approvedResellers.length})
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Estes revendedores têm permissão ativa para publicar os seus produtos. Você pode revogar o acesso quando desejar.
            </p>

            {approvedResellers.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                Nenhum revendedor aprovado ainda.
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {approvedResellers.map((conn) => {
                  const busy = respondingConnId === conn.id;
                  return (
                    <div
                      key={conn.id}
                      className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/30 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            {conn.resellerStorefrontName || conn.resellerName || 'Revendedor ChatFi'}
                          </h3>
                          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-[#0E7A34]">
                            Aprovado
                          </span>
                          {conn.paused && (
                            <span className="rounded-md bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-800">
                              Pausado pelo revendedor
                            </span>
                          )}
                        </div>
                        {conn.resellerName &&
                          conn.resellerStorefrontName &&
                          conn.resellerName !== conn.resellerStorefrontName && (
                            <p className="text-xs text-slate-600">
                              Responsável: {conn.resellerName}
                            </p>
                          )}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleResellerDecision(conn, 'rejected')}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        {busy ? 'Revogando...' : 'Revogar Revendedor'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Rejected / Revoked Resellers */}
          {rejectedResellers.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">
                Recusados / Revogados ({rejectedResellers.length})
              </h2>
              <div className="mt-3 space-y-2.5">
                {rejectedResellers.map((conn) => {
                  const busy = respondingConnId === conn.id;
                  return (
                    <div
                      key={conn.id}
                      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-800">
                            {conn.resellerStorefrontName || conn.resellerName || 'Revendedor ChatFi'}
                          </h3>
                          <span className="rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                            Recusado
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleResellerDecision(conn, 'approved')}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-[#0E7A34] px-3 text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {busy ? 'Aprovando...' : 'Aprovar agora'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
