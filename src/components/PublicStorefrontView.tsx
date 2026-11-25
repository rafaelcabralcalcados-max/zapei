import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Minus,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CartItem,
  CommercialMode,
  FactoryConnection,
  MinimumDeliveryPolicy,
  MixedOrder,
  OrderSplitBreakdown,
  Product,
  ProductCategory,
  SplitPaymentMethod,
  SubOrder,
  SubscriptionStatus,
} from '../types/zapei';
import {
  formatAsaasStatusLabel,
  type AsaasOrderStatusResult,
  type CreateAsaasChargeResult,
} from '../lib/asaasService';
import {
  computeAnchoredOriginalPrice,
  computeResellerPrice,
  formatBRL,
  getTotalPairsFromGrade,
} from '../lib/gradeParser';
import {
  calculateOrderSplit,
  getAsaasCreditCardRates,
  roundBRL,
} from '../lib/splitCalculator';
import {
  AsaasChargeModal,
  toAsaasChargeModalData,
  type AsaasChargeModalData,
} from './AsaasChargeModal';
import { GradeVisualGrid } from './GradeVisualGrid';

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
  }) => Promise<CreateAsaasChargeResult | null>;
  onGenerateOrderCharge?: (
    order: MixedOrder,
    paymentMethod: SplitPaymentMethod,
    installments: number
  ) => Promise<CreateAsaasChargeResult>;
  onSyncOrderStatus?: (order: MixedOrder) => Promise<AsaasOrderStatusResult | null>;
}

const CATEGORIES: Array<'Todos' | ProductCategory> = [
  'Todos',
  'Calçados',
  'Bolsas',
  'Sapatos',
  'Joias',
  'Acessórios',
];

