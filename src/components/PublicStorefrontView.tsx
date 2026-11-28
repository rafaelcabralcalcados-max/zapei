import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  FileCheck2,
  FileWarning,
  Handshake,
  HelpCircle,
  History,
  Images,
  Minus,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  Tag,
  Trash2,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import type {
  BuyerReleaseOption,
  CartItem,
  CommercialMode,
  CommercialReview,
  FactoryConnection,
  MinimumDeliveryPolicy,
  MixedOrder,
  OrderSplitBreakdown,
  Product,
  ResellerReleasePreference,
  SplitPaymentMethod,
  SubOrder,
  SubscriptionStatus,
  TargetCommercialRole,
} from '../types/zapei';
import { BACK_PRIORITY, useSystemBackHandler } from '../lib/backNavigation';
import {
  PRODUCT_CATEGORIES,
  type MainCategoryId,
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
  resolveMarginForProduct,
  resolveProductImages,
  resolveProductPackLabel,
  resolveProductQuantityPerPack,
  resolveProductUnitType,
  searchMatchesCategoryOrProduct,
} from '../lib/categories';
import { CategoryIcon } from '../lib/categoryIcons';
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
  computeAnchoredOriginalPrice,
  computeResellerPrice,
  formatBRL,
  getTotalPairsFromGrade,
} from '../lib/gradeParser';
import { calculateOrderSplit } from '../lib/splitCalculator';
import {
  AsaasChargeModal,
  toAsaasChargeModalData,
  type AsaasChargeModalData,
} from './AsaasChargeModal';
import { GradeVisualGrid } from './GradeVisualGrid';
import type { HelpCenterContext } from './HelpCenterModal';
import {
  DeliveryReportModal,
  StarReviewModal,
  type ReportModalTarget,
  type ReviewModalTarget,
} from './RatingAndReportModal';
import {
  BUYER_RELEASE_OPTIONS,
  formatCarrierDeadlineSummary,
  getBuyerReleaseOptionMeta,
  getResellerReleaseOptionMeta,
  getResellerShareReleaseStatusLabel,
  hasPreferenceDivergence,
} from '../lib/orderAgreement';
import { StarRatingBadge } from './StarRatingBadge';

export interface PublicStorefrontOwner {
  uid: string;
  displayName: string;
  commercialMode: CommercialMode;
  hasStorefront: boolean;
  storefrontName: string;
  factoryName: string;
  anchorDiscountPercent?: number;
  deliveryPolicy: MinimumDeliveryPolicy;
  subscriptionStatus: SubscriptionStatus;
  ratingAverage?: number;
  ratingCount?: number;
  commercialBanned?: boolean;
  resellerReleasePreference?: ResellerReleasePreference;
  resellerReleaseNote?: string;
  defaultCarrierDeadlineDays?: number;
}

interface CatalogListing {
  product: Product;
  publicPrice: number;
  factoryPrice: number;
  lotGroupKey: string;
  lotLabel: string;
  deliveryPolicy: MinimumDeliveryPolicy;
}

