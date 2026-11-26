import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Factory,
  FileWarning,
  HelpCircle,
  LifeBuoy,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
  ShieldCheck,
  ShoppingBag,
  Store,
  Ticket,
  X,
} from 'lucide-react';
import type {
  CommercialBanRecord,
  DeliveryReport,
  DeliveryReportStatus,
  MixedOrder,
  SupportTicket,
  SupportTicketReason,
  SupportTicketStatus,
  UserProfile,
} from '../types/zapei';
import {
  buildEmailSupportUrl,
  buildSupportContactMessage,
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
  defaultTab?: 'faq' | 'ticket' | 'my_tickets' | 'moderation';
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
  deliveryReports?: DeliveryReport[];
  adminTickets?: SupportTicket[];
  commercialBans?: CommercialBanRecord[];
  isSupportAdmin?: boolean;
  initialContext?: HelpCenterContext | null;
  onSubmitTicket: (params: {
    reason: SupportTicketReason;
    orderId?: string;
    orderCode?: string;
    description: string;
  }) => Promise<{ id: string; ticketCode: string }>;
  onResolveTicket?: (ticketId: string) => Promise<void>;
  onOpenOfficialSupportChat: (prefillMessage: string) => void;
  onAdminUpdateReportStatus?: (params: {
    reportId: string;
    status: DeliveryReportStatus;
    resolutionNote?: string;
  }) => Promise<void>;
  onAdminBanCommercial?: (params: {
    targetUid: string;
    targetName: string;
    reason: string;
    reportId?: string;
    ticketId?: string;
    orderCode?: string;
  }) => Promise<void>;
  onAdminLiftCommercialBan?: (params: {
    targetUid: string;
    liftNote: string;
    reportId?: string;
    ticketId?: string;
  }) => Promise<void>;
}

