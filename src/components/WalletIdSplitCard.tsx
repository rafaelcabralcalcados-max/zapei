import React, { useEffect, useState } from 'react';
import { CheckCircle2, Wallet } from 'lucide-react';

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
  const [draft, setDraft] = useState(currentWalletId || '');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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
              htmlFor={`wallet-id-${compact ? 'top' : 'settings'}`}
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
          id={`wallet-id-${compact ? 'top' : 'settings'}`}
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
    </div>
  );
};
