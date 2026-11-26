import { auth } from './firebase';
import type {
  AsaasSplitEntry,
  OrderSplitBreakdown,
  SplitPaymentMethod,
} from '../types/zapei';

export interface CreateAsaasChargeResult {
  ok: boolean;
  mode: 'live' | 'preview';
  asaasConfigured: boolean;
  chargeId: string;
  status: string;
  mappedPaymentStatus?: 'Aguardando' | 'Parcial' | 'Quitado' | 'Em Atraso';
  invoiceUrl?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  message?: string;
  missingWallets?: Array<{ role: 'manufacturer' | 'reseller'; uid: string; label: string }>;
  splitBreakdown: OrderSplitBreakdown;
  splitRecipients: AsaasSplitEntry[];
  asaasPayload: {
    billingType: 'PIX' | 'CREDIT_CARD';
    value: number;
    dueDate: string;
    description: string;
    externalReference: string;
    installmentCount?: number;
    totalValue?: number;
    split: Array<{ walletId: string; fixedValue: number }>;
  };
}

export interface AsaasOrderStatusResult {
  ok: boolean;
  found: boolean;
  orderId: string;
  chargeId?: string;
  asaasStatus?: string;
  mappedPaymentStatus?: 'Aguardando' | 'Parcial' | 'Quitado' | 'Em Atraso';
  invoiceUrl?: string;
  pixCopyPaste?: string;
  pixQrCode?: string;
  splitBreakdown?: OrderSplitBreakdown;
  splitRecipients?: AsaasSplitEntry[];
  lastWebhookEvent?: string;
  confirmedAtMs?: number;
}

export async function createAsaasSplitCharge(params: {
  orderId: string;
  paymentMethod: SplitPaymentMethod;
  installments?: number;
  customerInfo?: {
    name?: string;
    email?: string;
    cpfCnpj?: string;
    phone?: string;
  };
}): Promise<CreateAsaasChargeResult> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Faça login antes de gerar uma cobrança Asaas.');
  }
  const idToken = await user.getIdToken();
  const res = await fetch('/api/payments/asaas/create-charge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });

  const data = (await res.json().catch(() => ({}))) as Partial<CreateAsaasChargeResult> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Falha ao gerar cobrança Asaas (${res.status}).`);
  }
  return data as CreateAsaasChargeResult;
}

export async function fetchAsaasOrderStatus(
  orderId: string
): Promise<AsaasOrderStatusResult> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sessão inválida.');
  }
  const idToken = await user.getIdToken();
  const res = await fetch(`/api/payments/asaas/status/${encodeURIComponent(orderId)}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AsaasOrderStatusResult> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Falha ao consultar status Asaas (${res.status}).`);
  }
  return data as AsaasOrderStatusResult;
}

export type OrderCancelReason =
  | 'buyer_cancelled'
  | 'reseller_cancelled'
  | 'factory_cancelled'
  | 'expired_2h';

export interface CancelOrderResult {
  ok: boolean;
  alreadyCancelled?: boolean;
  orderId: string;
  asaasCancelled?: boolean;
  stockRestored?: boolean;
  cancelReason?: string;
  restoredItems?: Array<{
    productId: string;
    productName: string;
    boxesRestored: number;
    newStockBoxes: number;
  }>;
}

export async function cancelOrderAndReleaseStock(
  orderId: string,
  reason: OrderCancelReason
): Promise<CancelOrderResult> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sessão inválida. Faça login para cancelar o pedido.');
  }
  const idToken = await user.getIdToken();
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ reason }),
  });

  const data = (await res.json().catch(() => ({}))) as Partial<CancelOrderResult> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Falha ao cancelar pedido (${res.status}).`);
  }
  return data as CancelOrderResult;
}

export const ORDER_RESERVATION_DURATION_MS = 2 * 60 * 60 * 1000;

export function isAsaasChargePaid(rawStatus?: string): boolean {
  const normalized = (rawStatus || '').trim().toUpperCase();
  return (
    normalized === 'CONFIRMED' ||
    normalized === 'RECEIVED' ||
    normalized === 'RECEIVED_IN_CASH' ||
    normalized === 'PAYMENT_CONFIRMED' ||
    normalized === 'PAYMENT_RECEIVED' ||
    normalized === 'PAYMENT_ANTICIPATED' ||
    normalized === 'QUITADO'
  );
}