type HelpCenterTab = 'faq' | 'ticket' | 'my_tickets' | 'moderation';

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
  deliveryReports = [],
  adminTickets = [],
  commercialBans = [],
  isSupportAdmin = false,
  initialContext,
  onSubmitTicket,
  onResolveTicket,
  onOpenOfficialSupportChat,
  onAdminUpdateReportStatus,
  onAdminBanCommercial,
  onAdminLiftCommercialBan,
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
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [moderationNotes, setModerationNotes] = useState<Record<string, string>>({});
  const [moderationBusyId, setModerationBusyId] = useState<string | null>(null);
  const [moderationFeedback, setModerationFeedback] = useState('');

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
      const requestedTab =
        initialContext.defaultTab ?? (initialContext.orderCode ? 'ticket' : 'faq');
      setActiveTab(
        requestedTab === 'moderation' && !isSupportAdmin ? 'faq' : requestedTab
      );
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
    setModerationFeedback('');
  }, [open, initialContext, profile.commercialMode, userOrders, isSupportAdmin]);

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

  const activeBanGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        targetUid: string;
        targetName: string;
        reason: string;
        orderCode?: string;
        reportId?: string;
        ticketId?: string;
        bannedAtMs: number;
        identifiers: string[];
      }
    >();
    for (const ban of commercialBans) {
      if (ban.status !== 'active' || !ban.targetUid) continue;
      const existing = map.get(ban.targetUid);
      const identLabel =
        ban.identifierType === 'cpf'
          ? 'CPF'
          : ban.identifierType === 'phone'
            ? 'Telefone'
            : ban.identifierType === 'virtualLine'
              ? 'Linha Virtual'
              : 'Conta';
      if (existing) {
        if (!existing.identifiers.includes(identLabel)) {
          existing.identifiers.push(identLabel);
        }
      } else {
        map.set(ban.targetUid, {
          targetUid: ban.targetUid,
          targetName: ban.targetName || 'Usuário ChatFi',
          reason: ban.reason,
          orderCode: ban.orderCode,
          reportId: ban.reportId,
          ticketId: ban.ticketId,
          bannedAtMs: ban.bannedAtMs,
          identifiers: [identLabel],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.bannedAtMs - a.bannedAtMs);
  }, [commercialBans]);

  if (!open) return null;

  const openTicketCount = tickets.filter((t) => t.status !== 'Resolvido').length;
  const pendingReportsCount = deliveryReports.filter(
    (r) => r.status === 'Aberto' || r.status === 'Em análise'
  ).length;
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
        <nav
          className={`grid gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5 ${
            isSupportAdmin ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
          }`}
        >
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

          {isSupportAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('moderation')}
              className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition whitespace-nowrap ${
                activeTab === 'moderation'
                  ? 'bg-[#0D2B3E] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="tabular-nums">
                Moderação{pendingReportsCount > 0 ? ` (${pendingReportsCount})` : ''}
              </span>
            </button>
          )}
        </nav>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-5">
          {profile.commercialBanned && (
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs font-bold text-slate-900">
                  Modos comerciais suspensos para análise de entrega
                </p>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  O acesso aos painéis de Fabricante e Revendedor está temporariamente restrito
                  {profile.commercialBanReason ? ` (${profile.commercialBanReason})` : ''}. Sua conta pessoal, conversas e ligações seguem funcionando normalmente.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReason('Recurso / Liberação Comercial');
                  if (!description.trim()) {
                    setDescription(
                      'Solicito revisão da suspensão dos modos Fabricante/Revendedor. Comprovantes e justificativa: '
                    );
                  }
                  setActiveTab('ticket');
                }}
                className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0D2B3E] px-3.5 text-xs font-semibold text-white hover:bg-[#163D56]"
              >
                Solicitar revisão e reativação
              </button>
            </div>
          )}
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

              {deliveryReports.length > 0 && (
                <div className="mt-5 space-y-2.5 border-t border-slate-200 pt-4">
                  <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">
                    <FileWarning className="h-3.5 w-3.5 text-slate-500" />
                    Ocorrências de Entrega ({deliveryReports.length})
                  </h4>
                  {deliveryReports.map((rep) => (
                    <article
                      key={rep.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-900">
                          <span className="font-mono text-[#0D2B3E]">{rep.reportCode}</span>
                          {' · '}
                          {rep.reportedRole === 'manufacturer' ? 'Fabricante' : 'Revendedor'}:{' '}
                          {rep.reportedName}
                        </p>
                        <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {rep.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Pedido {rep.subOrderCode || rep.orderCode} · Motivo: {rep.reason} ·{' '}
                        {rep.createdAt}
                      </p>
                      <p className="text-xs text-slate-700">{rep.description}</p>
                      {rep.resolutionNote && (
                        <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
                          Parecer do suporte: {rep.resolutionNote}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* TAB 4: MODERAÇÃO DE ENTREGAS E LIBERAÇÃO COMERCIAL (APENAS ADMIN/SUPORTE) */}
          {activeTab === 'moderation' && isSupportAdmin && (
            <section className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Moderação Comercial e Ocorrências de Entrega
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Apuração de ocorrências por má-fé na entrega, suspensão exclusiva de Fabricante/Revendedor e reativação após análise.
                </p>
              </div>

              {moderationFeedback && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-[#0E7A34]">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{moderationFeedback}</span>
                </div>
              )}

              {/* Active Commercial Bans / Liberation */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Contas com Modos Comerciais Suspensos ({activeBanGroups.length})
                </h4>
                {activeBanGroups.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">
                    Nenhuma conta com suspensão comercial ativa no momento.
                  </div>
                ) : (
                  activeBanGroups.map((ban) => {
                    const note = moderationNotes[ban.targetUid] ?? '';
                    const isBusy = moderationBusyId === ban.targetUid;
                    return (
                      <article
                        key={ban.targetUid}
                        className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-bold text-slate-900">
                              {ban.targetName}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Vínculos bloqueados: {ban.identifiers.join(', ')}
                              {ban.orderCode ? ` · Pedido ${ban.orderCode}` : ''}
                            </p>
                          </div>
                          <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                            Comercial Suspenso
                          </span>
                        </div>
                        <p className="text-xs text-slate-700">
                          Motivo registrado: {ban.reason}
                        </p>
                        {onAdminLiftCommercialBan && (
                          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                            <input
                              type="text"
                              value={note}
                              onChange={(e) =>
                                setModerationNotes((p) => ({
                                  ...p,
                                  [ban.targetUid]: e.target.value,
                                }))
                              }
                              placeholder="Observação da liberação (opcional)..."
                              className="h-9 flex-1 rounded-xl border border-slate-200 px-3 text-xs text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={async () => {
                                setModerationBusyId(ban.targetUid);
                                setModerationFeedback('');
                                try {
                                  await onAdminLiftCommercialBan({
                                    targetUid: ban.targetUid,
                                    liftNote:
                                      note.trim() ||
                                      'Liberado após apuração pelo Suporte ChatFi.',
                                    reportId: ban.reportId,
                                    ticketId: ban.ticketId,
                                  });
                                  setModerationFeedback(
                                    `Modos comerciais de ${ban.targetName} liberados e reativados.`
                                  );
                                } finally {
                                  setModerationBusyId(null);
                                }
                              }}
                              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-60"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {isBusy ? 'Liberando...' : 'Liberar Modos Comerciais'}
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>

              {/* Delivery Bad-Faith Reports */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Ocorrências Registradas ({deliveryReports.length})
                </h4>
                {deliveryReports.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">
                    Nenhuma ocorrência de entrega registrada até o momento.
                  </div>
                ) : (
                  deliveryReports.map((rep) => {
                    const note = moderationNotes[rep.id] ?? '';
                    const isBusy = moderationBusyId === rep.id;
                    const alreadyBanned = activeBanGroups.some(
                      (b) => b.targetUid === rep.reportedUid
                    );
                    return (
                      <article
                        key={rep.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-bold text-slate-900">
                              <span className="font-mono text-[#0D2B3E]">{rep.reportCode}</span>
                              {' · '}
                              {rep.reportedRole === 'manufacturer' ? 'Fabricante' : 'Revendedor'}:{' '}
                              {rep.reportedName}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Pedido {rep.subOrderCode || rep.orderCode} · Relator: {rep.reporterName} ·{' '}
                              {rep.createdAt}
                            </p>
                          </div>
                          <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            {rep.status}
                          </span>
                        </div>

                        <p className="text-xs font-semibold text-slate-800">{rep.reason}</p>
                        <p className="text-xs text-slate-700 whitespace-pre-wrap">
                          {rep.description}
                        </p>

                        {rep.status !== 'Resolvido' && rep.status !== 'Improcedente' && (
                          <div className="space-y-2 border-t border-slate-100 pt-2.5">
                            <input
                              type="text"
                              value={note}
                              onChange={(e) =>
                                setModerationNotes((p) => ({ ...p, [rep.id]: e.target.value }))
                              }
                              placeholder="Motivo do bloqueio ou parecer da análise..."
                              className="h-9 w-full rounded-xl border border-slate-200 px-3 text-xs text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                            />
                            <div className="flex flex-wrap gap-2">
                              {onAdminBanCommercial && !alreadyBanned && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={async () => {
                                    setModerationBusyId(rep.id);
                                    setModerationFeedback('');
                                    try {
                                      await onAdminBanCommercial({
                                        targetUid: rep.reportedUid,
                                        targetName: rep.reportedName,
                                        reason: note.trim() || rep.reason,
                                        reportId: rep.id,
                                        ticketId: rep.ticketId,
                                        orderCode: rep.orderCode,
                                      });
                                      setModerationFeedback(
                                        `Suspensão comercial aplicada para ${rep.reportedName} (conta pessoal preservada).`
                                      );
                                    } finally {
                                      setModerationBusyId(null);
                                    }
                                  }}
                                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-[#0D2B3E] px-3 text-[11px] font-semibold text-white hover:bg-[#163D56] disabled:opacity-60"
                                >
                                  Suspender Fabricante/Revendedor
                                </button>
                              )}
                              {onAdminUpdateReportStatus && rep.status === 'Aberto' && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={async () => {
                                    setModerationBusyId(rep.id);
                                    try {
                                      await onAdminUpdateReportStatus({
                                        reportId: rep.id,
                                        status: 'Em análise',
                                        resolutionNote: note.trim() || undefined,
                                      });
                                      setModerationFeedback(
                                        `Ocorrência ${rep.reportCode} marcada como Em análise.`
                                      );
                                    } finally {
                                      setModerationBusyId(null);
                                    }
                                  }}
                                  className="inline-flex min-h-[34px] items-center rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Colocar em análise
                                </button>
                              )}
                              {onAdminUpdateReportStatus && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={async () => {
                                    setModerationBusyId(rep.id);
                                    try {
                                      await onAdminUpdateReportStatus({
                                        reportId: rep.id,
                                        status: 'Improcedente',
                                        resolutionNote:
                                          note.trim() || 'Ocorrência encerrada sem penalidade.',
                                      });
                                      setModerationFeedback(
                                        `Ocorrência ${rep.reportCode} marcada como improcedente.`
                                      );
                                    } finally {
                                      setModerationBusyId(null);
                                    }
                                  }}
                                  className="inline-flex min-h-[34px] items-center rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Marcar Improcedente
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>

              {/* Recent User Appeals & Tickets for Support */}
              {adminTickets.length > 0 && (
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Chamados e Recursos Recentes ({adminTickets.length})
                  </h4>
                  {adminTickets.slice(0, 12).map((t) => {
                    const userIsBanned = activeBanGroups.some(
                      (b) => b.targetUid === t.userId
                    );
                    return (
                      <article
                        key={t.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-bold text-slate-900">
                              <span className="font-mono text-[#0D2B3E]">{t.ticketCode}</span>
                              {' · '}
                              {t.reason}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {t.userName}
                              {t.userVirtualLine ? ` (${t.userVirtualLine})` : ''}
                              {t.orderCode ? ` · Pedido ${t.orderCode}` : ''} · {t.createdAt}
                            </p>
                          </div>
                          <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            {t.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 whitespace-pre-wrap">
                          {t.description}
                        </p>
                        <div className="flex flex-wrap justify-end gap-2 pt-1">
                          {userIsBanned && onAdminLiftCommercialBan && (
                            <button
                              type="button"
                              disabled={moderationBusyId === t.userId}
                              onClick={async () => {
                                setModerationBusyId(t.userId);
                                try {
                                  await onAdminLiftCommercialBan({
                                    targetUid: t.userId,
                                    liftNote: `Liberado via chamado ${t.ticketCode}.`,
                                    ticketId: t.id,
                                  });
                                  setModerationFeedback(
                                    `Modos comerciais de ${t.userName} liberados.`
                                  );
                                } finally {
                                  setModerationBusyId(null);
                                }
                              }}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-xl bg-[#0E7A34] px-3 text-[11px] font-semibold text-white hover:bg-[#0B5D27]"
                            >
                              Liberar Modos Comerciais
                            </button>
                          )}
                          {onResolveTicket && t.status !== 'Resolvido' && (
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
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Marcar Resolvido
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* DIRECT CONTACT WITH OFFICIAL CHATFI SUPPORT */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Canais de Atendimento ChatFi
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Para dúvidas, solicitações gerais e acompanhamento de pedidos, fale conosco pelo e-mail{' '}
                <span className="font-semibold text-slate-800">{OFFICIAL_SUPPORT_EMAIL}</span> ou abra um chamado acima.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Primary Support E-mail */}
              <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    E-mail Oficial de Suporte
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    Canal principal para dúvidas, pagamentos, pedidos, Wallet ID e atendimento padrão.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={emailUrl}
                    className="flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#0E7A34] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#0B5D27] min-w-0"
                  >
                    <Mail className="h-4 w-4 shrink-0" />
                    <span className="truncate">{OFFICIAL_SUPPORT_EMAIL}</span>
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(OFFICIAL_SUPPORT_EMAIL);
                        setCopiedEmail(true);
                        window.setTimeout(() => setCopiedEmail(false), 2000);
                      } catch {
                        // ignore clipboard errors in restricted frames
                      }
                    }}
                    title="Copiar e-mail de suporte"
                    aria-label="Copiar e-mail de suporte"
                    className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                  >
                    {copiedEmail ? (
                      <Check className="h-4 w-4 text-[#0E7A34]" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Discreet Direct Support Line */}
              <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    Linha Direta ·{' '}
                    <span className="font-mono font-semibold text-slate-700">
                      {OFFICIAL_SUPPORT_VIRTUAL_LINE}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    Atendimento direto pelo chat interno do ChatFi com os dados da sua conta preenchidos.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenOfficialSupportChat(supportPrefillMessage);
                  }}
                  className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-100"
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-[#0D2B3E]" />
                  <span>Conversar · {OFFICIAL_SUPPORT_VIRTUAL_LINE}</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
