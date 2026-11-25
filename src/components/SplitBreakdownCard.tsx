import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, CreditCard, Info, QrCode, ShieldCheck } from 'lucide-react';
import type { OrderSplitBreakdown, SplitPaymentMethod } from '../types/zapei';
import { formatBRL } from '../lib/gradeParser';
import { formatAsaasStatusLabel } from '../lib/asaasService';
import {
  CARD_MIN_THRESHOLD_BRL,
  MINIMUM_FEE_THRESHOLD_BRL,
  PIX_GATEWAY_FEE_BRL,
  PIX_MIN_GROSS_BRL,
} from '../lib/splitCalculator';

interface SplitBreakdownCardProps {
  breakdown: OrderSplitBreakdown;
  title?: string;
  compact?: boolean;
  factoryLabel?: string;
  resellerLabel?: string;
  hideResellerIfDirect?: boolean;
  showMethodToggle?: boolean;
  asaasChargeStatus?: string;
  asaasChargeId?: string;
  onChangeMethod?: (method: SplitPaymentMethod) => void;
  onChangeInstallments?: (installments: number) => void;
}

export const SplitBreakdownCard: React.FC<SplitBreakdownCardProps> = ({
  breakdown,
  title = 'Detalhamento do Split Asaas & Taxa ChatFi',
  compact = false,
  factoryLabel = 'Fabricante (produção)',
  resellerLabel = 'Revendedor (retido / liberado)',
  hideResellerIfDirect = false,
  showMethodToggle = false,
  asaasChargeStatus,
  asaasChargeId,
  onChangeMethod,
  onChangeInstallments,
}) => {
  const showMinimumWarning =
    breakdown.orderTotal > 0 &&
    (breakdown.belowPixMinThreshold || breakdown.minimumRuleApplied);
  const chargeStatusInfo =
    asaasChargeStatus || asaasChargeId
      ? formatAsaasStatusLabel(asaasChargeStatus)
      : null;

  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-slate-50/90 ${
        compact ? 'p-3 space-y-2.5' : 'p-4 space-y-3'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#0E7A34]" />
          <h4 className="text-xs font-bold text-slate-900">{title}</h4>
        </div>

        {chargeStatusInfo && (
          <span
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold ${
              chargeStatusInfo.tone === 'confirmed'
                ? 'bg-emerald-100 text-[#0E7A34]'
                : chargeStatusInfo.tone === 'overdue'
                  ? 'bg-red-100 text-red-700'
                  : chargeStatusInfo.tone === 'partial'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-200/80 text-slate-700'
            }`}
          >
            {chargeStatusInfo.tone === 'confirmed' ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : chargeStatusInfo.tone === 'overdue' ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            Asaas: {chargeStatusInfo.shortLabel}
          </span>
        )}

        {showMethodToggle && onChangeMethod && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChangeMethod('pix')}
              className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold transition ${
                breakdown.paymentMethod === 'pix'
                  ? 'bg-[#0E7A34] text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <QrCode className="h-3 w-3" />
              Pix
            </button>
            <button
              type="button"
              onClick={() => onChangeMethod('credit_card')}
              className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold transition ${
                breakdown.paymentMethod === 'credit_card'
                  ? 'bg-[#0D2B3E] text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <CreditCard className="h-3 w-3" />
              Cartão
            </button>
            {breakdown.paymentMethod === 'credit_card' && onChangeInstallments && (
              <select
                value={breakdown.installments}
                onChange={(e) => onChangeInstallments(Number(e.target.value) || 1)}
                aria-label="Parcelas no cartão"
                className="h-7 rounded-lg border border-slate-200 bg-white px-2 font-mono text-[11px] font-semibold text-slate-800"
              >
                {Array.from({ length: 12 }, (_, idx) => idx + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}x
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {showMinimumWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            {breakdown.paymentMethod === 'pix' ? (
              <>
                <strong className="font-bold">
                  Tarifa mínima aplicada (pedido abaixo de {formatBRL(MINIMUM_FEE_THRESHOLD_BRL)}):
                </strong>{' '}
                piso bruto de <strong className="font-mono">{formatBRL(PIX_MIN_GROSS_BRL)}</strong> no
                Pix (<strong>R$ 5,00</strong> líquido garantido para o ChatFi +{' '}
                <strong className="font-mono">{formatBRL(PIX_GATEWAY_FEE_BRL)}</strong> da tarifa
                do gateway Asaas).
              </>
            ) : breakdown.minimumRuleApplied ? (
              <>
                <strong className="font-bold">
                  Tarifa mínima aplicada (abaixo de {formatBRL(CARD_MIN_THRESHOLD_BRL)} no Cartão /{' '}
                  {formatBRL(MINIMUM_FEE_THRESHOLD_BRL)} no Pix):
                </strong>{' '}
                retorno líquido mínimo garantido de <strong>R$ 5,00</strong> para o ChatFi, com todas
                as taxas e juros do cartão repassados integralmente ao comprador.
              </>
            ) : (
              <>
                <strong className="font-bold">
                  Aviso de faixa mínima ({formatBRL(MINIMUM_FEE_THRESHOLD_BRL)}):
                </strong>{' '}
                pedidos abaixo de {formatBRL(MINIMUM_FEE_THRESHOLD_BRL)} pagam o piso bruto de{' '}
                {formatBRL(PIX_MIN_GROSS_BRL)} no Pix (R$ 5,00 líquido + R$ 1,99 Pix). No Cartão de
                Crédito, aplica-se 8,5% ({formatBRL(breakdown.platformGrossFee)}) e os custos do
                cartão são repassados ao comprador.
              </>
            )}
          </div>
        </div>
      )}

      <div className="divide-y divide-slate-200/80 rounded-xl border border-slate-200 bg-white px-3 text-xs">
        <div className="flex items-center justify-between gap-2 py-2">
          <span className="text-slate-600">{factoryLabel}</span>
          <span className="font-mono font-bold text-[#0D2B3E] tabular-nums">
            {formatBRL(breakdown.factoryNetTotal)}
          </span>
        </div>

        {!(breakdown.isDirectManufacturerSale && hideResellerIfDirect) && (
          <div className="flex items-center justify-between gap-2 py-2">
            <span className="text-slate-600">
              {breakdown.isDirectManufacturerSale
                ? 'Revendedor (venda direta de fábrica)'
                : resellerLabel}
            </span>
            <span className="font-mono font-bold text-[#0E7A34] tabular-nums">
              {formatBRL(breakdown.resellerNetTotal)}
            </span>
          </div>
        )}

        <div className="py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-700">
              Taxa da plataforma ChatFi (
              {breakdown.minimumRuleApplied
                ? breakdown.paymentMethod === 'pix'
                  ? 'piso bruto R$ 6,99'
                  : 'mínimo R$ 5,00'
                : '8,5%'}
              )
            </span>
            <span className="font-mono font-bold text-slate-900 tabular-nums">
              {formatBRL(breakdown.platformGrossFee)}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {breakdown.paymentMethod === 'pix'
              ? `Líquido ChatFi: ${formatBRL(breakdown.platformNetFee)} + Tarifa Pix Asaas: ${formatBRL(breakdown.gatewayFee)}`
              : `Líquido ChatFi preservado: ${formatBRL(breakdown.platformNetFee)} (efetivo ${breakdown.effectivePlatformRatePct.toFixed(2)}%)`}
          </p>
        </div>

        {breakdown.paymentMethod === 'credit_card' && (
          <div className="py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-600">
                Taxas + juros do cartão (repassados ao comprador)
              </span>
              <span className="font-mono font-semibold text-[#F97316] tabular-nums">
                +{formatBRL(breakdown.cardFeePassedToBuyer)}
              </span>
            </div>
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
              <Info className="h-3 w-3 shrink-0" />
              MDR {(breakdown.cardBaseMdrRate * 100).toFixed(2)}%
              {breakdown.cardInstallmentInterestRate > 0
                ? ` + parcelamento ${(breakdown.cardInstallmentInterestRate * 100).toFixed(2)}%`
                : ' (à vista)'}{' '}
              + {formatBRL(breakdown.cardFixedFee)} fixo Asaas
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 py-2.5 bg-slate-50/60 -mx-3 px-3 rounded-b-xl">
          <div>
            <span className="block font-bold text-slate-900">
              {breakdown.paymentMethod === 'credit_card'
                ? 'Total final no Cartão (comprador)'
                : 'Total final no Pix (comprador)'}
            </span>
            {breakdown.paymentMethod === 'credit_card' && breakdown.installments > 1 && (
              <span className="block font-mono text-[10px] text-slate-500 tabular-nums">
                {breakdown.installments}x de {formatBRL(breakdown.installmentValue)}
              </span>
            )}
          </div>
          <span className="font-mono text-sm font-extrabold text-[#0E7A34] tabular-nums">
            {formatBRL(breakdown.buyerChargedTotal)}
          </span>
        </div>
      </div>
    </div>
  );
};
