import React from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Loader2,
  Smartphone,
  Volume2,
} from 'lucide-react';
import type { BackgroundPushStatus } from '../lib/pushService';
import { testMessageNotificationSound, testRingtoneSound } from '../lib/webrtcService';

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
          ? 'border-emerald-200 bg-emerald-50/60'
          : isDenied || isIosNeedsInstall
            ? 'border-amber-200 bg-amber-50/60'
            : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isEnabled
                ? 'bg-[#0F5132] text-white'
                : isDenied || isIosNeedsInstall
                  ? 'bg-amber-500 text-white'
                  : 'bg-[#0D2B3E] text-white'
            }`}
          >
            {isEnabled ? (
              <BellRing className="h-5 w-5" />
            ) : isIosNeedsInstall ? (
              <Smartphone className="h-5 w-5" />
            ) : isDenied ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <Bell className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                Toque com App Fechado e Tela Bloqueada
              </h2>
              {isEnabled && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-[#0F5132]">
                  <CheckCircle2 className="h-3 w-3" />
                  Ativo neste aparelho
                </span>
              )}
            </div>

            {isEnabled && (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Tudo pronto neste aparelho. Quando chegar uma <strong>mensagem de texto, áudio, foto</strong> ou <strong>ligação</strong> mesmo com a tela bloqueada, o celular toca, vibra e mostra o aviso.
              </p>
            )}

            {status === 'prompt' && (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Toque ao lado para o telefone tocar e vibrar igual ao WhatsApp sempre que chegar mensagem de texto, áudio ou ligação com a tela bloqueada.
              </p>
            )}

            {isIosNeedsInstall && (
              <p className="mt-1 text-xs leading-relaxed text-amber-900">
                No iPhone, toque no botão <strong>Compartilhar</strong> do Safari, selecione <strong>Adicionar à Tela de Início</strong> e abra o Zapei pelo ícone para receber chamadas com o app fechado.
              </p>
            )}

            {isDenied && (
              <p className="mt-1 text-xs leading-relaxed text-amber-900">
                As notificações estão bloqueadas no navegador. Toque no ícone de cadeado ao lado do endereço do site, permita <strong>Notificações</strong> e recarregue o Zapei.
              </p>
            )}

            {isUnsupported && (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Este navegador não suporta alertas com o aplicativo fechado. Abra o Zapei no Chrome (Android), Edge ou Safari instalado no iPhone.
              </p>
            )}

            {feedback && (
              <p className="mt-2 text-xs font-semibold text-[#0F5132]">
                {feedback}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => testRingtoneSound()}
            className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Volume2 className="h-4 w-4 text-[#0F5132]" />
            Testar toque
          </button>

          <button
            type="button"
            onClick={() => testMessageNotificationSound()}
            className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Bell className="h-4 w-4 text-[#0D2B3E]" />
            Som de msg
          </button>

          {(status === 'prompt' || isEnabled) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onEnable()}
              className={`inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold transition disabled:opacity-60 ${
                isEnabled
                  ? 'border border-emerald-300 bg-white text-[#0F5132] hover:bg-emerald-50'
                  : 'bg-[#0F5132] text-white hover:bg-[#146c43]'
              }`}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Configurando...
                </>
              ) : isEnabled ? (
                'Sincronizar aparelho'
              ) : (
                'Ativar toque em segundo plano'
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
