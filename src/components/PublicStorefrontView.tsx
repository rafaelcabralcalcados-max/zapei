import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Minus,
  Package,
  Plus,
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
  Product,
  ProductCategory,
  SubOrder,
  SubscriptionStatus,
} from '../types/zapei';
import {
  computeResellerPrice,
  formatBRL,
  getTotalPairsFromGrade,
} from '../lib/gradeParser';
import { GradeVisualGrid } from './GradeVisualGrid';

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
  }) => Promise<void>;
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
  const [submitting, setSubmitting] = useState(false);
  const [orderNotice, setOrderNotice] = useState('');

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

      await onCheckoutMixedOrder({
        ownerUid: owner.uid,
        storefrontName: owner.storefrontName || owner.displayName,
        subOrders,
        buyerSubtotal: grandTotalBuyer,
        factoryCostTotal: grandTotalFactory,
      });

      setCart([]);
      setOrderNotice(
        `Pedido enviado com sucesso! O cartão interativo foi encaminhado no chat de ${owner.storefrontName || owner.displayName}.`
      );
      setActiveSubView('orders');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#F8FAFC]">
      {/* Storefront Header */}
      <header className="border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
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
                Vitrine Comercial Zapei · Compra gratuita para clientes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSubView('catalog')}
              className={`min-h-[38px] rounded-xl px-3 text-xs font-semibold transition ${
                activeSubView === 'catalog'
                  ? 'bg-[#0F5132] text-white'
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
                  ? 'bg-[#0F5132] text-white'
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
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-[#0F5132]">
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
                Você pode continuar conversando e ligando normalmente para este contato pelo Zapei.
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
                        ? 'bg-[#0F5132] text-white'
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
                                <span className="font-mono text-base font-bold text-[#0F5132] tabular-nums">
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
                              <span className="font-mono text-xs font-bold text-[#0F5132] tabular-nums">
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
                                className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0F5132] text-white shadow-sm"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addToCart(listing)}
                              className="h-11 w-full rounded-xl bg-[#0F5132] text-xs font-semibold text-white transition hover:bg-[#146c43]"
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
                    className="mt-4 rounded-xl bg-[#0F5132] px-4 py-2.5 text-xs font-semibold text-white"
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
                        <span className="font-mono text-sm font-bold text-[#0F5132] tabular-nums">
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

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">
                        Total Estimado do Pedido ({totalCartBoxes} caixas)
                      </span>
                      <span className="font-mono text-xl font-bold text-[#0F5132] tabular-nums">
                        {formatBRL(grandTotalBuyer)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Ao confirmar, seu pedido entra em conferência de estoque e um cartão interativo é enviado automaticamente na conversa.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCheckout()}
                      disabled={submitting}
                      className="mt-4 h-12 w-full rounded-xl bg-[#0F5132] text-sm font-semibold text-white hover:bg-[#146c43] disabled:opacity-50"
                    >
                      {submitting ? 'Enviando pedido...' : 'Enviar Pedido para Conferência'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Buyer Orders View (anonymous lots only) */
            <div className="space-y-4">
              {myBuyerOrders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-xs text-slate-500">
                  Você ainda não fez pedidos nesta vitrine.
                </div>
              ) : (
                myBuyerOrders.map((order) => (
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
                          Realizado em {order.createdAt}
                        </p>
                      </div>
                      <span className="font-mono text-base font-bold text-[#0F5132] tabular-nums">
                        {formatBRL(order.buyerFinalTotal)}
                      </span>
                    </div>

                    {order.discountAmount > 0 && (
                      <p className="text-xs font-semibold text-[#0F5132]">
                        Desconto aplicado: -{formatBRL(order.discountAmount)}
                      </p>
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
                            <p className="text-[#0F5132]">
                              Comprovante: {sub.receiptNote}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
