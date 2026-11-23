import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Factory,
  Minus,
  Package,
  Plus,
  Receipt,
  Settings2,
  Truck,
  Upload,
  XCircle,
} from 'lucide-react';
import type {
  DualPaymentRecord,
  FavoriteGrade,
  MinimumDeliveryPolicy,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductCategory,
  SubOrder,
  UserProfile,
} from '../types/zapei';
import {
  formatBRL,
  getTotalPairsFromGrade,
  parseGradeString,
  runImageModerationFilter,
} from '../lib/gradeParser';
import { compressImageFileToDataUrl } from '../lib/phoneUtils';
import { GradeVisualGrid } from './GradeVisualGrid';

interface ManufacturerPanelProps {
  profile: UserProfile;
  products: Product[];
  subOrders: SubOrder[];
  payments: DualPaymentRecord[];
  onSavePolicy: (factoryName: string, policy: MinimumDeliveryPolicy) => Promise<void>;
  onSaveFavoriteGrade: (grade: FavoriteGrade) => Promise<void>;
  onCreateProduct: (params: {
    name: string;
    sku: string;
    category: ProductCategory;
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
  onOpenBilling: () => void;
}

const CATEGORIES: ProductCategory[] = [
  'Calçados',
  'Bolsas',
  'Sapatos',
  'Joias',
  'Acessórios',
];

type FactoryTab = 'catalog' | 'conference' | 'dispatch' | 'finance' | 'policy';

export const ManufacturerPanel: React.FC<ManufacturerPanelProps> = ({
  profile,
  products,
  subOrders,
  payments,
  onSavePolicy,
  onSaveFavoriteGrade,
  onCreateProduct,
  onUpdateStock,
  onConfirmConference,
  onDispatchSubOrder,
  onUpdatePayment,
  onOpenBilling,
}) => {
  const [activeTab, setActiveTab] = useState<FactoryTab>('catalog');
  const [feedback, setFeedback] = useState('');

  // F01 Policy form state
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
  const [prodCategory, setProdCategory] = useState<ProductCategory>('Calçados');
  const [prodPrice, setProdPrice] = useState('');
  const [prodStock, setProdStock] = useState('10');
  const [prodGradeRaw, setProdGradeRaw] = useState('34:1, 35:2, 36:3, 37:3, 38:2, 39:1');
  const [prodImageUrl, setProdImageUrl] = useState('');
  const [prodImageName, setProdImageName] = useState('');
  const [moderationWarning, setModerationWarning] = useState('');
  const [favLabel, setFavLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const productPhotoInputRef = useRef<HTMLInputElement | null>(null);

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
      mySubOrders.filter(
        (s) => s.status === 'pending_inquiry' || s.status === 'checking_stock'
      ),
    [mySubOrders]
  );

  const dispatchQueue = useMemo(
    () =>
      mySubOrders.filter(
        (s) =>
          s.status === 'confirmed' ||
          s.status === 'partial_confirmed' ||
          s.status === 'logistics_sent' ||
          s.status === 'dispatched'
      ),
    [mySubOrders]
  );

  const myPayments = useMemo(
    () =>
      payments.filter(
        (p) => p.ownerId === profile.uid && p.layer === 'factory_reseller'
      ),
    [payments, profile.uid]
  );

  const totalToReceive = myPayments
    .filter((p) => p.status !== 'Quitado')
    .reduce((acc, p) => acc + p.amount, 0);
  const totalReceived = myPayments
    .filter((p) => p.status === 'Quitado')
    .reduce((acc, p) => acc + p.amount, 0);

  const isPaused = profile.subscriptionStatus === 'expired';

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
      favLabel.trim() || `${prodCategory} (${totalPairs} un)`;
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
    const parsedGrade = parseGradeString(prodGradeRaw);
    if (parsedGrade.length === 0) {
      setModerationWarning('Digite a grade válida separada por vírgulas (ex: 34:1, 35:2, 36:3).');
      return;
    }
    const priceNum = Number.parseFloat(prodPrice.replace(',', '.'));
    const stockNum = Number.parseInt(prodStock, 10);
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      setModerationWarning('Informe um preço de fábrica válido.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreateProduct({
        name: prodName.trim(),
        sku: prodSku.trim() || `REF-${Date.now().toString().slice(-4)}`,
        category: prodCategory,
        factoryPrice: priceNum,
        stockBoxes: Math.max(0, Number.isNaN(stockNum) ? 0 : stockNum),
        gradeRaw: prodGradeRaw.trim(),
        imageUrl: prodImageUrl,
      });
      setProdName('');
      setProdSku('');
      setProdPrice('');
      setProdStock('10');
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 pb-24 md:pb-8 space-y-5">
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
                ? 'border-emerald-200 bg-emerald-50 text-[#0F5132]'
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
                    ? 'bg-[#0F5132] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-[#0F5132]">
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
                className="mt-1.5 flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center transition hover:border-[#0F5132] hover:bg-emerald-50/40"
              >
                {prodImageUrl ? (
                  <div className="w-full space-y-2">
                    <img
                      src={prodImageUrl}
                      alt="Prévia do produto"
                      className="mx-auto h-40 w-full rounded-lg object-cover"
                    />
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5132]">
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
                  Nome do modelo
                </label>
                <input
                  type="text"
                  required
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="Ex: Sandália Couro Tratorada"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#0F5132] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Categoria
                </label>
                <select
                  value={prodCategory}
                  onChange={(e) => setProdCategory(e.target.value as ProductCategory)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-[#0F5132] focus:outline-none"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Referência / SKU
                </label>
                <input
                  type="text"
                  value={prodSku}
                  onChange={(e) => setProdSku(e.target.value)}
                  placeholder="Ex: REF-402"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm focus:border-[#0F5132] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Preço de fábrica (caixa R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={prodPrice}
                  onChange={(e) => setProdPrice(e.target.value)}
                  placeholder="480.00"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm focus:border-[#0F5132] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Estoque inicial (caixas)
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={prodStock}
                  onChange={(e) => setProdStock(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm focus:border-[#0F5132] focus:outline-none"
                />
              </div>
            </div>

            {/* Comma-Separated Grade Input + Favorites + Visual Preview */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Grade por vírgulas (número:quantidade)
              </label>
              <input
                type="text"
                required
                value={prodGradeRaw}
                onChange={(e) => setProdGradeRaw(e.target.value)}
                placeholder="34:1, 35:2, 36:3, 37:3, 38:2, 39:1"
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-xs focus:border-[#0F5132] focus:outline-none"
              />

              {/* Favorite grades chips */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.favoriteGrades.map((fav) => (
                  <button
                    key={fav.id}
                    type="button"
                    onClick={() => setProdGradeRaw(fav.raw)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-[#0F5132] hover:text-[#0F5132]"
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
                  className="h-9 flex-1 rounded-lg border border-slate-200 px-2.5 text-xs focus:border-[#0F5132] focus:outline-none"
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
                <GradeVisualGrid gradeRaw={prodGradeRaw} />
              </div>
            </div>

            {moderationWarning && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{moderationWarning}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-xl bg-[#0F5132] text-sm font-semibold text-white transition hover:bg-[#146c43] disabled:opacity-50"
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
                  Cadastre seu primeiro produto ao lado com foto real e grade por vírgulas. Ele ficará disponível imediatamente na sua vitrine e para revendedores conectados.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {myProducts.map((product) => (
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
                            {product.category} · {product.sku}
                          </span>
                          <h3 className="text-sm font-bold text-slate-900">
                            {product.name}
                          </h3>
                        </div>
                        <span className="font-mono text-sm font-bold text-[#0F5132] tabular-nums">
                          {formatBRL(product.factoryPrice)} / cx
                        </span>
                      </div>

                      <GradeVisualGrid gradeRaw={product.gradeRaw} compact />

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
                          <span className="min-w-[54px] text-center font-mono text-sm font-bold text-slate-900 tabular-nums">
                            {product.stockBoxes} cx
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
                ))}
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
                    <span className="font-mono text-sm font-bold text-[#0F5132] tabular-nums">
                      Custo Fábrica: {formatBRL(sub.factoryCost)}
                    </span>
                  </div>

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
                                {item.boxesRequested} cx × {formatBRL(item.unitFactoryPrice)} ={' '}
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
                                  ? 'bg-[#0F5132] text-white'
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
                    className="h-11 w-full rounded-xl bg-[#0F5132] text-xs font-semibold text-white hover:bg-[#146c43]"
                  >
                    Confirmar Conferência e Baixar Estoque
                  </button>
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
            dispatchQueue.map((sub) => (
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
                  <span className="font-mono text-sm font-bold text-[#0F5132] tabular-nums">
                    {formatBRL(sub.factoryCost)}
                  </span>
                </div>

                {sub.logisticsAddress && (
                  <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                    <strong>Endereço / Ponto de Entrega:</strong> {sub.logisticsAddress}
                  </div>
                )}

                {sub.status === 'dispatched' ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-[#0F5132] space-y-2">
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
                        className="h-10 rounded-xl border border-slate-200 px-3 text-xs focus:border-[#0F5132] focus:outline-none"
                      />

                      <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:border-[#0F5132]">
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
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 4: LAYER 1 FINANCE (F06) */}
      {activeTab === 'finance' && (
        <div className="space-y-4">
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
              <p className="mt-1 font-mono text-2xl font-bold text-[#0F5132] tabular-nums">
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
              {myPayments.map((pay) => (
                <div
                  key={pay.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {pay.subOrderCode || pay.orderCode} · {pay.counterpartyName}
                    </p>
                    <p className="font-mono text-xs text-slate-500 tabular-nums">
                      Vencimento: {pay.dueDate} · Valor:{' '}
                      <strong className="text-slate-900">{formatBRL(pay.amount)}</strong>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                      {(['Aguardando', 'Parcial', 'Quitado', 'Em Atraso'] as PaymentStatus[]).map(
                        (s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                </div>
              ))}
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
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#0F5132] focus:outline-none"
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
              className="h-4 w-4 rounded border-slate-300 text-[#0F5132]"
            />
            Aceitar retirada no balcão da fábrica
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="h-11 w-full rounded-xl bg-[#0F5132] text-xs font-semibold text-white hover:bg-[#146c43] disabled:opacity-50"
          >
            Salvar Política de Entrega
          </button>
        </form>
      )}
    </div>
  );
};
