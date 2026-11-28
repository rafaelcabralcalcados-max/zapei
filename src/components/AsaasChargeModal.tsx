import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  QrCode,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { OrderSplitBreakdown } from '../types/zapei';
import { formatBRL } from '../lib/gradeParser';
import {
  formatAsaasStatusLabel,
  type AsaasOrderStatusResult,
  type CreateAsaasChargeResult,
} from '../lib/asaasService';

export interface AsaasChargeModalData {
  orderId: string;
  orderCode: string;
  mode: 'live' | 'preview';
  chargeId: string;
  asaasStatus?: string;
  invoiceUrl?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  message?: string;
  missingWallets?: Array<{ role: 'manufacturer' | 'reseller'; uid: string; label: string }>;
  splitBreakdown: OrderSplitBreakdown;
  hideResellerShare?: boolean;
  hideSplitExtract?: boolean;
}

interface AsaasChargeModalProps {
  isOpen: boolean;
  data: AsaasChargeModalData | null;
  onClose: () => void;
  onVerifyStatus: (orderId: string) => Promise<AsaasOrderStatusResult | null>;
  onCopySuccess?: (message: string) => void;
}

export const AsaasChargeModal: React.FC<AsaasChargeModalProps> = ({
  isOpen,
  data,
  onClose,
  onVerifyStatus,
  onCopySuccess,
}) => {
  const [generatedQrUrl, setGeneratedQrUrl] = useState<string>('');
  const [copiedPix, setCopiedPix] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState('');
  const [liveOverride, setLiveOverride] = useState<{
    asaasStatus?: string;
    invoiceUrl?: string;
    pixQrCode?: string;
    pixCopyPaste?: string;
  } | null>(null);

  useEffect(() => {
    setLiveOverride(null);
    setStatusFeedback('');
    setCopiedPix(false);
  }, [data?.orderId, data?.chargeId]);

  const effectiveStatus = liveOverride?.asaasStatus ?? data?.asaasStatus;
  const effectiveInvoiceUrl = liveOverride?.invoiceUrl ?? data?.invoiceUrl;
  const effectivePixQr = liveOverride?.pixQrCode ?? data?.pixQrCode;
  const effectivePixCopyPaste = liveOverride?.pixCopyPaste ?? data?.pixCopyPaste;

  useEffect(() => {
    let active = true;
    if (!isOpen || !data) {
      setGeneratedQrUrl('');
      return;
    }

    if (effectivePixQr) {
      setGeneratedQrUrl(effectivePixQr);
      return;
    }

    if (effectivePixCopyPaste) {
      QRCode.toDataURL(effectivePixCopyPaste, {
        width: 240,
        margin: 1,
        color: { dark: '#0D2B3E', light: '#FFFFFF' },
      })
        .then((url) => {
          if (active) setGeneratedQrUrl(url);
        })
        .catch(() => {
          if (active) setGeneratedQrUrl('');
        });
    } else {
      setGeneratedQrUrl('');
    }

    return () => {
      active = false;
    };
  }, [isOpen, data, effectivePixQr, effectivePixCopyPaste]);

  if (!isOpen || !data) return null;

  const statusInfo = formatAsaasStatusLabel(effectiveStatus);
  const breakdown = data.splitBreakdown;

  const handleCopyPix = async () => {
    const fallbackPrefix = data.hideSplitExtract ? 'PIX-PEDIDO' : 'ASAAS-SPLIT-PREVIEW';
    const payload =
      effectivePixCopyPaste ||
      `${fallbackPrefix}:${data.chargeId}|ORDER:${data.orderCode}|TOTAL:${breakdown.buyerChargedTotal.toFixed(2)}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedPix(true);
      onCopySuccess?.('Código Pix Copia e Cola copiado!');
      window.setTimeout(() => setCopiedPix(false), 2500);
    } catch {
      setStatusFeedback('Não foi possível acessar a área de transferência.');
    }
  };

  const handleCheckStatus = async () => {
    setChecking(true);
    setStatusFeedback('');
    try {
      const res = await onVerifyStatus(data.orderId);
      if (res && res.found) {
        setLiveOverride({
          asaasStatus: res.asaasStatus || res.mappedPaymentStatus,
          invoiceUrl: res.invoiceUrl || effectiveInvoiceUrl,
          pixQrCode: res.pixQrCode || effectivePixQr,
          pixCopyPaste: res.pixCopyPaste || effectivePixCopyPaste,
        });
        const nextStatus = formatAsaasStatusLabel(
          res.asaasStatus || res.mappedPaymentStatus
        );
        setStatusFeedback(
          `Status consultado no servidor Asaas: ${nextStatus.label}`
        );
      } else {
        setStatusFeedback(
          'Cobrança ainda não encontrada no servidor Asaas para este pedido.'
        );
      }
    } catch (err) {
      setStatusFeedback(
        err instanceof Error ? err.message : 'Erro ao consultar status no Asaas.'
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3.5 sm:p-5 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="asaas-modal-title"
    >
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 shrink-0 text-[#0E7A34]" />
              <h2
                id="asaas-modal-title"
                className="truncate text-base font-bold text-slate-900"
              >
                {data.hideSplitExtract
                  ? `Pagamento · Pedido ${data.orderCode}`
                  : `Pagamento Asaas · Pedido ${data.orderCode}`}
              </h2>
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              Cobrança: {data.chargeId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de pagamento"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Amount & Status Summary */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {breakdown.paymentMethod === 'credit_card'
                  ? `Cartão de Crédito (${breakdown.installments}x)`
                  : 'Pix à vista'}
              </span>
              <span className="font-mono text-2xl font-extrabold text-[#0E7A34] tabular-nums">
                {formatBRL(breakdown.buyerChargedTotal)}
              </span>
              {breakdown.paymentMethod === 'credit_card' && breakdown.installments > 1 && (
                <span className="block font-mono text-[11px] text-slate-600 tabular-nums">
                  {breakdown.installments}x de {formatBRL(breakdown.installmentValue)}
                </span>
              )}
            </div>

            <div className="text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Status Asaas
              </span>
              <span
                className={`mt-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${
                  statusInfo.tone === 'confirmed'
                    ? 'bg-emerald-100 text-[#0E7A34]'
                    : statusInfo.tone === 'overdue'
                      ? 'bg-red-100 text-red-700'
                      : statusInfo.tone === 'partial'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200/80 text-slate-800'
                }`}
              >
                {statusInfo.tone === 'confirmed' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : statusInfo.tone === 'overdue' ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <Clock className="h-3.5 w-3.5" />
                )}
                {statusInfo.label}
              </span>
            </div>
          </div>

          {data.message && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
              {data.hideSplitExtract &&
              /split|wallet|fabricante|vendedor|revendedor/i.test(data.message)
                ? 'Pagamento pronto. Utilize o QR Code Pix ou abra a fatura abaixo para concluir seu pedido.'
                : data.message}
            </div>
          )}

          {!data.hideSplitExtract && data.missingWallets && data.missingWallets.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Wallet ID Asaas pendente para:{' '}
                <strong>{data.missingWallets.map((w) => w.label).join(', ')}</strong>.
              </span>
            </div>
          )}

          {/* QR Code Pix Display */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 text-center space-y-2.5">
            {generatedQrUrl ? (
              <>
                <img
                  src={generatedQrUrl}
                  alt="QR Code Pix Asaas"
                  className="h-48 w-48 rounded-xl border border-slate-100 object-contain p-1"
                />
                <p className="text-xs font-medium text-slate-600">
                  Aponte a câmera do app do seu banco para pagar via Pix.
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center py-4 space-y-2">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                  <QrCode className="h-10 w-10" />
                </div>
                <p className="text-xs font-semibold text-slate-800">
                  {data.mode === 'preview'
                    ? 'QR Code Pix em modo de preparação (sem ASAAS_API_KEY ativa no servidor)'
                    : breakdown.paymentMethod === 'credit_card'
                      ? 'Pagamento via Cartão de Crédito selecionado'
                      : 'QR Code Pix indisponível para esta cobrança'}
                </p>
                <p className="max-w-xs text-[11px] text-slate-500">
                  Use o botão &ldquo;Abrir Fatura / Pagar com Cartão&rdquo; ou copie o código Pix abaixo quando emitido em produção/sandbox Asaas.
                </p>
              </div>
            )}
          </div>

          {/* Primary Action Buttons */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void handleCopyPix()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0E7A34] px-4 text-xs font-semibold text-white transition hover:bg-[#0B5D27]"
            >
              {copiedPix ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Código Pix Copiado!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copiar Código Pix
                </>
              )}
            </button>

            {effectiveInvoiceUrl ? (
              <a
                href={effectiveInvoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D2B3E] px-4 text-xs font-semibold text-white transition hover:bg-[#143d57]"
              >
                <CreditCard className="h-4 w-4" />
                Abrir Fatura / Pagar com Cartão
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Link da fatura disponível após configurar ASAAS_API_KEY no servidor"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 text-xs font-semibold text-slate-500 cursor-not-allowed"
              >
                <CreditCard className="h-4 w-4" />
                Abrir Fatura / Pagar com Cartão
              </button>
            )}
          </div>

          {/* Real-time Status Polling Button */}
          <button
            type="button"
            disabled={checking}
            onClick={() => void handleCheckStatus()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#0D2B3E]/20 bg-slate-50 px-4 text-xs font-bold text-[#0D2B3E] transition hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Consultando Asaas...' : 'Já paguei / Verificar Status'}
          </button>

          {statusFeedback && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-[#0E7A34]">
              {statusFeedback}
            </div>
          )}

          {/* Split Transparency Extract (Internal Seller Panels Only — hidden for buyers) */}
          {!data.hideSplitExtract && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-xs">
              <p className="font-bold text-slate-900">
                Extrato Transparente do Split Asaas
              </p>
              <div className="divide-y divide-slate-200/80 rounded-xl border border-slate-200 bg-white px-3">
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-600">Líquido Fabricante</span>
                  <span className="font-mono font-bold text-[#0D2B3E] tabular-nums">
                    {formatBRL(breakdown.factoryNetTotal)}
                  </span>
                </div>
                {!(breakdown.isDirectManufacturerSale && data.hideResellerShare) && (
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-600">Líquido Vendedor</span>
                    <span className="font-mono font-bold text-[#0E7A34] tabular-nums">
                      {formatBRL(breakdown.resellerNetTotal)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-600">
                    Taxa ChatFi ({breakdown.minimumRuleApplied ? 'tarifa mínima' : '8,5%'})
                  </span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {formatBRL(breakdown.platformGrossFee)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export function toAsaasChargeModalData(
  res: CreateAsaasChargeResult,
  orderCode: string,
  orderId: string,
  hideResellerShare = false,
  hideSplitExtract = false
): AsaasChargeModalData {
  return {
    orderId,
    orderCode,
    mode: res.mode,
    chargeId: res.chargeId,
    asaasStatus: res.status,
    invoiceUrl: res.invoiceUrl,
    pixQrCode: res.pixQrCode,
    pixCopyPaste: res.pixCopyPaste,
    message: res.message,
    missingWallets: res.missingWallets,
    splitBreakdown: res.splitBreakdown,
    hideResellerShare,
    hideSplitExtract,
  };
}