export function isOrderPaid(
  order: { asaasChargeStatus?: string; status?: string },
  payments?: Array<{ orderId: string; status: string; asaasChargeStatus?: string }>
): boolean {
  if (isAsaasChargePaid(order.asaasChargeStatus)) return true;
  if (payments && payments.length > 0) {
    return payments.some(
      (p) =>
        p.status === 'Quitado' ||
        isAsaasChargePaid(p.asaasChargeStatus)
    );
  }
  return false;
}

export function canCancelUnpaidOrder(
  order: { id: string; status: string; asaasChargeStatus?: string },
  orderPayments?: Array<{ orderId: string; status: string; asaasChargeStatus?: string }>
): boolean {
  if (
    order.status === 'cancelled' ||
    order.status === 'dispatched' ||
    order.status === 'completed'
  ) {
    return false;
  }
  return !isOrderPaid(order, orderPayments);
}

export function getOrderReservationDeadlineMs(order: {
  createdAtMs?: number;
  reservationExpiresAtMs?: number;
}): number | null {
  if (typeof order.reservationExpiresAtMs === 'number' && order.reservationExpiresAtMs > 0) {
    return order.reservationExpiresAtMs;
  }
  if (typeof order.createdAtMs === 'number' && order.createdAtMs > 0) {
    return order.createdAtMs + ORDER_RESERVATION_DURATION_MS;
  }
  return null;
}

export function formatReservationRemaining(
  deadlineMs: number | null,
  nowMs = Date.now()
): { expired: boolean; label: string } {
  if (!deadlineMs) {
    return { expired: false, label: 'Reserva válida por 2h' };
  }
  const diff = deadlineMs - nowMs;
  if (diff <= 0) {
    return { expired: true, label: 'Reserva de 2h expirada — liberando estoque' };
  }
  const totalMinutes = Math.max(1, Math.ceil(diff / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) {
    return {
      expired: false,
      label: `${hours}h ${mins.toString().padStart(2, '0')}m restantes`,
    };
  }
  return {
    expired: false,
    label: `${mins} min restantes`,
  };
}

export interface FormattedAsaasStatus {
  label: string;
  shortLabel: string;
  tone: 'pending' | 'confirmed' | 'partial' | 'overdue';
}

export function formatAsaasStatusLabel(rawStatus?: string): FormattedAsaasStatus {
  const normalized = (rawStatus || '').trim().toUpperCase();

  if (isAsaasChargePaid(normalized)) {
    return {
      label: 'Confirmado (Pago)',
      shortLabel: 'Confirmado',
      tone: 'confirmed',
    };
  }

  if (normalized === 'CANCELLED_EXPIRED') {
    return {
      label: 'Cancelado (Reserva 2h Expirada)',
      shortLabel: 'Expirado',
      tone: 'overdue',
    };
  }

  if (
    normalized === 'DELETED' ||
    normalized === 'CANCELLED' ||
    normalized === 'CANCELADO'
  ) {
    return {
      label: 'Cancelado',
      shortLabel: 'Cancelado',
      tone: 'overdue',
    };
  }

  if (normalized === 'OVERDUE' || normalized === 'PAYMENT_OVERDUE' || normalized === 'EM ATRASO') {
    return {
      label: 'Em Atraso',
      shortLabel: 'Em Atraso',
      tone: 'overdue',
    };
  }

  if (
    normalized === 'PARTIALLY_REFUNDED' ||
    normalized === 'PAYMENT_PARTIALLY_REFUNDED' ||
    normalized === 'PARCIAL'
  ) {
    return {
      label: 'Parcial',
      shortLabel: 'Parcial',
      tone: 'partial',
    };
  }

  if (normalized === 'PENDING_GATEWAY_KEY') {
    return {
      label: 'Aguardando (Prévia)',
      shortLabel: 'Aguardando',
      tone: 'pending',
    };
  }

  return {
    label: 'Aguardando Pagamento',
    shortLabel: 'Aguardando',
    tone: 'pending',
  };
}