interface PublicStorefrontViewProps {
  myUid: string;
  myName: string;
  owner: PublicStorefrontOwner;
  products: Product[];
  connections: FactoryConnection[];
  orders: MixedOrder[];
  writtenReviews?: CommercialReview[];
  initialSubView?: 'catalog' | 'cart' | 'orders';
  onClose: () => void;
  onCheckoutMixedOrder: (params: {
    ownerUid: string;
    storefrontName: string;
    subOrders: SubOrder[];
    buyerSubtotal: number;
    factoryCostTotal: number;
    paymentMethod: SplitPaymentMethod;
    installments: number;
    splitBreakdown: OrderSplitBreakdown;
    resellerReleasePreference?: ResellerReleasePreference;
    resellerReleaseNote?: string;
    buyerReleaseOption: BuyerReleaseOption;
    mutualAwarenessConfirmed: boolean;
  }) => Promise<CreateAsaasChargeResult | null>;
  onUpdateBuyerReleaseOption?: (
    order: MixedOrder,
    option: BuyerReleaseOption
  ) => Promise<void>;
  onReleaseResellerShareOnReceipt?: (order: MixedOrder) => Promise<void>;
  onGenerateOrderCharge?: (
    order: MixedOrder,
    paymentMethod: SplitPaymentMethod,
    installments: number
  ) => Promise<CreateAsaasChargeResult>;
  onSyncOrderStatus?: (order: MixedOrder) => Promise<AsaasOrderStatusResult | null>;
  onCancelOrder?: (
    orderId: string,
    reason: 'buyer_cancelled'
  ) => Promise<CancelOrderResult>;
  onConfirmOrderDelivered?: (order: MixedOrder) => Promise<void>;
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

export const PublicStorefrontView: React.FC<PublicStorefrontViewProps> = ({
  myUid,
  owner,
  products,
  connections,
  orders,
  writtenReviews = [],
  initialSubView = 'catalog',
  onClose,
  onCheckoutMixedOrder,
  onUpdateBuyerReleaseOption,
  onReleaseResellerShareOnReceipt,
  onGenerateOrderCharge,
  onSyncOrderStatus,
  onCancelOrder,
  onConfirmOrderDelivered,
  onSubmitReview,
  onSubmitDeliveryReport,
  onOpenHelp,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'Todas' | MainCategoryId>('Todas');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('Todas');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [activeSubView, setActiveSubView] = useState<'catalog' | 'cart' | 'orders'>(
    initialSubView
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<SplitPaymentMethod>('pix');
  const [installments, setInstallments] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [orderNotice, setOrderNotice] = useState('');
  const [buyerReleaseOption, setBuyerReleaseOption] = useState<BuyerReleaseOption>(() =>
    owner.resellerReleasePreference === 'upon_carrier_receipt'
      ? 'upon_carrier_receipt'
      : 'upon_product_in_hand'
  );
  const [mutualAwarenessChecked, setMutualAwarenessChecked] = useState(true);
  const [releasingShareOrderId, setReleasingShareOrderId] = useState<string | null>(null);
  const [updatingOptionOrderId, setUpdatingOptionOrderId] = useState<string | null>(null);
  const [expandedHistoryOrderIds, setExpandedHistoryOrderIds] = useState<Record<string, boolean>>({});
  const [confirmDeliveryOrderId, setConfirmDeliveryOrderId] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewModalTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportModalTarget | null>(null);
  const [lastChargeResult, setLastChargeResult] = useState<CreateAsaasChargeResult | null>(null);
  const [orderPayMethodMap, setOrderPayMethodMap] = useState<
    Record<string, SplitPaymentMethod>
  >({});
  const [orderInstMap, setOrderInstMap] = useState<Record<string, number>>({});
  const [orderChargeLoadingId, setOrderChargeLoadingId] = useState<string | null>(null);
  const [orderSyncLoadingId, setOrderSyncLoadingId] = useState<string | null>(null);
  const [chargeResultsByOrder, setChargeResultsByOrder] = useState<
    Record<string, CreateAsaasChargeResult>
  >({});
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState<string | null>(null);
  const [cancelLoadingOrderId, setCancelLoadingOrderId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const [activeModalCharge, setActiveModalCharge] =
    useState<AsaasChargeModalData | null>(null);
  const [selectedProductListing, setSelectedProductListing] =
    useState<CatalogListing | null>(null);
  const [detailPhotoIdx, setDetailPhotoIdx] = useState(0);
  const detailSwipeStartXRef = useRef<number | null>(null);

  useEffect(() => {
    setDetailPhotoIdx(0);
  }, [selectedProductListing?.product.id]);

  // Android system Back arrow (◀) inside Storefront: close topmost modal/detail, then sub-view, then storefront
  useSystemBackHandler(
    activeSubView !== 'catalog',
    () => setActiveSubView('catalog'),
    BACK_PRIORITY.SCREEN_SUBVIEW,
    activeSubView
  );
  useSystemBackHandler(
    Boolean(confirmDeliveryOrderId),
    () => setConfirmDeliveryOrderId(null),
    BACK_PRIORITY.DRAWER
  );
  useSystemBackHandler(
    Boolean(confirmCancelOrderId),
    () => setConfirmCancelOrderId(null),
    BACK_PRIORITY.DRAWER
  );
  useSystemBackHandler(
    Boolean(selectedProductListing),
    () => setSelectedProductListing(null),
    BACK_PRIORITY.MODAL
  );
  useSystemBackHandler(
    Boolean(activeModalCharge),
    () => setActiveModalCharge(null),
    BACK_PRIORITY.MODAL + 1
  );
  useSystemBackHandler(
    Boolean(reviewTarget),
    () => setReviewTarget(null),
    BACK_PRIORITY.MODAL + 1
  );
  useSystemBackHandler(
    Boolean(reportTarget),
    () => setReportTarget(null),
    BACK_PRIORITY.MODAL + 1
  );

  const anchorDiscountPct = Math.min(
    80,
    Math.max(0, Math.round(owner.anchorDiscountPercent ?? 0))
  );

  useEffect(() => {
    setActiveSubView(initialSubView);
    setSelectedProductListing(null);
    setSelectedCategory('Todas');
    setSelectedSubcategory('Todas');
    setCatalogSearch('');
    setBuyerReleaseOption(
      owner.resellerReleasePreference === 'upon_carrier_receipt'
        ? 'upon_carrier_receipt'
        : 'upon_product_in_hand'
    );
    setMutualAwarenessChecked(true);
  }, [owner.uid, owner.resellerReleasePreference, initialSubView]);

  const isStorefrontAvailable =
    owner.hasStorefront &&
    owner.subscriptionStatus !== 'expired' &&
    !owner.commercialBanned;

  // Compute live listings without EVER exposing factory names or "revendedor" to buyers
  const listings = useMemo<CatalogListing[]>(() => {
    if (!isStorefrontAvailable) return [];

    if (owner.commercialMode === 'manufacturer') {
      return products
        .filter(
          (p) =>
            p.factoryId === owner.uid &&
            !p.isSoldOutToday &&
            p.stockBoxes > 0 &&
            p.moderationStatus === 'approved'
        )
        .map((p) => ({
          product: p,
          publicPrice: p.factoryPrice,
          factoryPrice: p.factoryPrice,
          lotGroupKey: owner.uid,
          lotLabel: 'Lote A',
          deliveryPolicy: owner.deliveryPolicy,
        }));
    }

    // Reseller mode: pull strictly from manufacturer-approved, non-paused connected factories
    const activeConns = connections.filter(
      (c) => c.resellerId === owner.uid && c.approvalStatus === 'approved' && !c.paused
    );
    const result: CatalogListing[] = [];
    const lotLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    activeConns.forEach((conn, idx) => {
      const lotLabel = `Lote ${lotLetters[idx] || idx + 1}`;
      const connProds = products.filter((p) => {
        if (p.factoryId !== conn.factoryId) return false;
        if (p.isSoldOutToday || p.stockBoxes <= 0 || p.moderationStatus !== 'approved') {
          return false;
        }
        if (conn.rejectedProductIds.includes(p.id)) return false;
        if (conn.reviewPhotos && !conn.approvedProductIds.includes(p.id)) return false;
        return true;
      });

      for (const p of connProds) {
        const margin =
          resolveMarginForProduct(conn.margins, p.category) ??
          getCategoryDefinition(p.category).defaultMargin;
        result.push({
          product: p,
          publicPrice: computeResellerPrice(p.factoryPrice, margin),
          factoryPrice: p.factoryPrice,
          lotGroupKey: conn.factoryId,
          lotLabel,
          deliveryPolicy: conn.deliveryPolicy,
        });
      }
    });

    return result;
  }, [isStorefrontAvailable, owner, products, connections]);

  const distinctLotCount = useMemo(
    () => new Set(listings.map((l) => l.lotGroupKey)).size,
    [listings]
  );

  const activeCategoryDef = useMemo(
    () =>
      selectedCategory === 'Todas'
        ? null
        : PRODUCT_CATEGORIES.find((c) => c.id === selectedCategory) ?? null,
    [selectedCategory]
  );

  const filteredListings = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return listings.filter((l) => {
      const mainCat = normalizeProductCategory(l.product.category);
      const subCat = inferProductSubcategory(l.product.category, l.product.subcategory);
      if (selectedCategory !== 'Todas' && mainCat !== selectedCategory) {
        return false;
      }
      if (selectedSubcategory !== 'Todas' && subCat !== selectedSubcategory) {
        return false;
      }
      if (q) {
        const nameMatch = l.product.name.toLowerCase().includes(q);
        const specsMatch = (l.product.specsSummary || '').toLowerCase().includes(q);
        const catMatch = searchMatchesCategoryOrProduct(q, l.product.category, subCat);
        if (!nameMatch && !specsMatch && !catMatch) return false;
      }
      return true;
    });
  }, [listings, selectedCategory, selectedSubcategory, catalogSearch]);

  const addToCart = (listing: CatalogListing) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === listing.product.id);
      if (existing) {
        return prev.map((c) =>
          c.productId === listing.product.id
            ? { ...c, boxes: Math.min(listing.product.stockBoxes, c.boxes + 1) }
            : c
        );
      }
      return [
        ...prev,
        {
          productId: listing.product.id,
          factoryId: listing.lotGroupKey,
          boxes: 1,
        },
      ];
    });
  };

  const updateCartBoxes = (productId: string, delta: number, maxStock: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.productId === productId
            ? { ...c, boxes: Math.min(maxStock, Math.max(0, c.boxes + delta)) }
            : c
        )
        .filter((c) => c.boxes > 0)
    );
  };

  // Group cart items by anonymous dispatch lot
  const groupedCart = useMemo(() => {
    const groups = new Map<
      string,
      {
        lotGroupKey: string;
        lotLabel: string;
        deliveryPolicy: MinimumDeliveryPolicy;
        items: Array<{ listing: CatalogListing; boxes: number }>;
        totalBoxes: number;
        totalPieces: number;
        buyerSubtotal: number;
        factoryCost: number;
        meetsMinimum: boolean;
      }
    >();

    for (const item of cart) {
      const listing = listings.find((l) => l.product.id === item.productId);
      if (!listing) continue;
      let grp = groups.get(listing.lotGroupKey);
      if (!grp) {
        grp = {
          lotGroupKey: listing.lotGroupKey,
          lotLabel: listing.lotLabel,
          deliveryPolicy: listing.deliveryPolicy,
          items: [],
          totalBoxes: 0,
          totalPieces: 0,
          buyerSubtotal: 0,
          factoryCost: 0,
          meetsMinimum: true,
        };
        groups.set(listing.lotGroupKey, grp);
      }
      const pairsPerBox = Math.max(1, getTotalPairsFromGrade(listing.product.gradeRaw));
      grp.items.push({ listing, boxes: item.boxes });
      grp.totalBoxes += item.boxes;
      grp.totalPieces += item.boxes * pairsPerBox;
      grp.buyerSubtotal += listing.publicPrice * item.boxes;
      grp.factoryCost += listing.factoryPrice * item.boxes;
    }

    groups.forEach((grp) => {
      const hasWholesaleItems = grp.items.some(
        ({ listing }) =>
          !isSingleAssetCategory(listing.product.category) &&
          resolveProductQuantityPerPack(listing.product) > 1
      );
      if (!hasWholesaleItems || !hasExplicitWholesalePolicy(grp.deliveryPolicy)) {
        grp.meetsMinimum = true;
      } else if (grp.deliveryPolicy.type === 'boxes') {
        grp.meetsMinimum = grp.totalBoxes >= grp.deliveryPolicy.value;
      } else if (grp.deliveryPolicy.type === 'pieces') {
        grp.meetsMinimum = grp.totalPieces >= grp.deliveryPolicy.value;
      } else {
        grp.meetsMinimum = grp.buyerSubtotal >= grp.deliveryPolicy.value;
      }
    });

    return Array.from(groups.values());
  }, [cart, listings]);

  const totalCartBoxes = cart.reduce((acc, i) => acc + i.boxes, 0);
  const grandTotalBuyer = groupedCart.reduce((acc, g) => acc + g.buyerSubtotal, 0);
  const grandTotalFactory = groupedCart.reduce((acc, g) => acc + g.factoryCost, 0);

  const pixCartBreakdown = useMemo(
    () =>
      calculateOrderSplit({
        orderTotal: grandTotalBuyer,
        factoryCostTotal: grandTotalFactory,
        paymentMethod: 'pix',
        installments: 1,
        isDirectManufacturerSale: owner.commercialMode === 'manufacturer',
      }),
    [grandTotalBuyer, grandTotalFactory, owner.commercialMode]
  );

  const cartBreakdown = useMemo(
    () =>
      calculateOrderSplit({
        orderTotal: grandTotalBuyer,
        factoryCostTotal: grandTotalFactory,
        paymentMethod,
        installments,
        isDirectManufacturerSale: owner.commercialMode === 'manufacturer',
        subOrders: groupedCart.map((g, idx) => ({
          id: `cart_${idx}`,
          subOrderCode: g.lotLabel,
          factoryId: g.lotGroupKey,
          factoryName: g.lotLabel,
          factoryCost: g.factoryCost,
        })),
      }),
    [
      grandTotalBuyer,
      grandTotalFactory,
      paymentMethod,
      installments,
      owner.commercialMode,
      groupedCart,
    ]
  );

  const myBuyerOrders = useMemo(
    () => orders.filter((o) => o.buyerId === myUid && o.resellerId === owner.uid),
    [orders, myUid, owner.uid]
  );

  const handleCheckout = async () => {
    if (groupedCart.length === 0 || submitting) return;
    setSubmitting(true);
    setOrderNotice('');
    try {
      const orderNum = Math.floor(1000 + Math.random() * 9000);
      const orderId = `ord_${Date.now()}_${orderNum}`;
      const lotLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

      const subOrders: SubOrder[] = groupedCart.map((grp, idx) => ({
        id: `sub_${orderId}_${idx}`,
        parentOrderId: orderId,
        subOrderCode: `#${orderNum}-${lotLetters[idx] || idx + 1}`,
        factoryId: grp.lotGroupKey,
        factoryName: grp.items[0]?.listing.product.factoryName || owner.factoryName || 'Fábrica',
        resellerId: owner.uid,
        buyerId: myUid,
        anonymousGroupLabel: grp.lotLabel,
        deliveryPolicyLabel: grp.deliveryPolicy.label,
        items: grp.items.map(({ listing, boxes }) => ({
          id: `li_${listing.product.id}`,
          productId: listing.product.id,
          productName: listing.product.name,
          category: listing.product.category,
          imageUrl: listing.product.imageUrl,
          gradeRaw: listing.product.gradeRaw,
          boxesRequested: boxes,
          unitFactoryPrice: listing.factoryPrice,
          unitBuyerPrice: listing.publicPrice,
          availability: 'pending',
        })),
        status: 'pending_inquiry',
        factoryCost: grp.factoryCost,
        buyerSubtotal: grp.buyerSubtotal,
        logisticsType: 'none',
        logisticsCompany: '',
        logisticsAddress: '',
        receiptAttached: false,
        updatedAt: 'Agora',
      }));

      const chargeResult = await onCheckoutMixedOrder({
        ownerUid: owner.uid,
        storefrontName: owner.storefrontName || owner.displayName,
        subOrders,
        buyerSubtotal: grandTotalBuyer,
        factoryCostTotal: grandTotalFactory,
        paymentMethod,
        installments,
        splitBreakdown: cartBreakdown,
        resellerReleasePreference: owner.resellerReleasePreference,
        resellerReleaseNote: owner.resellerReleaseNote,
        buyerReleaseOption,
        mutualAwarenessConfirmed: mutualAwarenessChecked,
      });

      setLastChargeResult(chargeResult);
      if (chargeResult) {
        setChargeResultsByOrder((prev) => ({ ...prev, [orderId]: chargeResult }));
        setActiveModalCharge(
          toAsaasChargeModalData(
            chargeResult,
            subOrders[0]?.subOrderCode.split('-')[0] || `#${orderNum}`,
            orderId,
            owner.commercialMode === 'manufacturer',
            true
          )
        );
      }
      setCart([]);
      setOrderNotice(
        `Pedido enviado com sucesso! O cartão interativo e o detalhamento de pagamento (${
          paymentMethod === 'credit_card' ? `Cartão ${installments}x` : 'Pix'
        }) foram registrados.`
      );
      setActiveSubView('orders');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex h-[100dvh] w-full max-w-full flex-col overflow-hidden bg-[#F8FAFC]">
      <div className="safe-top-strip w-full shrink-0 md:hidden" aria-hidden="true" />
      {/* Storefront Header */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-3.5 py-3 sm:px-4 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
              aria-label="Fechar vitrine"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">
                  {owner.storefrontName || owner.displayName}
                </h1>
                <StarRatingBadge
                  average={owner.ratingAverage}
                  count={owner.ratingCount}
                  variant="inline"
                />
              </div>
              <p className="text-xs text-slate-500">
                Vitrine Comercial ChatFi · Compra gratuita para clientes
                {owner.commercialMode === 'reseller' && owner.resellerReleasePreference
                  ? ` · ${getResellerReleaseOptionMeta(owner.resellerReleasePreference).shortLabel}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSubView('catalog')}
              className={`min-h-[38px] rounded-xl px-3 text-xs font-semibold transition ${
                activeSubView === 'catalog'
                  ? 'bg-[#0E7A34] text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              Catálogo
            </button>
            <button
              type="button"
              onClick={() => setActiveSubView('orders')}
              className={`min-h-[38px] rounded-xl px-3 text-xs font-semibold transition ${
                activeSubView === 'orders'
                  ? 'bg-[#0E7A34] text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              Pedidos ({myBuyerOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveSubView('cart')}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition ${
                activeSubView === 'cart'
                  ? 'bg-[#F97316] text-white'
                  : 'bg-[#0D2B3E] text-white'
              }`}
            >
              <ShoppingBag className="h-4 w-4" />
              <span className="font-mono tabular-nums">{totalCartBoxes}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-6xl space-y-5">
          {orderNotice && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-[#0E7A34]">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{orderNotice}</span>
            </div>
          )}

          {!isStorefrontAvailable ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
              <Store className="mx-auto h-10 w-10 text-slate-300" />
              <h2 className="mt-3 text-base font-bold text-slate-900">
                Vitrine temporariamente pausada
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Você pode continuar conversando e ligando normalmente para este contato pelo ChatFi.
              </p>
            </div>
          ) : activeSubView === 'catalog' ? (
            <>
              {/* Search & 10-Category Scrollable Filter Bar with Icons */}
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Buscar produto, subcategoria ou característica..."
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                  />
                  {catalogSearch && (
                    <button
                      type="button"
                      onClick={() => setCatalogSearch('')}
                      aria-label="Limpar busca"
                      className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('Todas');
                      setSelectedSubcategory('Todas');
                    }}
                    className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 text-xs font-semibold transition ${
                      selectedCategory === 'Todas'
                        ? 'bg-[#0E7A34] text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <CategoryIcon categoryId="Todas" className="h-3.5 w-3.5" />
                    Todas
                  </button>
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat.id);
                        setSelectedSubcategory('Todas');
                      }}
                      className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 text-xs font-semibold transition ${
                        selectedCategory === cat.id
                          ? 'bg-[#0E7A34] text-white'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <CategoryIcon categoryId={cat.id} className="h-3.5 w-3.5" />
                      {cat.shortLabel}
                    </button>
                  ))}
                </div>

                {/* Dynamic Subcategories for the Selected Category */}
                {activeCategoryDef && (
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    <button
                      type="button"
                      onClick={() => setSelectedSubcategory('Todas')}
                      className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-lg px-3 text-[11px] font-semibold transition ${
                        selectedSubcategory === 'Todas'
                          ? 'bg-[#0D2B3E] text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      Tudo em {activeCategoryDef.shortLabel}
                    </button>
                    {activeCategoryDef.subcategories.map((sub) => (
                      <button
                        key={sub}
                        type="button"
                        onClick={() => setSelectedSubcategory(sub)}
                        className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-lg px-3 text-[11px] font-semibold transition ${
                          selectedSubcategory === sub
                            ? 'bg-[#0D2B3E] text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {sub}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {filteredListings.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                  <Package className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    Nenhum produto disponível neste filtro
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Limpe os filtros ou aguarde novos produtos publicados nesta vitrine.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredListings.map((listing) => {
                    const inCart = cart.find(
                      (c) => c.productId === listing.product.id
                    );
                    const qty = resolveProductQuantityPerPack(listing.product);
                    const unitType = resolveProductUnitType(listing.product);
                    const unitSuffix = formatUnitSuffix(unitType);
                    const unitPublicPrice = computeUnitPriceFromTotal(
                      listing.publicPrice,
                      qty
                    );
                    const unitOriginalPrice = computeAnchoredOriginalPrice(
                      unitPublicPrice,
                      anchorDiscountPct
                    );
                    const packOriginalPrice = computeAnchoredOriginalPrice(
                      listing.publicPrice,
                      anchorDiscountPct
                    );
                    const packLabel = resolveProductPackLabel(listing.product);
                    const packSummary = formatPackSummaryLabel({
                      quantityPerPack: qty,
                      unitType,
                      packLabel,
                    });
                    const mainCat = normalizeProductCategory(listing.product.category);
                    const subCat = inferProductSubcategory(
                      listing.product.category,
                      listing.product.subcategory
                    );
                    const singleAsset = isSingleAssetCategory(listing.product.category);
                    const showLotBadge =
                      owner.commercialMode === 'reseller' &&
                      distinctLotCount > 1 &&
                      !singleAsset;
                    const showWholesalePolicy =
                      !singleAsset &&
                      qty > 1 &&
                      hasExplicitWholesalePolicy(listing.deliveryPolicy);
                    const specEntries = parseSpecsSummaryEntries(listing.product.specsSummary);
                    const showGradeGrid =
                      !singleAsset && hasStructuredGrade(listing.product.gradeRaw);
                    const cardImages = resolveProductImages(listing.product);

                    return (
                      <article
                        key={listing.product.id}
                        className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedProductListing(listing)}
                          className="group relative h-52 w-full overflow-hidden bg-slate-100 text-left"
                        >
                          <img
                            src={cardImages[0] || listing.product.imageUrl}
                            alt={listing.product.name}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                          {showLotBadge && (
                            <span className="absolute left-3 top-3 rounded-lg bg-[#0D2B3E]/90 px-2.5 py-1 text-[11px] font-semibold text-white">
                              {listing.lotLabel}
                            </span>
                          )}
                          {packOriginalPrice && (
                            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg bg-[#0E7A34] px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm">
                              <Tag className="h-3 w-3" />
                              {anchorDiscountPct}% OFF
                            </span>
                          )}
                          {cardImages.length > 1 && (
                            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-lg bg-slate-900/75 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
                              <Images className="h-3 w-3" />
                              {cardImages.length} fotos
                            </span>
                          )}
                          <span className="absolute bottom-2.5 right-2.5 rounded-lg bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700 opacity-0 shadow-xs transition group-hover:opacity-100">
                            Ver detalhes
                          </span>
                        </button>

                        <div className="flex flex-1 flex-col justify-between p-4 space-y-3">
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedProductListing(listing)}
                                className="min-w-0 text-left hover:opacity-80"
                              >
                                <span className="block truncate text-[11px] font-semibold text-slate-400">
                                  {mainCat}
                                  {subCat ? ` · ${subCat}` : ''}
                                </span>
                                <h3 className="text-sm font-bold text-slate-900">
                                  {listing.product.name}
                                </h3>
                              </button>
                              <div className="shrink-0 text-right">
                                {qty > 1 ? (
                                  <>
                                    {unitOriginalPrice ? (
                                      <>
                                        <div className="flex items-center justify-end gap-1.5">
                                          <span className="font-mono text-[11px] text-slate-400 line-through tabular-nums">
                                            De {formatBRL(unitOriginalPrice)}
                                          </span>
                                          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-extrabold text-[#0E7A34]">
                                            {anchorDiscountPct}% OFF
                                          </span>
                                        </div>
                                        <span className="font-mono text-base font-bold text-[#0E7A34] tabular-nums">
                                          Por {formatBRL(unitPublicPrice)}
                                          <span className="text-xs font-semibold"> / {unitSuffix}</span>
                                        </span>
                                      </>
                                    ) : (
                                      <span className="font-mono text-base font-bold text-[#0E7A34] tabular-nums">
                                        {formatBRL(unitPublicPrice)}
                                        <span className="text-xs font-semibold"> / {unitSuffix}</span>
                                      </span>
                                    )}
                                    <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                                      <span>{packSummary}: </span>
                                      {packOriginalPrice ? (
                                        <>
                                          <span className="line-through text-slate-400 mr-1">
                                            {formatBRL(packOriginalPrice)}
                                          </span>
                                          <strong className="text-slate-700">
                                            {formatBRL(listing.publicPrice)}
                                          </strong>
                                        </>
                                      ) : (
                                        <strong className="text-slate-700">
                                          {formatBRL(listing.publicPrice)}
                                        </strong>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    {packOriginalPrice ? (
                                      <>
                                        <div className="flex items-center justify-end gap-1.5">
                                          <span className="font-mono text-[11px] text-slate-400 line-through tabular-nums">
                                            De {formatBRL(packOriginalPrice)}
                                          </span>
                                          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-extrabold text-[#0E7A34]">
                                            {anchorDiscountPct}% OFF
                                          </span>
                                        </div>
                                        <span className="font-mono text-base font-bold text-[#0E7A34] tabular-nums">
                                          Por {formatBRL(listing.publicPrice)}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="font-mono text-base font-bold text-[#0E7A34] tabular-nums">
                                        {formatBRL(listing.publicPrice)}
                                      </span>
                                    )}
                                    {!singleAsset && unitType === 'par' && (
                                      <span className="block text-[10px] text-slate-400">
                                        / par
                                      </span>
                                    )}
                                  </>
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

                            {/* Visual Grade Boxes (only when product has structured sizes/numbers) */}
                            {showGradeGrid && (
                              <GradeVisualGrid
                                gradeRaw={listing.product.gradeRaw}
                                compact
                                title={getGradeDisplayTitle(listing.product.category)}
                                unitLabel={unitType === 'par' ? 'pares' : 'un'}
                              />
                            )}

                            <p className="text-[11px] text-slate-500">
                              {singleAsset
                                ? listing.product.stockBoxes > 1
                                  ? `${listing.product.stockBoxes} disponíveis`
                                  : 'Disponível'
                                : qty === 1
                                  ? `${listing.product.stockBoxes} ${
                                      listing.product.stockBoxes === 1
                                        ? unitType === 'par'
                                          ? 'par disponível'
                                          : 'unidade disponível'
                                        : unitType === 'par'
                                          ? 'pares disponíveis'
                                          : 'unidades disponíveis'
                                    }`
                                  : `${listing.product.stockBoxes} ${packLabel.toLowerCase()}${
                                      listing.product.stockBoxes === 1 ? '' : 's'
                                    } em estoque`}
                              {showWholesalePolicy && ` · ${listing.deliveryPolicy.label}`}
                            </p>
                          </div>

                          {inCart ? (
                            <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  updateCartBoxes(
                                    listing.product.id,
                                    -1,
                                    listing.product.stockBoxes
                                  )
                                }
                                className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm"
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="font-mono text-xs font-bold text-[#0E7A34] tabular-nums">
                                {inCart.boxes}{' '}
                                {qty === 1
                                  ? singleAsset
                                    ? 'no carrinho'
                                    : unitType === 'par'
                                      ? inCart.boxes === 1
                                        ? 'par no carrinho'
                                        : 'pares no carrinho'
                                      : 'unid. no carrinho'
                                  : `${packLabel.toLowerCase()}${inCart.boxes === 1 ? '' : 's'} no carrinho`}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  updateCartBoxes(
                                    listing.product.id,
                                    1,
                                    listing.product.stockBoxes
                                  )
                                }
                                className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0E7A34] text-white shadow-sm"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addToCart(listing)}
                              className="h-11 w-full rounded-xl bg-[#0E7A34] text-xs font-semibold text-white transition hover:bg-[#0B5D27]"
                            >
                              {qty > 1
                                ? `Adicionar ${packLabel} ao Pedido`
                                : 'Adicionar ao Pedido'}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          ) : activeSubView === 'cart' ? (
            <div className="space-y-4">
              {groupedCart.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                  <ShoppingBag className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    Seu carrinho está vazio
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveSubView('catalog')}
                    className="mt-4 rounded-xl bg-[#0E7A34] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#0B5D27]"
                  >
                    Voltar ao catálogo
                  </button>
                </div>
              ) : (
                <>
                  {groupedCart.map((group) => {
                    const showGroupPolicy =
                      group.items.some(
                        ({ listing }) =>
                          !isSingleAssetCategory(listing.product.category) &&
                          resolveProductQuantityPerPack(listing.product) > 1
                      ) && hasExplicitWholesalePolicy(group.deliveryPolicy);
                    return (
                    <div
                      key={group.lotGroupKey}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            {groupedCart.length > 1
                              ? `Grupo de Envio: ${group.lotLabel}`
                              : 'Itens do Pedido'}
                          </h3>
                          {showGroupPolicy && (
                            <p className="text-xs text-slate-500">
                              Regra de envio: {group.deliveryPolicy.label}
                            </p>
                          )}
                        </div>
                        <span className="font-mono text-sm font-bold text-[#0E7A34] tabular-nums">
                          {formatBRL(group.buyerSubtotal)}
                        </span>
                      </div>

                      {showGroupPolicy && !group.meetsMinimum && (
                        <div className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F97316]" />
                          <span>
                            Atenção: este pedido ainda está abaixo do mínimo configurado ({group.deliveryPolicy.label}).
                            {group.deliveryPolicy.allowCounterPickup
                              ? ' Você pode adicionar mais itens ou combinar retirada no local.'
                              : ' Adicione mais itens para liberar envio.'}
                          </span>
                        </div>
                      )}

                      <div className="divide-y divide-slate-100">
                        {group.items.map(({ listing, boxes }) => {
                          const qty = resolveProductQuantityPerPack(listing.product);
                          const unitType = resolveProductUnitType(listing.product);
                          const unitSuffix = formatUnitSuffix(unitType);
                          const unitPublicPrice = computeUnitPriceFromTotal(
                            listing.publicPrice,
                            qty
                          );
                          const packSummary = formatPackSummaryLabel({
                            quantityPerPack: qty,
                            unitType,
                            packLabel: resolveProductPackLabel(listing.product),
                          });
                          return (
                            <div
                              key={listing.product.id}
                              className="flex items-center justify-between gap-3 py-2.5"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <img
                                  src={listing.product.imageUrl}
                                  alt={listing.product.name}
                                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-bold text-slate-900">
                                    {listing.product.name}
                                  </p>
                                  <p className="font-mono text-xs text-slate-600 tabular-nums">
                                    {boxes} × {qty > 1 ? packSummary : '1 unid.'} ·{' '}
                                    <strong className="text-[#0E7A34]">
                                      {formatBRL(listing.publicPrice)}
                                    </strong>
                                    {qty > 1 && (
                                      <span className="text-slate-400">
                                        {' '}
                                        ({formatBRL(unitPublicPrice)} / {unitSuffix})
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  updateCartBoxes(
                                    listing.product.id,
                                    -boxes,
                                    listing.product.stockBoxes
                                  )
                                }
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}

                  {/* Payment Method Selection (Clean Online Store Checkout) */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Forma de Pagamento
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Escolha Pix (sem juros) ou Cartão de Crédito à vista ou parcelado em até 12x.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentMethod('pix');
                          setInstallments(1);
                        }}
                        className={`flex items-center justify-between rounded-xl border p-3.5 text-left transition ${
                          paymentMethod === 'pix'
                            ? 'border-[#0E7A34] bg-emerald-50/70 ring-1 ring-[#0E7A34]'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <QrCode
                            className={`h-5 w-5 ${
                              paymentMethod === 'pix' ? 'text-[#0E7A34]' : 'text-slate-500'
                            }`}
                          />
                          <div>
                            <p className="text-xs font-bold text-slate-900">Pix Instantâneo</p>
                            <p className="text-[11px] text-slate-500">
                              Sem juros · Confirmação rápida
                            </p>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-bold text-[#0E7A34] tabular-nums">
                          {formatBRL(pixCartBreakdown.buyerChargedTotal)}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentMethod('credit_card')}
                        className={`flex items-center justify-between rounded-xl border p-3.5 text-left transition ${
                          paymentMethod === 'credit_card'
                            ? 'border-[#0D2B3E] bg-slate-50 ring-1 ring-[#0D2B3E]'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <CreditCard
                            className={`h-5 w-5 ${
                              paymentMethod === 'credit_card'
                                ? 'text-[#0D2B3E]'
                                : 'text-slate-500'
                            }`}
                          />
                          <div>
                            <p className="text-xs font-bold text-slate-900">
                              Cartão de Crédito
                            </p>
                            <p className="text-[11px] text-slate-500">
                              À vista ou parcelado em até 12x
                            </p>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-bold text-[#0D2B3E] tabular-nums">
                          {installments}x
                        </span>
                      </button>
                    </div>

                    {paymentMethod === 'credit_card' && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                        <label className="block text-xs font-semibold text-slate-700">
                          Parcelamento no Cartão de Crédito
                        </label>
                        <select
                          value={installments}
                          onChange={(e) => setInstallments(Number(e.target.value) || 1)}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs font-semibold text-slate-900"
                        >
                          {Array.from({ length: 12 }, (_, idx) => idx + 1).map((n) => {
                            const instSplit = calculateOrderSplit({
                              orderTotal: grandTotalBuyer,
                              factoryCostTotal: grandTotalFactory,
                              paymentMethod: 'credit_card',
                              installments: n,
                              isDirectManufacturerSale: owner.commercialMode === 'manufacturer',
                            });
                            return (
                              <option key={n} value={n}>
                                {n === 1
                                  ? `1x à vista de ${formatBRL(instSplit.buyerChargedTotal)}`
                                  : `${n}x de ${formatBRL(instSplit.installmentValue)} (total ${formatBRL(instSplit.buyerChargedTotal)})`}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Explicit Payment Release Rules & Mutual Awareness before Confirming */}
                  {(() => {
                    const resellerMeta = getResellerReleaseOptionMeta(
                      owner.resellerReleasePreference
                    );
                    const buyerMeta = getBuyerReleaseOptionMeta(buyerReleaseOption);
                    const divergence = hasPreferenceDivergence(
                      owner.resellerReleasePreference,
                      buyerReleaseOption
                    );

                    return (
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                              <Handshake className="h-4 w-4 text-[#0E7A34]" />
                              Regras de Liberação do Pagamento &amp; Ciência Mútua
                            </h3>
                            <p className="mt-0.5 text-xs text-slate-500">
                              Veja a condição informada pelo vendedor e escolha como deseja liberar a parcela comercial. Tudo fica registrado no histórico do pedido.
                            </p>
                          </div>
                        </div>

                        {/* Reseller's Declared Condition */}
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
                          <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Condição informada pelo vendedor / vitrine
                          </span>
                          <p className="text-xs font-bold text-slate-900">
                            {resellerMeta.title}
                          </p>
                          <p className="text-[11px] text-slate-600">
                            {resellerMeta.description}
                          </p>
                          {owner.resellerReleaseNote && (
                            <p className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700">
                              <strong>Observação do vendedor:</strong> {owner.resellerReleaseNote}
                            </p>
                          )}
                          {owner.defaultCarrierDeadlineDays && (
                            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0D2B3E]">
                              <CalendarClock className="h-3.5 w-3.5" />
                              Prazo estimado padrão da transportadora: {owner.defaultCarrierDeadlineDays} dia(s) (com possibilidade de prorrogação de +5 dias em imprevistos).
                            </p>
                          )}
                        </div>

                        {/* Optional Buyer Choice */}
                        <div className="space-y-2">
                          <span className="block text-xs font-bold text-slate-800">
                            Como você (Cliente) deseja liberar a parcela do pagamento? (Opcional)
                          </span>
                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            {BUYER_RELEASE_OPTIONS.map((opt) => {
                              const selected = buyerReleaseOption === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => setBuyerReleaseOption(opt.id)}
                                  className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition ${
                                    selected
                                      ? 'border-[#0E7A34] bg-emerald-50/70 ring-1 ring-[#0E7A34]'
                                      : 'border-slate-200 bg-white hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="space-y-1">
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="text-xs font-bold text-slate-900">
                                        {opt.title}
                                      </span>
                                      <span
                                        className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center ${
                                          selected
                                            ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                                            : 'border-slate-300 bg-white'
                                        }`}
                                      >
                                        {selected && (
                                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                        )}
                                      </span>
                                    </div>
                                    <p className="text-[11px] leading-relaxed text-slate-600">
                                      {opt.description}
                                    </p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Mutual Awareness Summary Before Order Confirmation */}
                        <div
                          className={`rounded-xl border p-3.5 space-y-2 ${
                            divergence
                              ? 'border-amber-200 bg-amber-50/70'
                              : 'border-emerald-200 bg-emerald-50/50'
                          }`}
                        >
                          <p className="text-xs font-bold text-slate-900">
                            Resumo de Ciência Mútua (antes da confirmação)
                          </p>
                          <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                            <div className="rounded-lg bg-white/90 p-2.5 border border-slate-200/80">
                              <span className="block font-semibold text-slate-500">
                                Condição do vendedor:
                              </span>
                              <span className="font-bold text-slate-900">
                                {resellerMeta.shortLabel}
                              </span>
                            </div>
                            <div className="rounded-lg bg-white/90 p-2.5 border border-slate-200/80">
                              <span className="block font-semibold text-slate-500">
                                Sua escolha (Cliente):
                              </span>
                              <span className="font-bold text-[#0E7A34]">
                                {buyerMeta.shortLabel}
                              </span>
                            </div>
                          </div>
                          {divergence && (
                            <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-100/60 px-2.5 py-2 text-[11px] text-amber-950">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                              <span>
                                <strong>Atenção à combinação:</strong> o vendedor informou preferência por &ldquo;{resellerMeta.shortLabel}&rdquo;, e sua opção está definida como &ldquo;{buyerMeta.shortLabel}&rdquo;. Ambas as posições ficarão registradas no histórico do pedido para ciência mútua.
                              </span>
                            </div>
                          )}
                          <label className="flex cursor-pointer items-start gap-2 pt-1 text-xs text-slate-800">
                            <input
                              type="checkbox"
                              checked={mutualAwarenessChecked}
                              onChange={(e) => setMutualAwarenessChecked(e.target.checked)}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#0E7A34]"
                            />
                            <span>
                              Estou ciente das condições de liberação e envio exibidas acima e concordo em registrá-las no histórico deste pedido.
                            </span>
                          </label>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>
                        Subtotal dos produtos ({totalCartBoxes}{' '}
                        {totalCartBoxes === 1 ? 'item' : 'itens'})
                      </span>
                      <span className="font-mono font-semibold text-slate-700 tabular-nums">
                        {formatBRL(grandTotalBuyer)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>
                        Taxa da plataforma ChatFi (
                        {cartBreakdown.minimumRuleApplied
                          ? paymentMethod === 'pix'
                            ? 'mínima Pix'
                            : 'mínima'
                          : '8,5%'}
                        )
                      </span>
                      <span className="font-mono font-semibold text-slate-700 tabular-nums">
                        +{formatBRL(cartBreakdown.platformGrossFee)}
                      </span>
                    </div>
                    {paymentMethod === 'credit_card' && cartBreakdown.cardFeePassedToBuyer > 0 && (
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Taxas e parcelamento do cartão</span>
                        <span className="font-mono font-semibold text-[#F97316] tabular-nums">
                          +{formatBRL(cartBreakdown.cardFeePassedToBuyer)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="text-sm font-bold text-slate-900">
                        Total Final a Pagar
                      </span>
                      <div className="text-right">
                        <span className="font-mono text-xl font-bold text-[#0E7A34] tabular-nums">
                          {formatBRL(cartBreakdown.buyerChargedTotal)}
                        </span>
                        {paymentMethod === 'credit_card' && installments > 1 && (
                          <span className="block font-mono text-[11px] text-slate-500 tabular-nums">
                            em {installments}x de {formatBRL(cartBreakdown.installmentValue)}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">
                      Ao confirmar, seu pedido entra em conferência de estoque e um cartão interativo com as regras combinadas é enviado na conversa.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCheckout()}
                      disabled={submitting || !mutualAwarenessChecked}
                      className="mt-2 h-12 w-full rounded-xl bg-[#0E7A34] text-sm font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
                    >
                      {submitting
                        ? 'Finalizando pedido...'
                        : `Finalizar Pedido · ${formatBRL(cartBreakdown.buyerChargedTotal)}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Buyer Orders View (anonymous lots only) */
            <div className="space-y-4">
              {lastChargeResult && (
                <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        {lastChargeResult.mode === 'live'
                          ? 'Pagamento Emitido com Sucesso'
                          : 'Pagamento do Pedido Preparado'}
                      </h3>
                      <p className="font-mono text-[11px] text-slate-500">
                        Cobrança: {lastChargeResult.chargeId} · Status:{' '}
                        {formatAsaasStatusLabel(lastChargeResult.status).label}
                      </p>
                    </div>
                    <span className="font-mono text-base font-bold text-[#0E7A34] tabular-nums">
                      {formatBRL(lastChargeResult.splitBreakdown.buyerChargedTotal)}
                    </span>
                  </div>

                  {lastChargeResult.message && (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700">
                      {/split|wallet|fabricante|vendedor|revendedor/i.test(lastChargeResult.message)
                        ? 'Utilize o QR Code Pix ou abra a fatura abaixo para concluir o pagamento do seu pedido.'
                        : lastChargeResult.message}
                    </p>
                  )}

                  {lastChargeResult.pixQrCode && (
                    <div className="flex justify-center rounded-xl border border-slate-100 bg-white p-3">
                      <img
                        src={lastChargeResult.pixQrCode}
                        alt="QR Code Pix Asaas"
                        className="h-44 w-44 object-contain"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {lastChargeResult.pixCopyPaste && (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard
                            ?.writeText(lastChargeResult.pixCopyPaste || '')
                            .then(() => setOrderNotice('Código Pix copiado!'));
                        }}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0E7A34] px-4 text-xs font-semibold text-white hover:bg-[#0B5D27]"
                      >
                        <Copy className="h-4 w-4" />
                        Copiar Código Pix
                      </button>
                    )}
                    {lastChargeResult.invoiceUrl && (
                      <a
                        href={lastChargeResult.invoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0D2B3E] px-4 text-xs font-semibold text-white hover:bg-[#143d57]"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Abrir Fatura / Pagar com Cartão
                      </a>
                    )}
                  </div>
                </div>
              )}

              {myBuyerOrders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-xs text-slate-500">
                  Você ainda não fez pedidos nesta vitrine.
                </div>
              ) : (
                myBuyerOrders.map((order) => {
                  const selectedMethod =
                    orderPayMethodMap[order.id] ?? order.paymentMethod ?? 'pix';
                  const selectedInst =
                    orderInstMap[order.id] ?? order.installments ?? 1;
                  const isDirectMfg = owner.commercialMode === 'manufacturer';
                  const orderPixBreakdown = calculateOrderSplit({
                    orderTotal: order.buyerFinalTotal,
                    factoryCostTotal: order.factoryCostTotal,
                    paymentMethod: 'pix',
                    installments: 1,
                    isDirectManufacturerSale: isDirectMfg,
                  });
                  const orderBreakdown = calculateOrderSplit({
                    orderTotal: order.buyerFinalTotal,
                    factoryCostTotal: order.factoryCostTotal,
                    paymentMethod: selectedMethod,
                    installments: selectedInst,
                    isDirectManufacturerSale: isDirectMfg,
                  });
                  const cachedCharge = chargeResultsByOrder[order.id];
                  const activeChargeId = cachedCharge?.chargeId || order.asaasChargeId;
                  const activeChargeStatus =
                    cachedCharge?.status || order.asaasChargeStatus;
                  const activeInvoiceUrl =
                    cachedCharge?.invoiceUrl || order.asaasInvoiceUrl;
                  const activePixPayload =
                    cachedCharge?.pixCopyPaste || order.asaasPixPayload;
                  const activePixQrCode = cachedCharge?.pixQrCode;
                  const statusInfo = formatAsaasStatusLabel(activeChargeStatus);
                  const isOrderConfirmed = order.subOrders.some((s) =>
                    ['confirmed', 'partial_confirmed', 'logistics_sent', 'dispatched'].includes(
                      s.status
                    )
                  );
                  const canPayOrder =
                    order.status !== 'cancelled' && order.status !== 'completed';
                  const canBuyerCancel =
                    Boolean(onCancelOrder) && canCancelUnpaidOrder(order);
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
                            <h3 className="text-sm font-bold text-slate-900">
                              Pedido {order.orderCode}
                            </h3>
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
                          <p className="mt-0.5 text-xs text-slate-500">
                            Realizado em {order.createdAt} ·{' '}
                            {selectedMethod === 'credit_card'
                              ? `Cartão ${selectedInst}x`
                              : 'Pix à vista'}
                            {order.status === 'completed'
                              ? ' · Entrega confirmada'
                              : isOrderConfirmed
                                ? ' · Pedido Confirmado'
                                : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="font-mono text-base font-bold text-[#0E7A34] tabular-nums">
                            {formatBRL(orderBreakdown.buyerChargedTotal)}
                          </span>
                          {selectedMethod === 'credit_card' && selectedInst > 1 && (
                            <span className="block font-mono text-[11px] text-slate-500 tabular-nums">
                              {selectedInst}x de {formatBRL(orderBreakdown.installmentValue)}
                            </span>
                          )}
                        </div>
                      </div>

                      {order.discountAmount > 0 && (
                        <p className="text-xs font-semibold text-[#0E7A34]">
                          Desconto aplicado: -{formatBRL(order.discountAmount)}
                        </p>
                      )}

                      {order.status === 'cancelled' && (
                        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                          <div>
                            <p className="font-bold">
                              {order.cancelReason === 'expired_2h'
                                ? 'Reserva expirada (2h) — Compra cancelada e estoque liberado'
                                : 'Compra cancelada · Estoque liberado'}
                            </p>
                            <p className="mt-0.5 text-[11px] text-red-700">
                              A cobrança pendente foi cancelada e os itens retornaram ao catálogo disponível.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Checkout e Pagamento no Pedido (Comprador) */}
                      {canPayOrder && (
                        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                              <div>
                                <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                                  Pagamento Seguro (Pix ou Cartão)
                                </h4>
                                <p className="text-[11px] text-slate-600">
                                  {isOrderConfirmed
                                    ? 'Pedido confirmado — escolha a forma de pagamento e gere sua cobrança.'
                                    : 'Selecione Pix à vista ou Cartão em até 12x e gere sua cobrança Asaas.'}
                                </p>
                              </div>
                            </div>
                            <span className="font-mono text-sm font-extrabold text-[#0E7A34] tabular-nums">
                              {formatBRL(orderBreakdown.buyerChargedTotal)}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => {
                                setOrderPayMethodMap((p) => ({ ...p, [order.id]: 'pix' }));
                                setOrderInstMap((p) => ({ ...p, [order.id]: 1 }));
                              }}
                              className={`flex min-h-[44px] items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                                selectedMethod === 'pix'
                                  ? 'border-[#0E7A34] bg-white ring-1 ring-[#0E7A34]'
                                  : 'border-slate-200 bg-white/80 hover:bg-white'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <QrCode
                                  className={`h-4 w-4 ${
                                    selectedMethod === 'pix' ? 'text-[#0E7A34]' : 'text-slate-500'
                                  }`}
                                />
                                <div>
                                  <span className="block text-xs font-bold text-slate-900">
                                    Pix à vista
                                  </span>
                                  <span className="block text-[10px] text-slate-500">
                                    Sem juros · QR Code imediato
                                  </span>
                                </div>
                              </div>
                              <span className="font-mono text-xs font-bold text-[#0E7A34] tabular-nums">
                                {formatBRL(orderPixBreakdown.buyerChargedTotal)}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setOrderPayMethodMap((p) => ({ ...p, [order.id]: 'credit_card' }))
                              }
                              className={`flex min-h-[44px] items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                                selectedMethod === 'credit_card'
                                  ? 'border-[#0D2B3E] bg-white ring-1 ring-[#0D2B3E]'
                                  : 'border-slate-200 bg-white/80 hover:bg-white'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <CreditCard
                                  className={`h-4 w-4 ${
                                    selectedMethod === 'credit_card'
                                      ? 'text-[#0D2B3E]'
                                      : 'text-slate-500'
                                  }`}
                                />
                                <div>
                                  <span className="block text-xs font-bold text-slate-900">
                                    Cartão em até 12x
                                  </span>
                                  <span className="block text-[10px] text-slate-500">
                                    Parcelamento em até 12x
                                  </span>
                                </div>
                              </div>
                              <span className="font-mono text-xs font-bold text-[#0D2B3E] tabular-nums">
                                {selectedInst}x
                              </span>
                            </button>
                          </div>

                          {selectedMethod === 'credit_card' && (
                            <div className="space-y-1.5">
                              <label className="block text-[11px] font-semibold text-slate-700">
                                Escolha as parcelas (1x a 12x):
                              </label>
                              <select
                                value={selectedInst}
                                onChange={(e) =>
                                  setOrderInstMap((p) => ({
                                    ...p,
                                    [order.id]: Number(e.target.value) || 1,
                                  }))
                                }
                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs font-semibold text-slate-900"
                              >
                                {Array.from({ length: 12 }, (_, idx) => idx + 1).map((n) => {
                                  const instSplit = calculateOrderSplit({
                                    orderTotal: order.buyerFinalTotal,
                                    factoryCostTotal: order.factoryCostTotal,
                                    paymentMethod: 'credit_card',
                                    installments: n,
                                    isDirectManufacturerSale: isDirectMfg,
                                  });
                                  return (
                                    <option key={n} value={n}>
                                      {n === 1
                                        ? `1x à vista de ${formatBRL(instSplit.buyerChargedTotal)}`
                                        : `${n}x de ${formatBRL(instSplit.installmentValue)} (total ${formatBRL(instSplit.buyerChargedTotal)})`}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {onGenerateOrderCharge && (
                              <button
                                type="button"
                                disabled={orderChargeLoadingId === order.id}
                                onClick={async () => {
                                  setOrderChargeLoadingId(order.id);
                                  setOrderNotice('');
                                  try {
                                    const res = await onGenerateOrderCharge(
                                      order,
                                      selectedMethod,
                                      selectedInst
                                    );
                                    setChargeResultsByOrder((p) => ({ ...p, [order.id]: res }));
                                    setLastChargeResult(res);
                                    setActiveModalCharge(
                                      toAsaasChargeModalData(
                                        res,
                                        order.orderCode,
                                        order.id,
                                        isDirectMfg,
                                        true
                                      )
                                    );
                                  } catch (err) {
                                    setOrderNotice(
                                      err instanceof Error
                                        ? err.message
                                        : 'Não foi possível gerar a cobrança.'
                                    );
                                  } finally {
                                    setOrderChargeLoadingId(null);
                                  }
                                }}
                                className="inline-flex h-11 flex-1 min-w-[190px] items-center justify-center gap-2 rounded-xl bg-[#0E7A34] px-4 text-xs font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
                              >
                                {selectedMethod === 'pix' ? (
                                  <QrCode className="h-4 w-4" />
                                ) : (
                                  <CreditCard className="h-4 w-4" />
                                )}
                                {orderChargeLoadingId === order.id
                                  ? 'Gerando Cobrança Asaas...'
                                  : 'Gerar Cobrança Asaas'}
                              </button>
                            )}

                            {activeChargeId && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (cachedCharge) {
                                    setActiveModalCharge(
                                      toAsaasChargeModalData(
                                        cachedCharge,
                                        order.orderCode,
                                        order.id,
                                        isDirectMfg,
                                        true
                                      )
                                    );
                                  } else {
                                    setActiveModalCharge({
                                      orderId: order.id,
                                      orderCode: order.orderCode,
                                      mode: activeInvoiceUrl ? 'live' : 'preview',
                                      chargeId: activeChargeId,
                                      asaasStatus: activeChargeStatus,
                                      invoiceUrl: activeInvoiceUrl,
                                      pixQrCode: activePixQrCode,
                                      pixCopyPaste: activePixPayload,
                                      splitBreakdown: orderBreakdown,
                                      hideResellerShare: isDirectMfg,
                                      hideSplitExtract: true,
                                    });
                                  }
                                }}
                                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#0D2B3E] px-4 text-xs font-semibold text-white hover:bg-[#143d57]"
                              >
                                <QrCode className="h-4 w-4" />
                                QR Code Pix / Fatura
                              </button>
                            )}

                            {onSyncOrderStatus && activeChargeId && (
                              <button
                                type="button"
                                disabled={orderSyncLoadingId === order.id}
                                onClick={async () => {
                                  setOrderSyncLoadingId(order.id);
                                  try {
                                    const res = await onSyncOrderStatus(order);
                                    if (res?.found) {
                                      const fmt = formatAsaasStatusLabel(
                                        res.asaasStatus || res.mappedPaymentStatus
                                      );
                                      setOrderNotice(
                                        `Status do pedido ${order.orderCode}: ${fmt.label}`
                                      );
                                    }
                                  } catch (err) {
                                    setOrderNotice(
                                      err instanceof Error
                                        ? err.message
                                        : 'Falha ao verificar status do pagamento.'
                                    );
                                  } finally {
                                    setOrderSyncLoadingId(null);
                                  }
                                }}
                                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                              >
                                <RefreshCw
                                  className={`h-3.5 w-3.5 ${
                                    orderSyncLoadingId === order.id ? 'animate-spin' : ''
                                  }`}
                                />
                                Já paguei / Verificar Status
                              </button>
                            )}
                          </div>

                          {canBuyerCancel && (
                            <div className="mt-2 flex flex-col gap-2 border-t border-emerald-200/70 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                <span>
                                  Reserva de estoque válida por 2h enquanto aguarda pagamento{' '}
                                  <strong className="font-mono text-slate-800">
                                    ({reservationStatus.label})
                                  </strong>
                                </span>
                              </div>

                              {confirmCancelOrderId === order.id ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={cancelLoadingOrderId === order.id}
                                    onClick={async () => {
                                      if (!onCancelOrder) return;
                                      setCancelLoadingOrderId(order.id);
                                      try {
                                        await onCancelOrder(order.id, 'buyer_cancelled');
                                        setConfirmCancelOrderId(null);
                                        setOrderNotice(
                                          `Compra ${order.orderCode} cancelada e estoque liberado.`
                                        );
                                      } catch (err) {
                                        setOrderNotice(
                                          err instanceof Error
                                            ? err.message
                                            : 'Não foi possível cancelar o pedido.'
                                        );
                                      } finally {
                                        setCancelLoadingOrderId(null);
                                      }
                                    }}
                                    className="inline-flex h-9 items-center gap-1 rounded-lg bg-red-600 px-3 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                    {cancelLoadingOrderId === order.id
                                      ? 'Cancelando...'
                                      : 'Confirmar Cancelamento'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={cancelLoadingOrderId === order.id}
                                    onClick={() => setConfirmCancelOrderId(null)}
                                    className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    Manter Compra
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmCancelOrderId(order.id)}
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-[11px] font-semibold text-red-700 transition hover:bg-red-50"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Desistir / Cancelar Compra
                                </button>
                              )}
                            </div>
                          )}
                        </section>
                      )}

                      {/* Mutual Awareness & Payment Release Terms on Order */}
                      {(() => {
                        const resellerMeta = getResellerReleaseOptionMeta(
                          order.resellerReleasePreference
                        );
                        const buyerMeta = getBuyerReleaseOptionMeta(order.buyerReleaseOption);
                        const shareStatusMeta = getResellerShareReleaseStatusLabel(
                          order.resellerShareReleaseStatus
                        );
                        const divergence = hasPreferenceDivergence(
                          order.resellerReleasePreference,
                          order.buyerReleaseOption
                        );
                        const canChangeBuyerOpt =
                          Boolean(onUpdateBuyerReleaseOption) &&
                          order.status !== 'completed' &&
                          order.status !== 'cancelled' &&
                          order.resellerShareReleaseStatus !== 'released_on_receipt' &&
                          order.resellerShareReleaseStatus !== 'released_on_delivery';
                        const hasAnyReceiptOrDispatch = order.subOrders.some(
                          (s) =>
                            Boolean(s.receiptAttached || s.receiptUrl || s.receiptNote) ||
                            s.status === 'dispatched' ||
                            s.status === 'completed'
                        );
                        const canReleaseOnReceipt =
                          Boolean(onReleaseResellerShareOnReceipt) &&
                          order.buyerReleaseOption === 'upon_carrier_receipt' &&
                          hasAnyReceiptOrDispatch &&
                          order.status !== 'cancelled' &&
                          order.status !== 'completed' &&
                          order.resellerShareReleaseStatus !== 'released_on_receipt' &&
                          order.resellerShareReleaseStatus !== 'released_on_delivery';
                        const historyList = order.orderAgreementHistory || [];
                        const historyExpanded = Boolean(expandedHistoryOrderIds[order.id]);

                        return (
                          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2.5 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                                <Handshake className="h-3.5 w-3.5 text-[#0E7A34]" />
                                Acordo de Liberação &amp; Ciência Mútua
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
                                  Condição do vendedor
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
                              <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-1">
                                <span className="block text-[10px] font-semibold uppercase text-slate-400">
                                  Sua escolha (Cliente)
                                </span>
                                <span className="block font-bold text-[#0E7A34]">
                                  {buyerMeta.title}
                                </span>
                                {canChangeBuyerOpt && onUpdateBuyerReleaseOption && (
                                  <div className="flex flex-wrap gap-1 pt-1">
                                    {BUYER_RELEASE_OPTIONS.map((opt) => (
                                      <button
                                        key={opt.id}
                                        type="button"
                                        disabled={updatingOptionOrderId === order.id}
                                        onClick={async () => {
                                          if (order.buyerReleaseOption === opt.id) return;
                                          setUpdatingOptionOrderId(order.id);
                                          try {
                                            await onUpdateBuyerReleaseOption(order, opt.id);
                                            setOrderNotice(
                                              `Regra de liberação atualizada para "${opt.shortLabel}" e registrada no histórico.`
                                            );
                                          } finally {
                                            setUpdatingOptionOrderId(null);
                                          }
                                        }}
                                        className={`rounded-md px-2 py-1 text-[10px] font-semibold transition ${
                                          order.buyerReleaseOption === opt.id
                                            ? 'bg-[#0E7A34] text-white'
                                            : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                        }`}
                                      >
                                        {opt.shortLabel}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {divergence && (
                              <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                                <span>
                                  Divergência registrada para ciência mútua: vendedor ({resellerMeta.shortLabel}) × cliente ({buyerMeta.shortLabel}).
                                </span>
                              </div>
                            )}

                            {canReleaseOnReceipt && onReleaseResellerShareOnReceipt && (
                              <button
                                type="button"
                                disabled={releasingShareOrderId === order.id}
                                onClick={async () => {
                                  setReleasingShareOrderId(order.id);
                                  try {
                                    await onReleaseResellerShareOnReceipt(order);
                                    setOrderNotice(
                                      `Parcela do vendedor liberada mediante conferência do comprovante no pedido ${order.orderCode}.`
                                    );
                                  } finally {
                                    setReleasingShareOrderId(null);
                                  }
                                }}
                                className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] px-3 text-xs font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-60"
                              >
                                <FileCheck2 className="h-4 w-4" />
                                {releasingShareOrderId === order.id
                                  ? 'Registrando liberação...'
                                  : 'Liberar Parcela do Vendedor (Comprovante Conferido)'}
                              </button>
                            )}

                            {historyList.length > 0 && (
                              <div className="border-t border-slate-200/80 pt-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedHistoryOrderIds((p) => ({
                                      ...p,
                                      [order.id]: !p[order.id],
                                    }))
                                  }
                                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0D2B3E] hover:underline"
                                >
                                  <History className="h-3.5 w-3.5" />
                                  {historyExpanded
                                    ? `Ocultar histórico de condições e envios (${historyList.length})`
                                    : `Ver histórico registrado do pedido (${historyList.length})`}
                                </button>
                                {historyExpanded && (
                                  <div className="mt-2 space-y-1.5">
                                    {historyList.map((entry) => (
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
                          </div>
                        );
                      })()}

                      <div className="space-y-2">
                        {order.subOrders.map((sub) => (
                          <div
                            key={sub.id}
                            className="rounded-xl bg-slate-50 p-3 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between font-semibold text-slate-800">
                              <span>{sub.anonymousGroupLabel}</span>
                              <span>
                                {sub.status === 'pending_inquiry'
                                  ? 'Em conferência de estoque'
                                  : sub.status === 'partial_confirmed'
                                    ? 'Confirmado parcialmente'
                                    : sub.status === 'confirmed'
                                      ? 'Estoque confirmado'
                                      : sub.status === 'logistics_sent'
                                        ? 'Preparando despacho'
                                        : sub.status === 'dispatched'
                                          ? 'Despachado'
                                          : sub.status === 'completed'
                                            ? 'Entregue'
                                            : sub.status === 'cancelled'
                                              ? 'Cancelado'
                                              : sub.status}
                              </span>
                            </div>
                            {sub.logisticsType !== 'none' && (
                              <p className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                <Truck className="h-3.5 w-3.5 shrink-0 text-[#0D2B3E]" />
                                <span>
                                  {sub.logisticsType === 'distribuidora'
                                    ? 'Distribuidora'
                                    : 'Transportadora'}
                                  : <strong>{sub.logisticsCompany || 'A definir'}</strong>
                                  {sub.logisticsAddress ? ` · ${sub.logisticsAddress}` : ''}
                                </span>
                              </p>
                            )}
                            {(sub.carrierDeadlineDays || sub.carrierDeadlineAtMs) && (
                              <p className="flex items-center gap-1.5 text-[11px] font-medium text-[#0D2B3E]">
                                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                                <span>
                                  {formatCarrierDeadlineSummary({
                                    deadlineDays: sub.carrierDeadlineDays,
                                    deadlineAtMs: sub.carrierDeadlineAtMs,
                                    extensions: sub.carrierDeadlineExtensions,
                                    nowMs,
                                  })}
                                </span>
                              </p>
                            )}
                            {(sub.status === 'dispatched' || sub.status === 'completed' || sub.receiptAttached) &&
                              sub.receiptNote && (
                                <p className="text-[#0E7A34] font-medium">
                                  Comprovante: {sub.receiptNote}
                                </p>
                              )}
                            {sub.receiptUrl && (
                              <img
                                src={sub.receiptUrl}
                                alt="Comprovante da transportadora"
                                className="mt-1 h-28 rounded-lg border border-emerald-200 object-cover"
                              />
                            )}
                          </div>
                        ))}
                      </div>

                      {(() => {
                        const hasDispatchedSub = order.subOrders.some(
                          (s) => s.status === 'dispatched' || s.status === 'completed'
                        );
                        const canConfirmDelivered =
                          Boolean(onConfirmOrderDelivered) &&
                          order.status !== 'completed' &&
                          order.status !== 'cancelled' &&
                          (order.status === 'dispatched' || hasDispatchedSub);
                        const canReviewOrder =
                          Boolean(onSubmitReview) &&
                          order.status !== 'cancelled' &&
                          (order.status === 'dispatched' ||
                            order.status === 'completed' ||
                            hasDispatchedSub);
                        const canReportOrder =
                          Boolean(onSubmitDeliveryReport) &&
                          order.status !== 'cancelled' &&
                          (order.status === 'confirmed' ||
                            order.status === 'logistics_sent' ||
                            order.status === 'dispatched' ||
                            order.status === 'completed' ||
                            isOrderConfirmed ||
                            order.asaasChargeStatus === 'CONFIRMED' ||
                            order.asaasChargeStatus === 'RECEIVED');

                        const isDirectManufacturerSale =
                          order.factoryIds.length === 1 &&
                          order.factoryIds[0] === order.resellerId &&
                          Math.abs(order.buyerFinalTotal - order.factoryCostTotal) < 0.01;
                        const sellerRole: TargetCommercialRole = isDirectManufacturerSale
                          ? 'manufacturer'
                          : 'reseller';
                        const existingReview = writtenReviews.find(
                          (r) =>
                            r.orderId === order.id &&
                            r.targetUid === order.resellerId &&
                            r.targetRole === sellerRole
                        );

                        if (!canConfirmDelivered && !canReviewOrder && !canReportOrder && !onOpenHelp) {
                          return null;
                        }

                        return (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              {canConfirmDelivered && onConfirmOrderDelivered && (
                                <button
                                  type="button"
                                  disabled={confirmDeliveryOrderId === order.id}
                                  onClick={async () => {
                                    setConfirmDeliveryOrderId(order.id);
                                    try {
                                      await onConfirmOrderDelivered(order);
                                      setOrderNotice(
                                        `Entrega do pedido ${order.orderCode} confirmada. Agora você pode avaliá-lo com estrelas.`
                                      );
                                    } finally {
                                      setConfirmDeliveryOrderId(null);
                                    }
                                  }}
                                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-[#0E7A34] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-60"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {confirmDeliveryOrderId === order.id
                                    ? 'Confirmando...'
                                    : order.buyerReleaseOption === 'upon_product_in_hand' &&
                                        order.resellerShareReleaseStatus !== 'released_on_receipt'
                                      ? 'Confirmar Produto em Mãos e Liberar'
                                      : 'Confirmar Entrega'}
                                </button>
                              )}

                              {canReviewOrder && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReviewTarget({
                                      orderId: order.id,
                                      orderCode: order.orderCode,
                                      subOrderId: order.subOrders[0]?.id,
                                      targetUid: order.resellerId,
                                      targetName: order.storefrontName || owner.storefrontName || owner.displayName,
                                      targetRole: sellerRole,
                                      reviewerRole: 'buyer',
                                      existingReview,
                                    })
                                  }
                                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                                    existingReview
                                      ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100/70'
                                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                                  }`}
                                >
                                  <Star
                                    className={`h-3.5 w-3.5 ${
                                      existingReview
                                        ? 'fill-amber-400 text-amber-500'
                                        : 'text-amber-500'
                                    }`}
                                  />
                                  {existingReview
                                    ? `Sua avaliação: ${existingReview.stars}★`
                                    : 'Avaliar (Estrelas)'}
                                </button>
                              )}

                              {canReportOrder && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReportTarget({
                                      orderId: order.id,
                                      orderCode: order.orderCode,
                                      subOrderId: order.subOrders[0]?.id,
                                      subOrderCode: order.subOrders[0]?.subOrderCode,
                                      reportedUid: order.resellerId,
                                      reportedName: order.storefrontName || owner.storefrontName || owner.displayName,
                                      reportedRole: sellerRole,
                                      reporterRole: 'buyer',
                                    })
                                  }
                                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                                >
                                  <FileWarning className="h-3.5 w-3.5" />
                                  Ocorrência na entrega
                                </button>
                              )}
                            </div>

                            {onOpenHelp && (
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
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Product Detail Modal with Unit/Pair + Proportional Anchored "De / Por" Pricing */}
      {selectedProductListing && (() => {
        const detailListing = selectedProductListing;
        const detailInCart = cart.find(
          (c) => c.productId === detailListing.product.id
        );
        const detailQty = resolveProductQuantityPerPack(detailListing.product);
        const detailUnitType = resolveProductUnitType(detailListing.product);
        const detailUnitSuffix = formatUnitSuffix(detailUnitType);
        const detailUnitPublic = computeUnitPriceFromTotal(
          detailListing.publicPrice,
          detailQty
        );
        const detailUnitOriginal = computeAnchoredOriginalPrice(
          detailUnitPublic,
          anchorDiscountPct
        );
        const detailPackOriginal = computeAnchoredOriginalPrice(
          detailListing.publicPrice,
          anchorDiscountPct
        );
        const detailPackLabel = resolveProductPackLabel(detailListing.product);
        const detailPackSummary = formatPackSummaryLabel({
          quantityPerPack: detailQty,
          unitType: detailUnitType,
          packLabel: detailPackLabel,
        });
        const detailMainCat = normalizeProductCategory(detailListing.product.category);
        const detailSubCat = inferProductSubcategory(
          detailListing.product.category,
          detailListing.product.subcategory
        );
        const detailSingleAsset = isSingleAssetCategory(detailListing.product.category);
        const detailShowLotBadge =
          owner.commercialMode === 'reseller' &&
          distinctLotCount > 1 &&
          !detailSingleAsset;
        const detailShowPolicy =
          !detailSingleAsset &&
          detailQty > 1 &&
          hasExplicitWholesalePolicy(detailListing.deliveryPolicy);
        const detailSpecEntries = parseSpecsSummaryEntries(
          detailListing.product.specsSummary
        );
        const detailShowGradeGrid =
          !detailSingleAsset && hasStructuredGrade(detailListing.product.gradeRaw);
        const detailImages = resolveProductImages(detailListing.product);
        const activePhotoIndex = Math.min(detailPhotoIdx, Math.max(0, detailImages.length - 1));
        const activePhotoUrl = detailImages[activePhotoIndex] || detailListing.product.imageUrl;

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3.5 sm:p-5 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-detail-title"
          >
            <div className="relative flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div
                className="relative h-64 shrink-0 bg-slate-100 sm:h-72 select-none"
                onTouchStart={(e) => {
                  detailSwipeStartXRef.current = e.touches[0]?.clientX ?? null;
                }}
                onTouchEnd={(e) => {
                  const startX = detailSwipeStartXRef.current;
                  detailSwipeStartXRef.current = null;
                  if (startX === null || detailImages.length <= 1) return;
                  const endX = e.changedTouches[0]?.clientX ?? startX;
                  const delta = endX - startX;
                  if (Math.abs(delta) < 35) return;
                  setDetailPhotoIdx((prev) =>
                    delta < 0
                      ? (prev + 1) % detailImages.length
                      : (prev - 1 + detailImages.length) % detailImages.length
                  );
                }}
              >
                <img
                  src={activePhotoUrl}
                  alt={`${detailListing.product.name} — foto ${activePhotoIndex + 1}`}
                  className="h-full w-full object-cover"
                />
                {detailShowLotBadge && (
                  <span className="absolute left-3.5 top-3.5 rounded-lg bg-[#0D2B3E]/90 px-2.5 py-1 text-xs font-semibold text-white">
                    {detailListing.lotLabel}
                  </span>
                )}
                {detailPackOriginal && (
                  <span className="absolute left-3.5 bottom-3.5 inline-flex items-center gap-1 rounded-lg bg-[#0E7A34] px-3 py-1 text-xs font-extrabold text-white shadow-sm">
                    <Tag className="h-3.5 w-3.5" />
                    {anchorDiscountPct}% OFF
                  </span>
                )}
                {detailImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setDetailPhotoIdx(
                          (prev) => (prev - 1 + detailImages.length) % detailImages.length
                        )
                      }
                      aria-label="Foto anterior"
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/65 text-white shadow-sm transition hover:bg-slate-900/85"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDetailPhotoIdx((prev) => (prev + 1) % detailImages.length)
                      }
                      aria-label="Próxima foto"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/65 text-white shadow-sm transition hover:bg-slate-900/85"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                    <span className="absolute bottom-3 right-3 rounded-lg bg-slate-900/75 px-2.5 py-1 font-mono text-[11px] font-bold text-white tabular-nums">
                      {activePhotoIndex + 1} / {detailImages.length}
                    </span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedProductListing(null)}
                  aria-label="Fechar detalhes do produto"
                  className="absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 text-slate-700 shadow-sm hover:bg-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {detailImages.length > 1 && (
                <div className="flex items-center justify-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 shrink-0">
                  {detailImages.map((img, idx) => (
                    <button
                      key={`detail-thumb-${idx}`}
                      type="button"
                      onClick={() => setDetailPhotoIdx(idx)}
                      aria-label={`Ver foto ${idx + 1}`}
                      className={`h-12 w-14 overflow-hidden rounded-lg border-2 transition ${
                        idx === activePhotoIndex
                          ? 'border-[#0E7A34] ring-2 ring-[#0E7A34]/25'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={img}
                        alt={`Miniatura ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {detailMainCat}
                      {detailSubCat ? ` · ${detailSubCat}` : ''}
                    </span>
                    <h2
                      id="product-detail-title"
                      className="text-lg font-bold text-slate-900"
                    >
                      {detailListing.product.name}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {detailSingleAsset
                        ? detailListing.product.stockBoxes > 1
                          ? `${detailListing.product.stockBoxes} disponíveis`
                          : 'Disponível'
                        : detailQty === 1
                          ? `${detailListing.product.stockBoxes} ${
                              detailListing.product.stockBoxes === 1
                                ? detailUnitType === 'par'
                                  ? 'par disponível'
                                  : 'unidade disponível'
                                : detailUnitType === 'par'
                                  ? 'pares disponíveis'
                                  : 'unidades disponíveis'
                            }`
                          : `${detailListing.product.stockBoxes} ${detailPackLabel.toLowerCase()}${
                              detailListing.product.stockBoxes === 1 ? '' : 's'
                            } em estoque`}
                      {detailShowPolicy && ` · ${detailListing.deliveryPolicy.label}`}
                    </p>
                  </div>

                  <div className="text-right">
                    {detailQty > 1 ? (
                      <>
                        {detailUnitOriginal ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="font-mono text-xs text-slate-400 line-through tabular-nums">
                                De {formatBRL(detailUnitOriginal)}
                              </span>
                              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-[#0E7A34]">
                                {anchorDiscountPct}% OFF
                              </span>
                            </div>
                            <span className="block font-mono text-2xl font-extrabold text-[#0E7A34] tabular-nums">
                              Por {formatBRL(detailUnitPublic)}
                              <span className="text-sm font-semibold"> / {detailUnitSuffix}</span>
                            </span>
                          </div>
                        ) : (
                          <span className="block font-mono text-2xl font-extrabold text-[#0E7A34] tabular-nums">
                            {formatBRL(detailUnitPublic)}
                            <span className="text-sm font-semibold"> / {detailUnitSuffix}</span>
                          </span>
                        )}
                        <div className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
                          <span>{detailPackSummary}: </span>
                          {detailPackOriginal ? (
                            <>
                              <span className="line-through text-slate-400 mr-1">
                                {formatBRL(detailPackOriginal)}
                              </span>
                              <strong className="text-slate-800">
                                {formatBRL(detailListing.publicPrice)}
                              </strong>
                            </>
                          ) : (
                            <strong className="text-slate-800">
                              {formatBRL(detailListing.publicPrice)}
                            </strong>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        {detailPackOriginal ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="font-mono text-xs text-slate-400 line-through tabular-nums">
                                De {formatBRL(detailPackOriginal)}
                              </span>
                              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-[#0E7A34]">
                                {anchorDiscountPct}% OFF
                              </span>
                            </div>
                            <span className="block font-mono text-2xl font-extrabold text-[#0E7A34] tabular-nums">
                              Por {formatBRL(detailListing.publicPrice)}
                            </span>
                          </div>
                        ) : (
                          <span className="block font-mono text-2xl font-extrabold text-[#0E7A34] tabular-nums">
                            {formatBRL(detailListing.publicPrice)}
                          </span>
                        )}
                        {!detailSingleAsset && detailUnitType === 'par' && (
                          <span className="block text-[11px] text-slate-400">
                            / par
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {detailSpecEntries.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
                    {detailSpecEntries.map((entry, idx) => (
                      <div key={`${entry.label}-${idx}`} className="min-w-0">
                        {entry.label && (
                          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {entry.label}
                          </span>
                        )}
                        <span className="block truncate text-xs font-semibold text-slate-800">
                          {entry.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {detailShowGradeGrid && (
                  <div className="space-y-1.5">
                    <span className="block text-xs font-bold text-slate-700">
                      {getGradeDisplayTitle(detailListing.product.category)}
                      {detailQty > 1 ? ` (${detailPackSummary})` : ''}
                    </span>
                    <GradeVisualGrid
                      gradeRaw={detailListing.product.gradeRaw}
                      title={getGradeDisplayTitle(detailListing.product.category)}
                      unitLabel={detailUnitType === 'par' ? 'pares' : 'un'}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  {detailInCart ? (
                    <>
                      <div className="flex flex-1 items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateCartBoxes(
                              detailListing.product.id,
                              -1,
                              detailListing.product.stockBoxes
                            )
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="font-mono text-xs font-bold text-[#0E7A34] tabular-nums">
                          {detailInCart.boxes}{' '}
                          {detailQty === 1
                            ? detailSingleAsset
                              ? 'no carrinho'
                              : detailUnitType === 'par'
                                ? detailInCart.boxes === 1
                                  ? 'par no carrinho'
                                  : 'pares no carrinho'
                                : 'unid. no carrinho'
                            : `${detailPackLabel.toLowerCase()}${detailInCart.boxes === 1 ? '' : 's'} no carrinho`}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateCartBoxes(
                              detailListing.product.id,
                              1,
                              detailListing.product.stockBoxes
                            )
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0E7A34] text-white shadow-sm"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProductListing(null);
                          setActiveSubView('cart');
                        }}
                        className="h-12 rounded-xl bg-[#0D2B3E] px-5 text-xs font-semibold text-white hover:bg-[#143d57]"
                      >
                        Ir para o Carrinho
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToCart(detailListing)}
                      className="h-12 w-full rounded-xl bg-[#0E7A34] text-sm font-semibold text-white transition hover:bg-[#0B5D27]"
                    >
                      {detailQty > 1
                        ? `Adicionar ${detailPackLabel} ao Pedido · ${formatBRL(detailListing.publicPrice)}`
                        : `Adicionar ao Pedido · ${formatBRL(detailListing.publicPrice)}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <AsaasChargeModal
        isOpen={Boolean(activeModalCharge)}
        data={activeModalCharge}
        onClose={() => setActiveModalCharge(null)}
        onVerifyStatus={async (orderId) => {
          const order = myBuyerOrders.find((o) => o.id === orderId);
          if (!order || !onSyncOrderStatus) return null;
          return onSyncOrderStatus(order);
        }}
        onCopySuccess={(msg) => setOrderNotice(msg)}
      />

      {reviewTarget && onSubmitReview && (
        <StarReviewModal
          key={`${reviewTarget.orderId}_${reviewTarget.targetUid}_${reviewTarget.targetRole}`}
          target={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onSubmitReview={async (params) => {
            await onSubmitReview(params);
            setOrderNotice(
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
            setOrderNotice(
              `Ocorrência ${res.reportCode} registrada e vinculada ao chamado ${res.ticketCode}.`
            );
            return res;
          }}
        />
      )}
    </div>
  );
};
