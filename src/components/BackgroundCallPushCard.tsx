import React from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  Loader2,
  Smartphone,
} from 'lucide-react';
import type { BackgroundPushStatus } from '../lib/pushService';

interface BackgroundCallPushCardProps {
  status: BackgroundPushStatus;
  busy: boolean;
  feedback?: string;
  onEnable: () => Promise<void>;
}

export const BackgroundCallPushCard: React.FC<BackgroundCallPushCardProps> = ({
  status,
  busy,
  feedback,
  onEnable,
}) => {
  const isEnabled = status === 'enabled';
  const isIosNeedsInstall = status === 'ios_needs_install';
  const isDenied = status === 'denied';
  const isUnsupported = status === 'unsupported';

  return (
    <section
      className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${
        isEnabled
          ? 'border-emerald-200 bg-emerald-50/40'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isEnabled
                ? 'bg-[#0E7A34] text-white'
                : 'bg-[#0D2B3E] text-white'
            }`}
          >
            {isEnabled ? (
              <BellRing className="h-5 w-5" />
            ) : isIosNeedsInstall ? (
              <Smartphone className="h-5 w-5" />
            ) : (
              <Bell className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 sm:text-base">
                Notificações em Segundo Plano
              </h2>
              {isEnabled && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-[#0E7A34]">
                  <CheckCircle2 className="h-3 w-3" />
                  Ativo
                </span>
              )}
            </div>

            {isEnabled && (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Alertas de mensagens, áudios, fotos e chamadas estão ativos neste aparelho, inclusive com a tela bloqueada.
              </p>
            )}

            {status === 'prompt' && (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Ative as notificações para receber avisos de mensagens e ligações em tempo real neste aparelho.
              </p>
            )}

            {isIosNeedsInstall && (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                No iPhone, adicione o ChatFi à Tela de Início para receber avisos de chamadas e mensagens com a tela bloqueada.
              </p>
            )}

            {isDenied && (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                As notificações estão desativadas nas preferências deste aparelho. Habilite as notificações do ChatFi nos ajustes do sistema para receber alertas em segundo plano.
              </p>
            )}

            {isUnsupported && (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Notificações em segundo plano não estão disponíveis neste dispositivo no momento.
              </p>
            )}

            {feedback && (
              <p className="mt-2 text-xs font-semibold text-[#0E7A34]">
                {feedback}
              </p>
            )}
          </div>
        </div>

        {(status === 'prompt' || isEnabled) && (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onEnable()}
              className={`inline-flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold transition disabled:opacity-60 ${
                isEnabled
                  ? 'border border-emerald-300 bg-white text-[#0E7A34] hover:bg-emerald-50'
                  : 'bg-[#0E7A34] text-white hover:bg-[#0B5D27]'
              }`}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ativando...
                </>
              ) : isEnabled ? (
                'Sincronizar alertas'
              ) : (
                'Ativar notificações'
              )}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