export const PublicStorefrontView: React.FC<PublicStorefrontViewProps> = ({
  myUid,
  owner,
  products,
  connections,
  orders,
  initialSubView = 'catalog',
  onClose,
  onCheckoutMixedOrder,
  onGenerateOrderCharge,
  onSyncOrderStatus,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'Todos' | ProductCategory>('Todos');
  const [activeSubView, setActiveSubView] = useState<'catalog' | 'cart' | 'orders'>(
    initialSubView
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<SplitPaymentMethod>('pix');
  const [installments, setInstallments] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [orderNotice, setOrderNotice] = useState('');
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
  const [activeModalCharge, setActiveModalCharge] =
    useState<AsaasChargeModalData | null>(null);
  const [selectedProductListing, setSelectedProductListing] =
    useState<CatalogListing | null>(null);

  const anchorDiscountPct = Math.min(
    80,
    Math.max(0, Math.round(owner.anchorDiscountPercent ?? 0))
  );

  useEffect(() => {
    setActiveSubView(initialSubView);
    setSelectedProductListing(null);
  }, [owner.uid, initialSubView]);

  const isStorefrontAvailable =
    owner.hasStorefront && owner.subscriptionStatus !== 'expired';

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

    // Reseller mode: pull from non-paused connected factories
    const activeConns = connections.filter(
      (c) => c.resellerId === owner.uid && !c.paused
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
        result.push({
          product: p,
          publicPrice: computeResellerPrice(p.factoryPrice, conn.margins[p.category]),
          factoryPrice: p.factoryPrice,
          lotGroupKey: conn.factoryId,
          lotLabel,
          deliveryPolicy: conn.deliveryPolicy,
        });
      }
    });

    return result;
  }, [isStorefrontAvailable, owner, products, connections]);

  const filteredListings = useMemo(() => {
    if (selectedCategory === 'Todos') return listings;
    return listings.filter((l) => l.product.category === selectedCategory);
  }, [listings, selectedCategory]);

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
      if (grp.deliveryPolicy.type === 'boxes') {
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
      {/* Storefront Header */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-3.5 pb-3 pt-safe sm:px-4 shadow-sm">
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
              <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">
                {owner.storefrontName || owner.displayName}
              </h1>
              <p className="text-xs text-slate-500">
                Vitrine Comercial ChatFi · Compra gratuita para clientes
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
              {/* Category Tabs */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`min-h-[38px] shrink-0 rounded-xl px-4 text-xs font-semibold transition ${
                      selectedCategory === cat
                        ? 'bg-[#0E7A34] text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {filteredListings.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                  <Package className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    Nenhum produto disponível nesta categoria
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Assim que produtos forem publicados nesta vitrine, eles aparecerão em tempo real com grade visual.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredListings.map((listing) => {
                    const inCart = cart.find(
                      (c) => c.productId === listing.product.id
                    );
                    const originalAnchorPrice = computeAnchoredOriginalPrice(
                      listing.publicPrice,
                      anchorDiscountPct
                    );
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
                            src={listing.product.imageUrl}
                            alt={listing.product.name}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                          <span className="absolute left-3 top-3 rounded-lg bg-[#0D2B3E]/90 px-2.5 py-1 text-[11px] font-semibold text-white">
                            {listing.lotLabel}
                          </span>
                          {originalAnchorPrice && (
                            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg bg-[#0E7A34] px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm">
                              <Tag className="h-3 w-3" />
                              {anchorDiscountPct}% OFF
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
                                <span className="text-[11px] font-semibold text-slate-400">
                                  {listing.product.category}
                                </span>
                                <h3 className="text-sm font-bold text-slate-900">
                                  {listing.product.name}
                                </h3>
                              </button>
                              <div className="shrink-0 text-right">
                                {originalAnchorPrice ? (
                                  <>
                                    <div className="flex items-center justify-end gap-1.5">
                                      <span className="font-mono text-[11px] text-slate-400 line-through tabular-nums">
                                        De {formatBRL(originalAnchorPrice)}
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
                                <span className="block text-[10px] text-slate-400">
                                  por caixa
                                </span>
                              </div>
                            </div>

                            {/* Visual Grade Boxes (NEVER raw commas) */}
                            <GradeVisualGrid gradeRaw={listing.product.gradeRaw} compact />

                            <p className="text-[11px] text-slate-500">
                              Envio ({listing.lotLabel}): {listing.deliveryPolicy.label} ·{' '}
                              {listing.product.stockBoxes} cx em estoque
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
                                {inCart.boxes} cx no carrinho
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
                              Adicionar Caixa ao Pedido
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
                  {groupedCart.map((group) => (
                    <div
                      key={group.lotGroupKey}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            Grupo de Despacho: {group.lotLabel}
                          </h3>
                          <p className="text-xs text-slate-500">
                            Regra de envio: {group.deliveryPolicy.label}
                          </p>
                        </div>
                        <span className="font-mono text-sm font-bold text-[#0E7A34] tabular-nums">
                          {formatBRL(group.buyerSubtotal)}
                        </span>
                      </div>

                      {!group.meetsMinimum && (
                        <div className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F97316]" />
                          <span>
                            Atenção: este grupo ({group.lotLabel}) ainda está abaixo do mínimo para entrega ({group.deliveryPolicy.label}).
                            {group.deliveryPolicy.allowCounterPickup
                              ? ' Você pode adicionar mais itens ou combinar retirada no balcão.'
                              : ' Adicione mais itens para liberar entrega.'}
                          </span>
                        </div>
                      )}

                      <div className="divide-y divide-slate-100">
                        {group.items.map(({ listing, boxes }) => (
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
                                <p className="font-mono text-xs text-slate-500 tabular-nums">
                                  {boxes} cx × {formatBRL(listing.publicPrice)}
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
                        ))}
                      </div>
                    </div>
                  ))}

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
                          {formatBRL(grandTotalBuyer)}
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
                            const rates = getAsaasCreditCardRates(n);
                            const gross = roundBRL(
                              (grandTotalBuyer + rates.fixedFee) / (1 - rates.totalPercentRate)
                            );
                            const perInst = roundBRL(gross / n);
                            return (
                              <option key={n} value={n}>
                                {n === 1
                                  ? `1x à vista de ${formatBRL(gross)}`
                                  : `${n}x de ${formatBRL(perInst)} (total ${formatBRL(gross)})`}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Subtotal dos produtos ({totalCartBoxes} caixas)</span>
                      <span className="font-mono font-semibold text-slate-700 tabular-nums">
                        {formatBRL(grandTotalBuyer)}
                      </span>
                    </div>
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
                      Ao confirmar, seu pedido entra em conferência de estoque e um cartão interativo é enviado na conversa.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCheckout()}
                      disabled={submitting}
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
                      {/split|wallet|fabricante|revendedor/i.test(lastChargeResult.message)
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
                            {isOrderConfirmed ? ' · Pedido Confirmado' : ''}
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
                                {formatBRL(order.buyerFinalTotal)}
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
                                  const rates = getAsaasCreditCardRates(n);
                                  const gross = roundBRL(
                                    (order.buyerFinalTotal + rates.fixedFee) /
                                      (1 - rates.totalPercentRate)
                                  );
                                  const perInst = roundBRL(gross / n);
                                  return (
                                    <option key={n} value={n}>
                                      {n === 1
                                        ? `1x à vista de ${formatBRL(gross)}`
                                        : `${n}x de ${formatBRL(perInst)} (total ${formatBRL(gross)})`}
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
                        </section>
                      )}

                      <div className="space-y-2">
                        {order.subOrders.map((sub) => (
                          <div
                            key={sub.id}
                            className="rounded-xl bg-slate-50 p-3 text-xs space-y-1"
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
                                          : sub.status}
                              </span>
                            </div>
                            {sub.status === 'dispatched' && sub.receiptNote && (
                              <p className="text-[#0E7A34]">
                                Comprovante: {sub.receiptNote}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Product Detail Modal with Anchored "De / Por" Pricing */}
      {selectedProductListing && (() => {
        const detailListing = selectedProductListing;
        const detailInCart = cart.find(
          (c) => c.productId === detailListing.product.id
        );
        const detailOriginalPrice = computeAnchoredOriginalPrice(
          detailListing.publicPrice,
          anchorDiscountPct
        );
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3.5 sm:p-5 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-detail-title"
          >
            <div className="relative flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="relative h-64 shrink-0 bg-slate-100 sm:h-72">
                <img
                  src={detailListing.product.imageUrl}
                  alt={detailListing.product.name}
                  className="h-full w-full object-cover"
                />
                <span className="absolute left-3.5 top-3.5 rounded-lg bg-[#0D2B3E]/90 px-2.5 py-1 text-xs font-semibold text-white">
                  {detailListing.lotLabel}
                </span>
                {detailOriginalPrice && (
                  <span className="absolute left-3.5 bottom-3.5 inline-flex items-center gap-1 rounded-lg bg-[#0E7A34] px-3 py-1 text-xs font-extrabold text-white shadow-sm">
                    <Tag className="h-3.5 w-3.5" />
                    {anchorDiscountPct}% OFF
                  </span>
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

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {detailListing.product.category}
                    </span>
                    <h2
                      id="product-detail-title"
                      className="text-lg font-bold text-slate-900"
                    >
                      {detailListing.product.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Envio ({detailListing.lotLabel}): {detailListing.deliveryPolicy.label} ·{' '}
                      {detailListing.product.stockBoxes} cx em estoque
                    </p>
                  </div>

                  <div className="text-right">
                    {detailOriginalPrice ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono text-xs text-slate-400 line-through tabular-nums">
                            De {formatBRL(detailOriginalPrice)}
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
                    <span className="block text-[11px] text-slate-400">
                      por caixa fechada
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-xs font-bold text-slate-700">
                    Grade da Caixa
                  </span>
                  <GradeVisualGrid gradeRaw={detailListing.product.gradeRaw} />
                </div>

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
                          {detailInCart.boxes} cx no carrinho
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
                      Adicionar Caixa ao Pedido · {formatBRL(detailListing.publicPrice)}
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
    </div>
  );
};
