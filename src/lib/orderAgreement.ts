import type {
  BuyerReleaseOption,
  OrderAgreementHistoryEntry,
  ResellerReleasePreference,
  ResellerShareReleaseStatus,
} from '../types/zapei';

export const RESELLER_RELEASE_OPTIONS: Array<{
  id: ResellerReleasePreference;
  shortLabel: string;
  title: string;
  description: string;
}> = [
  {
    id: 'after_account_release',
    shortLabel: 'Envia após liberação na conta',
    title: 'Envio apenas após liberação na conta',
    description:
      'O vendedor informa que condiciona o despacho à liberação prévia da sua parcela na conta.',
  },
  {
    id: 'upon_carrier_receipt',
    shortLabel: 'Liberação com comprovante da transportadora',
    title: 'Aceito liberação com comprovante da transportadora',
    description:
      'Liberação vinculada ao registro dos dados, prazo e comprovante de envio/entrega na transportadora.',
  },
  {
    id: 'after_delivery_confirmation',
    shortLabel: 'Aguarda liberação após entrega',
    title: 'Aguardo liberação após confirmação de entrega',
    description:
      'O envio segue normalmente e a parcela do vendedor é liberada após o cliente confirmar o recebimento.',
  },
];

export const BUYER_RELEASE_OPTIONS: Array<{
  id: BuyerReleaseOption;
  shortLabel: string;
  title: string;
  description: string;
}> = [
  {
    id: 'upon_carrier_receipt',
    shortLabel: 'Liberar no comprovante da transportadora',
    title: 'Liberar ao receber o comprovante de envio/entrega na transportadora',
    description:
      'Ao visualizar os dados, o prazo e o comprovante da transportadora anexado no pedido, você autoriza a liberação da parcela do vendedor.',
  },
  {
    id: 'upon_product_in_hand',
    shortLabel: 'Só libero com o produto em mãos',
    title: 'Só libero com o produto em mãos',
    description:
      'A liberação da parcela do vendedor fica condicionada à sua confirmação de recebimento físico da mercadoria.',
  },
];

export function getResellerReleaseOptionMeta(pref?: ResellerReleasePreference) {
  if (!pref) {
    return {
      id: 'upon_carrier_receipt' as ResellerReleasePreference,
      shortLabel: 'Condição flexível (a combinar)',
      title: 'Preferência não especificada pelo vendedor',
      description:
        'O vendedor não fixou exigência prévia no perfil e pode informar ou ajustar a preferência no pedido.',
    };
  }
  return (
    RESELLER_RELEASE_OPTIONS.find((o) => o.id === pref) ||
    RESELLER_RELEASE_OPTIONS[1]
  );
}

export function getBuyerReleaseOptionMeta(opt?: BuyerReleaseOption) {
  if (!opt) {
    return {
      id: 'upon_product_in_hand' as BuyerReleaseOption,
      shortLabel: 'Opcional / não definida no pedido',
      title: 'Opção não registrada no pedido',
      description: 'Pedido criado antes da escolha opcional de liberação.',
    };
  }
  return BUYER_RELEASE_OPTIONS.find((o) => o.id === opt) || BUYER_RELEASE_OPTIONS[0];
}

export function getResellerShareReleaseStatusLabel(
  status?: ResellerShareReleaseStatus
): { label: string; tone: 'neutral' | 'amber' | 'green' } {
  switch (status) {
    case 'released_on_receipt':
      return {
        label: 'Liberada mediante comprovante da transportadora',
        tone: 'green',
      };
    case 'released_on_delivery':
      return {
        label: 'Liberada após confirmação com produto em mãos',
        tone: 'green',
      };
    case 'held':
      return {
        label: 'Aguardando critério de liberação combinado',
        tone: 'amber',
      };
    default:
      return {
        label: 'Aguardando pagamento e cumprimento da regra combinada',
        tone: 'neutral',
      };
  }
}

export function hasPreferenceDivergence(
  resellerPref?: ResellerReleasePreference,
  buyerOpt?: BuyerReleaseOption
): boolean {
  if (!resellerPref || !buyerOpt) return false;
  if (resellerPref === 'after_account_release' && buyerOpt === 'upon_product_in_hand') {
    return true;
  }
  if (resellerPref === 'after_account_release' && buyerOpt === 'upon_carrier_receipt') {
    return true;
  }
  if (resellerPref === 'upon_carrier_receipt' && buyerOpt === 'upon_product_in_hand') {
    return true;
  }
  return false;
}

export function formatHistoryDateLabel(ms = Date.now()): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

export function createAgreementHistoryEntry(params: {
  actorUid: string;
  actorRole: OrderAgreementHistoryEntry['actorRole'];
  actorName: string;
  eventType: OrderAgreementHistoryEntry['eventType'];
  summary: string;
  timestampMs?: number;
}): OrderAgreementHistoryEntry {
  const timestampMs = params.timestampMs ?? Date.now();
  return {
    id: `hist_${timestampMs}_${Math.random().toString(36).slice(2, 7)}`,
    timestampMs,
    dateLabel: formatHistoryDateLabel(timestampMs),
    actorUid: params.actorUid,
    actorRole: params.actorRole,
    actorName: (params.actorName || 'Participante').slice(0, 60),
    eventType: params.eventType,
    summary: params.summary.slice(0, 260),
  };
}

export function appendAgreementHistory(
  existing: OrderAgreementHistoryEntry[] | undefined,
  nextEntry: OrderAgreementHistoryEntry
): OrderAgreementHistoryEntry[] {
  const base = Array.isArray(existing) ? existing : [];
  return [...base, nextEntry].slice(-30);
}

export function formatCarrierDeadlineSummary(params: {
  deadlineDays?: number;
  deadlineAtMs?: number;
  extensions?: number;
  nowMs?: number;
}): string {
  const now = params.nowMs ?? Date.now();
  const extSuffix =
    params.extensions && params.extensions > 0
      ? ` (prorrogado ${params.extensions}x em +5 dias)`
      : '';
  if (typeof params.deadlineAtMs === 'number' && params.deadlineAtMs > 0) {
    const dateStr = new Date(params.deadlineAtMs).toLocaleDateString('pt-BR');
    const diffDays = Math.ceil((params.deadlineAtMs - now) / (1000 * 60 * 60 * 24));
    const remLabel =
      diffDays > 1
        ? `restam ${diffDays} dias`
        : diffDays === 1
          ? 'vence amanhã'
          : diffDays === 0
            ? 'vence hoje'
            : `atraso de ${Math.abs(diffDays)} dia(s)`;
    const totalDays = params.deadlineDays ? `${params.deadlineDays} dias · ` : '';
    return `${totalDays}Previsão até ${dateStr} (${remLabel})${extSuffix}`;
  }
  if (typeof params.deadlineDays === 'number' && params.deadlineDays > 0) {
    return `Prazo informado: ${params.deadlineDays} dia(s)${extSuffix}`;
  }
  return 'Prazo da transportadora ainda não informado';
}
