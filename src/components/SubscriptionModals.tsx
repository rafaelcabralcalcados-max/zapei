import React, { useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Factory,
  QrCode,
  ShieldCheck,
  Store,
  X,
} from 'lucide-react';
import type { CommercialMode, UserProfile } from '../types/zapei';
import { formatCpfMask, isValidCpf } from '../lib/cpfAndDeviceUtils';

interface CommercialTrialModalProps {
  targetRole: Extract<CommercialMode, 'manufacturer' | 'reseller'>;
  defaultBusinessName?: string;
  alreadyOnPlan?: boolean;
  cpfAlreadyVerified?: boolean;
  onConfirm: (businessName: string, cpfRaw?: string) => Promise<void>;
  onCancel: () => void;
  onOpenHelp?: () => void;
}

export const CommercialTrialModal: React.FC<CommercialTrialModalProps> = ({
  targetRole,
  defaultBusinessName = '',
  alreadyOnPlan = false,
  cpfAlreadyVerified = false,
  onConfirm,
  onCancel,
  onOpenHelp,
}) => {
  const [businessName, setBusinessName] = useState(defaultBusinessName);
  const [cpfInput, setCpfInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isRestrictedError, setIsRestrictedError] = useState(false);
  const [busy, setBusy] = useState(false);

  const isFactory = targetRole === 'manufacturer';
  const cpfValid = cpfAlreadyVerified || isValidCpf(cpfInput);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsRestrictedError(false);

    const cleaned = businessName.trim();
    if (cleaned.length < 2) {
      setErrorMsg('Informe o nome comercial com pelo menos 2 caracteres.');
      return;
    }
    if (!cpfAlreadyVerified && !isValidCpf(cpfInput)) {
      setErrorMsg('Informe um CPF válido (11 dígitos) para liberar a atuação como Anunciante ou Revendedor.');
      return;
    }

    setBusy(true);
    try {
      await onConfirm(cleaned, cpfAlreadyVerified ? undefined : cpfInput);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Não foi possível ativar este modo comercial agora.';
      setErrorMsg(msg);
      if (/suspens|bloquead|restri/i.test(msg)) {
        setIsRestrictedError(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-sm">
      <form
        onSubmit={handleConfirm}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-[#0E7A34]">
            {isFactory ? <Factory className="h-6 w-6" /> : <Store className="h-6 w-6" />}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fechar"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <h2 className="mt-4 text-lg font-bold text-slate-900">
          {isFactory ? 'Ativar Sou Anunciante / Fabricante' : 'Ativar Sou Revendedor'}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {alreadyOnPlan ? (
            <>Confirme os dados abaixo para abrir seu painel comercial agora.</>
          ) : (
            <>
              <strong>30 dias grátis sem cartão.</strong> Depois apenas{' '}
              <strong>R$ 59,90/mês</strong> — sem perder suas conversas se não renovar.
            </>
          )}
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="zapei-business-name"
              className="block text-xs font-bold text-slate-800"
            >
              {isFactory ? 'Nome do seu negócio / anunciante' : 'Nome da sua vitrine / loja'}
            </label>
            <input
              id="zapei-business-name"
              type="text"
              autoFocus
              required
              minLength={2}
              maxLength={80}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder={isFactory ? 'Ex: Loja Central ou João Motos' : 'Ex: Vitrine Ana'}
              className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#0E7A34] focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/15"
            />
          </div>

          {!cpfAlreadyVerified ? (
            <div>
              <label
                htmlFor="zapei-commercial-cpf"
                className="block text-xs font-bold text-slate-800"
              >
                CPF do responsável <span className="text-red-600">*</span>
              </label>
              <input
                id="zapei-commercial-cpf"
                type="text"
                inputMode="numeric"
                required
                value={cpfInput}
                onChange={(e) => {
                  setErrorMsg('');
                  setCpfInput(formatCpfMask(e.target.value));
                }}
                placeholder="000.000.000-00"
                className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 font-mono text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#0E7A34] focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/15"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Obrigatório para Anunciantes e Revendedores. Validado de forma criptografada (SHA-256)
                e nunca exibido publicamente na sua vitrine.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs font-medium text-[#0E7A34]">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>CPF já validado e vinculado à sua conta.</span>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700">
            <p className="font-medium leading-relaxed">{errorMsg}</p>
            {isRestrictedError && onOpenHelp && (
              <button
                type="button"
                onClick={() => {
                  onCancel();
                  onOpenHelp();
                }}
                className="mt-2 font-bold text-[#0D2B3E] underline hover:no-underline"
              >
                Solicitar revisão na Central de Ajuda
              </button>
            )}
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0E7A34]" />
          <span>
            {isFactory
              ? 'Seu painel já abre pronto para anunciar itens de qualquer categoria com foto, preço e detalhes sob medida.'
              : 'Seu painel já abre pronto para conectar fornecedores pelo telefone e vender com sua marca.'}
          </span>
        </div>

        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 flex-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || businessName.trim().length < 2 || !cpfValid}
            className="h-12 flex-1 rounded-xl bg-[#0E7A34] text-xs font-bold text-white hover:bg-[#0B5D27] disabled:opacity-50"
          >
            {busy ? 'Validando...' : 'Ativar e abrir painel'}
          </button>
        </div>
      </form>
    </div>
  );
};

interface BillingManageModalProps {
  profile: UserProfile;
  onRenewSubscription: (method: 'pix' | 'card') => Promise<void>;
  onClose: () => void;
}

export const BillingManageModal: React.FC<BillingManageModalProps> = ({
  profile,
  onRenewSubscription,
  onClose,
}) => {
  const [method, setMethod] = useState<'pix' | 'card'>('pix');
  const [busy, setBusy] = useState(false);

  const handleRenew = async () => {
    setBusy(true);
    try {
      await onRenewSubscription(method);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-sm">
      <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            Assinatura Comercial ChatFi
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Status atual</span>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                profile.subscriptionStatus === 'active'
                  ? 'bg-emerald-100 text-[#0E7A34]'
                  : profile.subscriptionStatus === 'trial'
                    ? 'bg-blue-100 text-[#0D2B3E]'
                    : 'bg-orange-100 text-orange-800'
              }`}
            >
              {profile.subscriptionStatus === 'active'
                ? 'Plano Comercial Ativo'
                : profile.subscriptionStatus === 'trial'
                  ? `Teste Grátis (${profile.trialDaysLeft} dias restantes)`
                  : 'Vitrine Pausada'}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xs text-slate-500">Plano Mensal (Anunciante / Revendedor)</span>
            <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
              R$ 59,90/mês
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Mensagens, chamadas de áudio/vídeo e histórico financeiro permanecem gratuitos mesmo se a vitrine for pausada.
          </p>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-semibold text-slate-700">
            Forma de pagamento para ativar/renovar
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setMethod('pix')}
              className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-xs font-semibold transition ${
                method === 'pix'
                  ? 'border-[#0E7A34] bg-emerald-50 text-[#0E7A34]'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <QrCode className="h-4 w-4" />
              Pix Instantâneo
            </button>
            <button
              type="button"
              onClick={() => setMethod('card')}
              className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-xs font-semibold transition ${
                method === 'card'
                  ? 'border-[#0E7A34] bg-emerald-50 text-[#0E7A34]'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <CreditCard className="h-4 w-4" />
              Cartão de Crédito
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50/70 p-3 text-xs text-[#0E7A34]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Ao confirmar, sua assinatura comercial ficará ativa imediatamente em sua conta.
          </span>
        </div>

        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => void handleRenew()}
            disabled={busy}
            className="h-11 flex-1 rounded-xl bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
          >
            {busy ? 'Processando...' : 'Ativar Plano R$ 59,90'}
          </button>
        </div>
      </div>
    </div>
  );
};
