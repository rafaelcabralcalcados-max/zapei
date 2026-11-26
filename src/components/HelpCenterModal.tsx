import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Factory,
  HelpCircle,
  LifeBuoy,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
  ShoppingBag,
  Store,
  Ticket,
  X,
} from 'lucide-react';
import type {
  MixedOrder,
  SupportTicket,
  SupportTicketReason,
  SupportTicketStatus,
  UserProfile,
} from '../types/zapei';
import {
  buildEmailSupportUrl,
  buildSupportContactMessage,
  buildWhatsAppSupportUrl,
  commercialModeToFaqTab,
  FAQ_BY_PROFILE,
  FAQ_PROFILE_TABS,
  OFFICIAL_SUPPORT_EMAIL,
  OFFICIAL_SUPPORT_VIRTUAL_LINE,
  SUPPORT_TICKET_REASONS,
  type FaqProfileTab,
} from '../lib/supportConfig';
import { formatBRL } from '../lib/gradeParser';

export interface HelpCenterContext {
  defaultTab?: 'faq' | 'ticket' | 'my_tickets';
  orderId?: string;
  orderCode?: string;
  reason?: SupportTicketReason;
}

interface HelpCenterModalProps {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  orders: MixedOrder[];
  tickets: SupportTicket[];
  initialContext?: HelpCenterContext | null;
  onSubmitTicket: (params: {
    reason: SupportTicketReason;
    orderId?: string;
    orderCode?: string;
    description: string;
  }) => Promise<{ id: string; ticketCode: string }>;
  onResolveTicket?: (ticketId: string) => Promise<void>;
  onOpenOfficialSupportChat: (prefillMessage: string) => void;
}

type HelpCenterTab = 'faq' | 'ticket' | 'my_tickets';

function getTicketStatusStyle(status: SupportTicketStatus): {
  classes: string;
  icon: 'open' | 'progress' | 'done';
} {
  if (status === 'Resolvido') {
    return {
      classes: 'border-emerald-200 bg-emerald-50 text-[#0E7A34]',
      icon: 'done',
    };
  }
  if (status === 'Em análise') {
    return {
      classes: 'border-amber-200 bg-amber-50 text-amber-800',
      icon: 'progress',
    };
  }
  return {
    classes: 'border-sky-200 bg-sky-50 text-sky-800',
    icon: 'open',
  };
}

