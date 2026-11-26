import React, { useState } from 'react';
import { CheckCircle2, FileWarning, Star, X } from 'lucide-react';
import type { CommercialReview, TargetCommercialRole } from '../types/zapei';
import { DELIVERY_REPORT_REASONS } from '../lib/supportConfig';

export interface ReviewModalTarget {
  orderId: string;
  orderCode: string;
  subOrderId?: string;
  targetUid: string;
  targetName: string;
  targetRole: TargetCommercialRole;
  reviewerRole: 'buyer' | 'reseller';
  existingReview?: CommercialReview;
}

export interface ReportModalTarget {
  orderId: string;
  orderCode: string;
  subOrderId?: string;
  subOrderCode?: string;
  reportedUid: string;
  reportedName: string;
  reportedRole: TargetCommercialRole;
  reporterRole: 'buyer' | 'reseller';
}

interface StarReviewModalProps {
  target: ReviewModalTarget | null;
  onClose: () => void;
  onSubmitReview: (params: {
    orderId: string;
    orderCode: string;
    subOrderId?: string;
    targetUid: string;
    targetName: string;
    targetRole: TargetCommercialRole;
    reviewerRole: 'buyer' | 'reseller';
    stars: 1 | 2 | 3 | 4 | 5;
    comment: string;
  }) => Promise<void>;
}

const STAR_LABELS: Record<number, string> = {
  1: 'Insatisfatório',
  2: 'Regular',
  3: 'Bom',
  4: 'Muito bom',
  5: 'Excelente',
};

export const StarReviewModal: React.FC<StarReviewModalProps> = ({
  target,
  onClose,
  onSubmitReview,
}) => {
  const [stars, setStars] = useState<1 | 2 | 3 | 4 | 5>(
    target?.existingReview?.stars ?? 5
  );
  const [comment, setComment] = useState<string>(
    target?.existingReview?.comment ?? ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!target) return null;

  const roleLabel =
    target.targetRole === 'manufacturer' ? 'Fabricante' : 'Revendedor';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      await onSubmitReview({
        orderId: target.orderId,
        orderCode: target.orderCode,
        subOrderId: target.subOrderId,
        targetUid: target.targetUid,
        targetName: target.targetName,
        targetRole: target.targetRole,
        reviewerRole: target.reviewerRole,
        stars,
        comment: comment.trim(),
      });
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Não foi possível enviar sua avaliação. Tente novamente.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0E7A34]">
              Avaliação de {roleLabel}
            </p>
            <h2 className="mt-0.5 text-base font-bold text-slate-900">
              {target.targetName}
            </h2>
            <p className="text-xs text-slate-500">
              Pedido <span className="font-mono font-semibold">{target.orderCode}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar avaliação"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
            <p className="text-xs font-semibold text-slate-700">
              Como foi a entrega e o atendimento deste {roleLabel.toLowerCase()}?
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              {([1, 2, 3, 4, 5] as const).map((val) => {
                const active = val <= stars;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStars(val)}
                    aria-label={`${val} estrela${val > 1 ? 's' : ''}`}
                    className="rounded-lg p-1.5 transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <Star
                      className={`h-8 w-8 transition ${
                        active
                          ? 'fill-amber-400 text-amber-500'
                          : 'text-slate-300'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs font-semibold text-amber-700">
              {stars}/5 — {STAR_LABELS[stars]}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Comentário opcional
            </label>
            <textarea
              rows={3}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Conte brevemente sobre prazo de despacho, grade/produto e atendimento..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#0E7A34] focus:outline-none"
            />
            <p className="mt-1 text-right text-[11px] text-slate-400">
              {comment.length}/500
            </p>
          </div>

          {errorMsg && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#0E7A34] px-4 text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" />
              {submitting
                ? 'Enviando...'
                : target.existingReview
                  ? 'Atualizar Avaliação'
                  : 'Enviar Avaliação'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface DeliveryReportModalProps {
  target: ReportModalTarget | null;
  onClose: () => void;
  onSubmitReport: (params: {
    orderId: string;
    orderCode: string;
    subOrderId?: string;
    subOrderCode?: string;
    reportedUid: string;
    reportedName: string;
    reportedRole: TargetCommercialRole;
    reporterRole: 'buyer' | 'reseller';
    reason: string;
    description: string;
  }) => Promise<{ reportCode: string; ticketCode: string }>;
}

export const DeliveryReportModal: React.FC<DeliveryReportModalProps> = ({
  target,
  onClose,
  onSubmitReport,
}) => {
  const [reason, setReason] = useState(DELIVERY_REPORT_REASONS[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedInfo, setSubmittedInfo] = useState<{
    reportCode: string;
    ticketCode: string;
  } | null>(null);

  if (!target) return null;

  const roleLabel =
    target.reportedRole === 'manufacturer' ? 'Fabricante' : 'Revendedor';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (description.trim().length < 10) {
      setErrorMsg('Descreva o ocorrido com pelo menos 10 caracteres para nossa equipe analisar.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await onSubmitReport({
        orderId: target.orderId,
        orderCode: target.orderCode,
        subOrderId: target.subOrderId,
        subOrderCode: target.subOrderCode,
        reportedUid: target.reportedUid,
        reportedName: target.reportedName,
        reportedRole: target.reportedRole,
        reporterRole: target.reporterRole,
        reason,
        description: description.trim(),
      });
      setSubmittedInfo(res);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Não foi possível registrar a ocorrência agora. Tente novamente.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <FileWarning className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Registrar ocorrência na entrega
              </h2>
              <p className="text-xs text-slate-500">
                {roleLabel}: <span className="font-semibold text-slate-700">{target.reportedName}</span> ·{' '}
                <span className="font-mono">{target.subOrderCode || target.orderCode}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar registro de ocorrência"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {submittedInfo ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-slate-700">
              <p className="font-bold text-[#0E7A34]">
                Ocorrência registrada e vinculada ao atendimento
              </p>
              <p className="mt-1.5 leading-relaxed">
                Protocolo da ocorrência:{' '}
                <span className="font-mono font-bold text-slate-900">
                  {submittedInfo.reportCode}
                </span>
                <br />
                Chamado na Central de Ajuda:{' '}
                <span className="font-mono font-bold text-slate-900">
                  {submittedInfo.ticketCode}
                </span>
              </p>
              <p className="mt-2 text-slate-600">
                Nossa equipe analisará o histórico do pedido junto ao {roleLabel.toLowerCase()} e
                atualizará o andamento na sua Central de Ajuda.
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] rounded-xl bg-[#0D2B3E] px-5 text-xs font-semibold text-white hover:bg-[#163D56]"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
              Use este formulário caso o {roleLabel.toLowerCase()} tenha deixado de cumprir a
              entrega ou apresentado conduta de má-fé neste pedido. Um chamado será aberto
              automaticamente na Central de Ajuda para apuração.
            </p>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Motivo da ocorrência
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 focus:border-[#0E7A34] focus:outline-none"
              >
                {DELIVERY_REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Detalhes da ocorrência
              </label>
              <textarea
                rows={4}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Informe datas combinadas, divergências no envio ou ausência de despacho..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 focus:border-[#0E7A34] focus:outline-none"
              />
            </div>

            {errorMsg && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {errorMsg}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[42px] rounded-xl bg-[#0D2B3E] px-4 text-xs font-semibold text-white hover:bg-[#163D56] disabled:opacity-60"
              >
                {submitting ? 'Registrando...' : 'Registrar Ocorrência'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
