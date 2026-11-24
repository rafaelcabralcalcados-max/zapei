import React from 'react';
import { CheckCircle2, FileText, ShieldCheck } from 'lucide-react';
import type { PolicyConsentRecord } from '../lib/policyConsent';

interface PrivacyAndPermissionsCardProps {
  consent: PolicyConsentRecord | null;
  onOpenPolicies: () => void;
}

export const PrivacyAndPermissionsCard: React.FC<PrivacyAndPermissionsCardProps> = ({
  consent,
  onOpenPolicies,
}) => {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0E7A34] text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 sm:text-base">
                Privacidade e Termos de Uso
              </h2>
              {consent && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-[#0E7A34]">
                  <CheckCircle2 className="h-3 w-3" />
                  Aceito em {consent.acceptedAtLabel}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Consulte a Política de Responsabilidade e a Política de Privacidade (LGPD) do ChatFi.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={onOpenPolicies}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <FileText className="h-4 w-4 text-[#0D2B3E]" />
            Ler políticas
          </button>
        </div>
      </div>
    </section>
  );
};
