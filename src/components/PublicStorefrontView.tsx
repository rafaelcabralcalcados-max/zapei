import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Minus,
  Package,
  Plus,
  QrCode,
  ShoppingBag,
  Store,
  Trash2,
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
import type { CreateAsaasChargeResult } from '../lib/asaasService';
import {
  computeResellerPrice,
  formatBRL,
  getTotalPairsFromGrade,
} from '../lib/gradeParser';
import {
  calculateOrderSplit,
  getAsaasCreditCardRates,
  MINIMUM_FEE_THRESHOLD_BRL,
  roundBRL,
} from '../lib/splitCalculator';
import { GradeVisualGrid } from './GradeVisualGrid';
import { SplitBreakdownCard } from './SplitBreakdownCard';

export interface PublicStorefrontOwner {
  uid: string;
  displayName: string;
  commercialMode: CommercialMode;
  hasStorefront: boolean;
  storefrontName: string;
  factoryName: string;
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
  onClose,
  onCheckoutMixedOrder,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'Todos' | ProductCategory>('Todos');
  const [activeSubView, setActiveSubView] = useState<'catalog' | 'cart' | 'orders'>('catalog');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<SplitPaymentMethod>('pix');
  const [installments, setInstallments] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [orderNotice, setOrderNotice] = useState('');
  const [lastChargeResult, setLastChargeResult] = useState<CreateAsaasChargeResult | null>(null);

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
                    return (
                      <article
                        key={listing.product.id}
                        className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                      >
                        <div className="relative h-52 bg-slate-100">
                          <img
                            src={listing.product.imageUrl}
                            alt={listing.product.name}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute left-3 top-3 rounded-lg bg-[#0D2B3E]/90 px-2.5 py-1 text-[11px] font-semibold text-white">
                            {listing.lotLabel}
                          </span>
                        </div>

                        <div className="flex flex-1 flex-col justify-between p-4 space-y-3">
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="text-[11px] font-semibold text-slate-400">
                                  {listing.product.category}
                                </span>
                                <h3 className="text-sm font-bold text-slate-900">
                                  {listing.product.name}
                                </h3>
                              </div>
                              <div className="text-right">
                                <span className="font-mono text-base font-bold text-[#0E7A34] tabular-nums">
                                  {formatBRL(listing.publicPrice)}
                                </span>
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
                            {listing.publicPrice < MINIMUM_FEE_THRESHOLD_BRL && (
                              <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-900">
                                Pedidos abaixo de {formatBRL(MINIMUM_FEE_THRESHOLD_BRL)} no Pix
                                aplicam a tarifa mínima de plataforma (R$ 6,99 bruto).
                              </p>
                            )}
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

                  {/* Payment Method Selection (Pix vs Credit Card 1x..12x Buyer Pass-Through) */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Forma de Pagamento (Split Asaas)
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Escolha Pix (sem juros) ou Cartão de Crédito à vista / parcelado em até 12x com repasse transparente das taxas do cartão.
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
                              À vista ou 2x a 12x (taxas repassadas)
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
                                  ? `1x à vista de ${formatBRL(gross)} (total ${formatBRL(gross)})`
                                  : `${n}x de ${formatBRL(perInst)} (total ${formatBRL(gross)})`}
                              </option>
                            );
                          })}
                        </select>
                        <p className="text-[11px] text-slate-500">
                          As tarifas de processamento e juros de parcelamento do cartão são repassadas integralmente ao comprador, preservando o repasse líquido do Fabricante, Revendedor e ChatFi.
                        </p>
                      </div>
                    )}

                    <SplitBreakdownCard
                      breakdown={cartBreakdown}
                      title="Resumo do Pedido, Taxas e Divisão Transparente (Split)"
                      factoryLabel="Repasse ao Fabricante (Produção)"
                      resellerLabel={
                        owner.commercialMode === 'manufacturer'
                          ? 'Venda direta da fábrica'
                          : 'Retido / Liberado para o Lojista'
                      }
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Subtotal dos produtos ({totalCartBoxes} caixas)</span>
                      <span className="font-mono font-semibold text-slate-700 tabular-nums">
                        {formatBRL(grandTotalBuyer)}
                      </span>
                    </div>
                    {paymentMethod === 'credit_card' && cartBreakdown.cardFeePassedToBuyer > 0 && (
                      <div className="flex items-center justify-between text-xs text-[#F97316]">
                        <span>Taxas e juros do cartão ({installments}x)</span>
                        <span className="font-mono font-semibold tabular-nums">
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
                      Ao confirmar, seu pedido entra em conferência de estoque, a cobrança Asaas com Split é preparada e um cartão interativo é enviado na conversa.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCheckout()}
                      disabled={submitting}
                      className="mt-2 h-12 w-full rounded-xl bg-[#0E7A34] text-sm font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
                    >
                      {submitting
                        ? 'Enviando pedido e calculando Split...'
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
                          ? 'Cobrança Asaas Emitida com Split'
                          : 'Resumo de Split Asaas Preparado'}
                      </h3>
                      <p className="font-mono text-[11px] text-slate-500">
                        Cobrança: {lastChargeResult.chargeId} · Status: {lastChargeResult.status}
                      </p>
                    </div>
                    <span className="font-mono text-base font-bold text-[#0E7A34] tabular-nums">
                      {formatBRL(lastChargeResult.splitBreakdown.buyerChargedTotal)}
                    </span>
                  </div>

                  {lastChargeResult.message && (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700">
                      {lastChargeResult.message}
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
                            .then(() => setOrderNotice('Código Pix Copia e Cola copiado!'));
                        }}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0E7A34] px-4 text-xs font-semibold text-white hover:bg-[#0B5D27]"
                      >
                        <Copy className="h-4 w-4" />
                        Copiar Pix Copia e Cola
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
                        Abrir Pagamento Asaas
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
                  const orderBreakdown = calculateOrderSplit({
                    orderTotal: order.buyerFinalTotal,
                    factoryCostTotal: order.factoryCostTotal,
                    paymentMethod: order.paymentMethod || 'pix',
                    installments: order.installments || 1,
                    isDirectManufacturerSale: owner.commercialMode === 'manufacturer',
                  });

                  return (
                    <div
                      key={order.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            Pedido {order.orderCode}
                          </h3>
                          <p className="text-xs text-slate-500">
                            Realizado em {order.createdAt} ·{' '}
                            {order.paymentMethod === 'credit_card'
                              ? `Cartão ${order.installments || 1}x`
                              : 'Pix'}
                            {order.asaasChargeStatus ? ` · Asaas: ${order.asaasChargeStatus}` : ''}
                          </p>
                        </div>
                        <span className="font-mono text-base font-bold text-[#0E7A34] tabular-nums">
                          {formatBRL(order.buyerChargedTotal ?? order.buyerFinalTotal)}
                        </span>
                      </div>

                      {order.discountAmount > 0 && (
                        <p className="text-xs font-semibold text-[#0E7A34]">
                          Desconto aplicado: -{formatBRL(order.discountAmount)}
                        </p>
                      )}

                      <SplitBreakdownCard
                        compact
                        breakdown={orderBreakdown}
                        title="Detalhamento do Pagamento & Split"
                        factoryLabel="Repasse ao Fabricante (Produção)"
                        resellerLabel={
                          owner.commercialMode === 'manufacturer'
                            ? 'Venda direta da fábrica'
                            : 'Retido / Liberado para o Lojista'
                        }
                      />

                      {(order.asaasPixPayload || order.asaasInvoiceUrl) && (
                        <div className="flex flex-wrap gap-2">
                          {order.asaasPixPayload && (
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard
                                  ?.writeText(order.asaasPixPayload || '')
                                  .then(() => setOrderNotice('Código Pix copiado!'));
                              }}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-[#0E7A34]"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Copiar Pix
                            </button>
                          )}
                          {order.asaasInvoiceUrl && (
                            <a
                              href={order.asaasInvoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-[#0D2B3E]"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Fatura Asaas
                            </a>
                          )}
                        </div>
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
    </div>
  );
};
