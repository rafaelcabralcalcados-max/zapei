import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Camera,
  CheckCircle2,
  FileText,
  Loader2,
  Mic,
  ShieldCheck,
} from 'lucide-react';
import type { BackgroundPushStatus } from '../lib/pushService';
import type { PolicyConsentRecord } from '../lib/policyConsent';
import {
  queryMediaPermissionSnapshot,
  type MediaPermissionSnapshot,
} from '../lib/webrtcService';

interface PrivacyAndPermissionsCardProps {
  consent: PolicyConsentRecord | null;
  pushStatus: BackgroundPushStatus;
  onOpenPolicies: () => void;
  onAuthorizeResources: () => Promise<void>;
}

export const PrivacyAndPermissionsCard: React.FC<PrivacyAndPermissionsCardProps> = ({
  consent,
  pushStatus,
  onOpenPolicies,
  onAuthorizeResources,
}) => {
  const [media, setMedia] = useState<MediaPermissionSnapshot>({
    mic: 'unknown',
    cam: 'unknown',
  });
  const [busy, setBusy] = useState(false);

  const refreshMedia = useCallback(async () => {
    const next = await queryMediaPermissionSnapshot();
    setMedia(next);
  }, []);

  useEffect(() => {
    void refreshMedia();
  }, [refreshMedia]);

  const handleAuthorize = async () => {
    setBusy(true);
    try {
      await onAuthorizeResources();
      await refreshMedia();
    } finally {
      setBusy(false);
    }
  };

  const micOk = media.mic === 'granted';
  const camOk = media.cam === 'granted';
  const notifOk = pushStatus === 'enabled';
  const allGranted = micOk && camOk && notifOk;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0F5132] text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 sm:text-base">
                Privacidade, Termos e Permissões
              </h2>
              {consent && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-[#0F5132]">
                  <CheckCircle2 className="h-3 w-3" />
                  Aceito em {consent.acceptedAtLabel}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Consulte a Política de Responsabilidade e Privacidade (LGPD) e gerencie o acesso do Zapei aos recursos de comunicação deste aparelho.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenPolicies}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <FileText className="h-4 w-4 text-[#0D2B3E]" />
            Ler políticas
          </button>

          {!allGranted && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAuthorize()}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-[#0F5132] px-4 text-xs font-bold text-white transition hover:bg-[#146c43] disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Autorizando...
                </>
              ) : (
                'Autorizar recursos'
              )}
            </button>
          )}
        </div>
      </div>

      {/* Clean Permission Indicators */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <Mic className="h-4 w-4 text-[#0F5132]" />
            Microfone
          </div>
          <span
            className={`text-[11px] font-bold ${
              micOk ? 'text-[#0F5132]' : 'text-slate-500'
            }`}
          >
            {micOk ? 'Autorizado' : 'Sob demanda'}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <Camera className="h-4 w-4 text-[#0F5132]" />
            Câmera
          </div>
          <span
            className={`text-[11px] font-bold ${
              camOk ? 'text-[#0F5132]' : 'text-slate-500'
            }`}
          >
            {camOk ? 'Autorizada' : 'Sob demanda'}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <Bell className="h-4 w-4 text-[#0F5132]" />
            Notificações
          </div>
          <span
            className={`text-[11px] font-bold ${
              notifOk ? 'text-[#0F5132]' : 'text-slate-500'
            }`}
          >
            {notifOk ? 'Ativas' : 'Desativadas'}
          </span>
        </div>
      </div>
    </section>
  );
};
