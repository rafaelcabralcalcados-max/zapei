import React, { useEffect, useId, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  HelpCircle,
  Wallet,
} from 'lucide-react';

interface WalletIdSplitCardProps {
  currentWalletId?: string;
  onSaveWalletId: (walletId: string) => Promise<void>;
  compact?: boolean;
  roleHint?: string;
}

export const WalletIdSplitCard: React.FC<WalletIdSplitCardProps> = ({
  currentWalletId,
  onSaveWalletId,
  compact = false,
  roleHint,
}) => {
  const inputId = useId();
  const [draft, setDraft] = useState(currentWalletId || '');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    setDraft(currentWalletId || '');
  }, [currentWalletId]);

  const savedValue = (currentWalletId || '').trim();
  const isSaved = savedValue.length > 0;

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setErrorMsg('Informe sua Wallet ID Asaas antes de salvar.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    setJustSaved(false);
    try {
      await onSaveWalletId(trimmed);
      setJustSaved(true);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Não foi possível salvar sua Wallet ID Asaas.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white ${
        compact ? 'p-3.5 space-y-2.5' : 'p-4 sm:p-5 space-y-3'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#0E7A34]">
            <Wallet className="h-4 w-4" />
          </div>
          <div>
            <label
              htmlFor={inputId}
              className="block text-xs sm:text-sm font-bold text-slate-900"
            >
              Wallet ID Asaas (Recebimento Split)
            </label>
            {roleHint && (
              <p className="text-[11px] text-slate-500">{roleHint}</p>
            )}
          </div>
        </div>

        <span
          className={`text-[11px] font-semibold ${
            isSaved ? 'text-[#0E7A34]' : 'text-amber-700'
          }`}
        >
          {isSaved ? 'Configurada' : 'Pendente'}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (justSaved) setJustSaved(false);
            if (errorMsg) setErrorMsg('');
          }}
          placeholder="Ex: f2a9d6a0-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="h-11 flex-1 rounded-xl border border-slate-200 bg-slate-50/50 px-3 font-mono text-xs text-slate-900 focus:border-[#0E7A34] focus:bg-white focus:outline-none"
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="h-11 shrink-0 rounded-xl bg-[#0E7A34] px-4 text-xs font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar Wallet ID'}
        </button>
      </div>

      {errorMsg && (
        <p className="text-xs font-semibold text-red-700">{errorMsg}</p>
      )}

      {(justSaved || isSaved) && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-[#0E7A34]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            {justSaved
              ? `Wallet ID Asaas salva com sucesso (${savedValue})! Seus recebimentos via Split já estão ativos.`
              : `Wallet ID Asaas salva e ativa para recebimento Split: ${savedValue}`}
          </span>
        </div>
      )}

      {/* Discreet Help Toggle & Direct Asaas Link */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <button
          type="button"
          aria-expanded={showGuide}
          onClick={() => setShowGuide((prev) => !prev)}
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-[#0D2B3E] transition hover:bg-slate-100"
        >
          <HelpCircle className="h-3.5 w-3.5 text-[#0E7A34]" />
          <span>Como conseguir meu Wallet ID?</span>
          {showGuide ? (
            <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
          )}
        </button>

        <a
          href="https://www.asaas.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-[#0D2B3E] transition hover:bg-slate-100"
        >
          <span>Abrir site do Asaas ↗</span>
        </a>
      </div>

      {showGuide && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-3 text-xs text-slate-700">
          <p className="font-bold text-slate-900">
            Passo a passo para encontrar seu Wallet ID no Asaas:
          </p>
          <ol className="space-y-2">
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0E7A34] font-mono text-[11px] font-bold text-white">
                1
              </span>
              <span>
                Acesse <strong>asaas.com</strong> (ou abra o app Asaas) e crie sua conta gratuita com CPF ou CNPJ.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0E7A34] font-mono text-[11px] font-bold text-white">
                2
              </span>
              <span>
                No menu do Asaas, vá em <strong>Configurações da Conta → Integrações</strong> (ou <strong>Minha Conta → Dados da Conta</strong>).
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0E7A34] font-mono text-[11px] font-bold text-white">
                3
              </span>
              <span>
                Copie o código chamado <strong>Wallet ID</strong> (um código longo com letras, números e traços).
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0E7A34] font-mono text-[11px] font-bold text-white">
                4
              </span>
              <span>
                Volte aqui no ChatFi, cole o código no campo acima e clique em <strong>Salvar Wallet ID</strong>.
              </span>
            </li>
          </ol>

          <a
            href="https://www.asaas.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#0D2B3E] px-4 text-xs font-semibold text-white transition hover:bg-[#143d57] sm:w-auto"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir site do Asaas ↗
          </a>
        </div>
      )}
    </div>
  );
};