export const HelpCenterModal: React.FC<HelpCenterModalProps> = ({
  open,
  onClose,
  profile,
  orders,
  tickets,
  initialContext,
  onSubmitTicket,
  onResolveTicket,
  onOpenOfficialSupportChat,
}) => {
  const [activeTab, setActiveTab] = useState<HelpCenterTab>('faq');
  const [faqTab, setFaqTab] = useState<FaqProfileTab>(() =>
    commercialModeToFaqTab(profile.commercialMode)
  );
  const [expandedFaqId, setExpandedFaqId] = useState<string>('buyer-payment');

  const [reason, setReason] = useState<SupportTicketReason>('Dúvida sobre Pedido');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [manualOrderCode, setManualOrderCode] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [createdTicketCode, setCreatedTicketCode] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const userOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.buyerId === profile.uid ||
          o.resellerId === profile.uid ||
          o.factoryIds.includes(profile.uid)
      ),
    [orders, profile.uid]
  );

  // Sync context whenever modal opens
  useEffect(() => {
    if (!open) return;
    const defaultRoleTab = commercialModeToFaqTab(profile.commercialMode);
    setFaqTab(defaultRoleTab);
    setExpandedFaqId(FAQ_BY_PROFILE[defaultRoleTab][0]?.id || '');
    setSubmitError('');
    setCreatedTicketCode('');

    if (initialContext) {
      setActiveTab(initialContext.defaultTab ?? (initialContext.orderCode ? 'ticket' : 'faq'));
      setReason(
        initialContext.reason ??
          (initialContext.orderCode ? 'Dúvida sobre Pedido' : 'Problema com Pagamento / Pix')
      );
      if (initialContext.orderId && userOrders.some((o) => o.id === initialContext.orderId)) {
        setSelectedOrderId(initialContext.orderId);
        setManualOrderCode(initialContext.orderCode || '');
      } else {
        setSelectedOrderId('');
        setManualOrderCode(initialContext.orderCode || '');
      }
    } else {
      setActiveTab('faq');
      setSelectedOrderId('');
      setManualOrderCode('');
    }
  }, [open, initialContext, profile.commercialMode, userOrders]);

  const linkedOrder = useMemo(
    () => userOrders.find((o) => o.id === selectedOrderId) ?? null,
    [userOrders, selectedOrderId]
  );

  const effectiveOrderCode = (
    linkedOrder?.orderCode ||
    manualOrderCode.trim() ||
    ''
  ).slice(0, 32);
  const effectiveOrderId = linkedOrder?.id || initialContext?.orderId || '';

  const supportPrefillMessage = useMemo(
    () =>
      buildSupportContactMessage({
        userName: profile.name,
        userVirtualLine: profile.virtualLine,
        userPhone: profile.phone,
        orderCode: effectiveOrderCode || undefined,
        orderId: effectiveOrderId || undefined,
        reason: activeTab === 'ticket' ? reason : undefined,
        customNote: description.trim() ? description.trim() : undefined,
      }),
    [
      profile.name,
      profile.virtualLine,
      profile.phone,
      effectiveOrderCode,
      effectiveOrderId,
      activeTab,
      reason,
      description,
    ]
  );

  const whatsappUrl = useMemo(
    () =>
      buildWhatsAppSupportUrl({
        userName: profile.name,
        userVirtualLine: profile.virtualLine,
        userPhone: profile.phone,
        orderCode: effectiveOrderCode || undefined,
        orderId: effectiveOrderId || undefined,
        reason: activeTab === 'ticket' ? reason : undefined,
        customNote: description.trim() ? description.trim() : undefined,
      }),
    [
      profile.name,
      profile.virtualLine,
      profile.phone,
      effectiveOrderCode,
      effectiveOrderId,
      activeTab,
      reason,
      description,
    ]
  );

  const emailUrl = useMemo(
    () =>
      buildEmailSupportUrl({
        userName: profile.name,
        userVirtualLine: profile.virtualLine,
        userPhone: profile.phone,
        orderCode: effectiveOrderCode || undefined,
        orderId: effectiveOrderId || undefined,
        reason: activeTab === 'ticket' ? reason : undefined,
        customNote: description.trim() ? description.trim() : undefined,
      }),
    [
      profile.name,
      profile.virtualLine,
      profile.phone,
      effectiveOrderCode,
      effectiveOrderId,
      activeTab,
      reason,
      description,
    ]
  );

  if (!open) return null;

  const openTicketCount = tickets.filter((t) => t.status !== 'Resolvido').length;
  const userIdentityLabel = profile.virtualLine || profile.phone || 'Conta verificada';

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    setCreatedTicketCode('');

    const cleanDesc = description.trim();
    if (cleanDesc.length < 5) {
      setSubmitError('Descreva o problema com pelo menos 5 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await onSubmitTicket({
        reason,
        orderId: effectiveOrderId || undefined,
        orderCode: effectiveOrderCode || undefined,
        description: cleanDesc,
      });
      setCreatedTicketCode(result.ticketCode);
      setDescription('');
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Não foi possível registrar seu chamado. Tente novamente.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Central de Ajuda e Suporte ChatFi"
    >
      <div className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#0E7A34]">
              <LifeBuoy className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                Central de Ajuda e Suporte
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 truncate">
                {profile.name} ·{' '}
                <span className="font-mono text-slate-700 tabular-nums">
                  {userIdentityLabel}
                </span>
              </p>
              {effectiveOrderCode && (
                <p className="mt-1 text-[11px] font-semibold text-[#0E7A34]">
                  Atendimento vinculado ao pedido {effectiveOrderCode}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Central de Ajuda"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Primary Section Tabs */}
        <nav className="grid grid-cols-3 gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('faq')}
            className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition whitespace-nowrap ${
              activeTab === 'faq'
                ? 'bg-[#0E7A34] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5 shrink-0" />
            <span>Perguntas (FAQ)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ticket')}
            className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition whitespace-nowrap ${
              activeTab === 'ticket'
                ? 'bg-[#0E7A34] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <Ticket className="h-3.5 w-3.5 shrink-0" />
            <span>Abrir Chamado</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('my_tickets')}
            className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition whitespace-nowrap ${
              activeTab === 'my_tickets'
                ? 'bg-[#0D2B3E] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="tabular-nums">
              Meus Chamados{openTicketCount > 0 ? ` (${openTicketCount})` : ''}
            </span>
          </button>
        </nav>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-5">
          {/* TAB 1: FAQ POR PERFIL */}
          {activeTab === 'faq' && (
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Perguntas Frequentes por Perfil
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Escolha seu perfil para consultar respostas rápidas sobre pagamentos, pedidos, vitrine e Split Asaas.
                </p>
              </div>

              {/* Profile Sub-Tabs */}
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-200/70 p-1">
                {FAQ_PROFILE_TABS.map((tab) => {
                  const selected = faqTab === tab.id;
                  const TabIcon =
                    tab.id === 'buyer'
                      ? ShoppingBag
                      : tab.id === 'reseller'
                        ? Store
                        : Factory;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setFaqTab(tab.id);
                        setExpandedFaqId(FAQ_BY_PROFILE[tab.id][0]?.id || '');
                      }}
                      className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
                        selected
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <TabIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <p className="text-xs font-medium text-slate-600">
                {FAQ_PROFILE_TABS.find((t) => t.id === faqTab)?.subtitle}
              </p>

              <div className="space-y-2.5">
                {FAQ_BY_PROFILE[faqTab].map((item) => {
                  const isExpanded = expandedFaqId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-white overflow-hidden transition"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedFaqId((prev) => (prev === item.id ? '' : item.id))
                        }
                        aria-expanded={isExpanded}
                        className="flex w-full min-h-[52px] items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                      >
                        <span className="text-xs sm:text-sm font-bold text-slate-900">
                          {item.question}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3.5 space-y-2.5">
                          <p className="text-xs leading-relaxed text-slate-700">
                            {item.answer}
                          </p>
                          {item.steps && item.steps.length > 0 && (
                            <ol className="space-y-1.5 text-xs text-slate-700">
                              {item.steps.map((step, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="font-mono text-[11px] font-bold text-[#0E7A34] tabular-nums">
                                    {idx + 1}.
                                  </span>
                                  <span className="leading-relaxed">{step}</span>
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    Ainda precisa de atendimento específico?
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Registre um chamado vinculado ao seu pedido ou chame o Suporte Oficial abaixo.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('ticket')}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0E7A34] px-4 text-xs font-semibold text-white hover:bg-[#0B5D27]"
                >
                  <Ticket className="h-3.5 w-3.5" />
                  Abrir Chamado
                </button>
              </div>
            </section>
          )}

          {/* TAB 2: ABRIR CHAMADO / TICKET DE SUPORTE */}
          {activeTab === 'ticket' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Abrir Chamado de Suporte
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Descreva sua solicitação. O chamado é registrado com sua Linha Virtual para acompanhamento em tempo real.
                </p>
              </div>

              {createdTicketCode && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-[#0E7A34]">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-bold">
                        Chamado {createdTicketCode} aberto com sucesso!
                      </p>
                      <p className="text-[11px] text-emerald-800">
                        Status inicial: Aberto. Você pode acompanhar a análise na aba Meus Chamados.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('my_tickets')}
                    className="rounded-lg bg-[#0E7A34] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0B5D27]"
                  >
                    Ver Meus Chamados
                  </button>
                </div>
              )}

              {submitError && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleSubmitForm} className="space-y-3.5">
                <div>
                  <label
                    htmlFor="support-reason-select"
                    className="mb-1 block text-xs font-bold text-slate-800"
                  >
                    Motivo do contato
                  </label>
                  <select
                    id="support-reason-select"
                    value={reason}
                    onChange={(e) => setReason(e.target.value as SupportTicketReason)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                  >
                    {SUPPORT_TICKET_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="support-order-select"
                      className="mb-1 block text-xs font-bold text-slate-800"
                    >
                      Vincular pedido (opcional)
                    </label>
                    <select
                      id="support-order-select"
                      value={selectedOrderId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedOrderId(id);
                        const match = userOrders.find((o) => o.id === id);
                        setManualOrderCode(match ? match.orderCode : '');
                      }}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                    >
                      <option value="">Nenhum pedido selecionado</option>
                      {userOrders.map((o) => (
                        <option key={o.id} value={o.id}>
                          Pedido {o.orderCode} · {formatBRL(o.buyerFinalTotal)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="support-order-code"
                      className="mb-1 block text-xs font-bold text-slate-800"
                    >
                      Ou digite o código do pedido
                    </label>
                    <input
                      id="support-order-code"
                      type="text"
                      maxLength={32}
                      value={manualOrderCode}
                      onChange={(e) => {
                        setManualOrderCode(e.target.value);
                        if (selectedOrderId) {
                          const current = userOrders.find((o) => o.id === selectedOrderId);
                          if (current && current.orderCode !== e.target.value) {
                            setSelectedOrderId('');
                          }
                        }
                      }}
                      placeholder="Ex.: #4821 ou #4821-F1"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label
                      htmlFor="support-description"
                      className="text-xs font-bold text-slate-800"
                    >
                      Descreva o problema
                    </label>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {description.length}/2000
                    </span>
                  </div>
                  <textarea
                    id="support-description"
                    rows={4}
                    maxLength={2000}
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Explique o que aconteceu, valores envolvidos, comprovante ou horário para agilizar a análise..."
                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0E7A34] px-4 text-xs font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {submitting ? 'Registrando chamado...' : 'Enviar Chamado de Suporte'}
                </button>
              </form>
            </section>
          )}

          {/* TAB 3: MEUS CHAMADOS (support_tickets) */}
          {activeTab === 'my_tickets' && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Meus Chamados Registrados
                  </h3>
                  <p className="text-xs text-slate-500">
                    Acompanhe o status do seu atendimento em tempo real.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('ticket')}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-[#0E7A34] px-3 text-xs font-semibold text-white hover:bg-[#0B5D27]"
                >
                  <Ticket className="h-3.5 w-3.5" />
                  Novo
                </button>
              </div>

              {tickets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <Ticket className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2.5 text-sm font-semibold text-slate-800">
                    Você ainda não abriu nenhum chamado
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Quando precisar de suporte sobre pagamentos, pedidos ou Wallet ID, seus chamados aparecerão aqui.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {tickets.map((t) => {
                    const style = getTicketStatusStyle(t.status);
                    return (
                      <article
                        key={t.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-0.5">
                            <p className="text-xs sm:text-sm font-bold text-slate-900">
                              <span className="font-mono text-[#0D2B3E]">{t.ticketCode}</span>
                              {' · '}
                              <span>{t.reason}</span>
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Aberto em {t.createdAt}
                              {t.orderCode ? ` · Pedido ${t.orderCode}` : ''}
                            </p>
                          </div>

                          <span
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold ${style.classes}`}
                          >
                            {style.icon === 'done' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <Clock className="h-3 w-3" />
                            )}
                            {t.status}
                          </span>
                        </div>

                        <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                          {t.description}
                        </p>

                        {onResolveTicket && t.status !== 'Resolvido' && (
                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              disabled={resolvingId === t.id}
                              onClick={async () => {
                                setResolvingId(t.id);
                                try {
                                  await onResolveTicket(t.id);
                                } finally {
                                  setResolvingId(null);
                                }
                              }}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#0E7A34]" />
                              {resolvingId === t.id
                                ? 'Atualizando...'
                                : 'Marcar como Resolvido'}
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* DIRECT CONTACT WITH OFFICIAL CHATFI SUPPORT */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Contato Direto com o Suporte Oficial ChatFi
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Linha Virtual oficial:{' '}
                  <span className="font-mono font-bold text-[#0D2B3E]">
                    {OFFICIAL_SUPPORT_VIRTUAL_LINE}
                  </span>
                  {' · '}
                  Seus dados ({userIdentityLabel}
                  {effectiveOrderCode ? ` e Pedido ${effectiveOrderCode}` : ''}) vão preenchidos automaticamente.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenOfficialSupportChat(supportPrefillMessage);
                }}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[#0D2B3E] px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-[#143d57]"
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span>Chat Oficial ChatFi</span>
              </button>

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-[#0E7A34] transition hover:bg-emerald-100"
              >
                <MessageCircle className="h-4 w-4 shrink-0" />
                <span>WhatsApp Suporte</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>

              <a
                href={emailUrl}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-100"
              >
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{OFFICIAL_SUPPORT_EMAIL}</span>
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
