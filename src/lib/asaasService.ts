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

export interface FormattedAsaasStatus {
  label: string;
  shortLabel: string;
  tone: 'pending' | 'confirmed' | 'partial' | 'overdue';
}

export function formatAsaasStatusLabel(rawStatus?: string): FormattedAsaasStatus {
  const normalized = (rawStatus || '').trim().toUpperCase();

  if (
    normalized === 'CONFIRMED' ||
    normalized === 'RECEIVED' ||
    normalized === 'RECEIVED_IN_CASH' ||
    normalized === 'PAYMENT_CONFIRMED' ||
    normalized === 'PAYMENT_RECEIVED' ||
    normalized === 'PAYMENT_ANTICIPATED' ||
    normalized === 'QUITADO'
  ) {
    return {
      label: 'Confirmado (Pago)',
      shortLabel: 'Confirmado',
      tone: 'confirmed',
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

