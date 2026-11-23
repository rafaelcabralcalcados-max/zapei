import React, { useCallback, useEffect, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mic,
  ShieldCheck,
} from 'lucide-react';
import { isIOSDevice } from '../lib/pushService';
import {
  preauthorizeMediaPermissions,
  queryMediaPermissionSnapshot,
  type MediaPermissionSnapshot,
} from '../lib/webrtcService';

export const MediaPermissionsCard: React.FC = () => {
  const [snapshot, setSnapshot] = useState<MediaPermissionSnapshot>({
    mic: 'unknown',
    cam: 'unknown',
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showSteps, setShowSteps] = useState(false);

  const isIOS = isIOSDevice();

  const refreshStatus = useCallback(async () => {
    const next = await queryMediaPermissionSnapshot();
    setSnapshot(next);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleAuthorize = async () => {
    setBusy(true);
    setFeedback('');
    try {
      const res = await preauthorizeMediaPermissions();
      setFeedback(res.message);
      await refreshStatus();
      if (isIOS) {
        setShowSteps(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const bothGranted = snapshot.mic === 'granted' && snapshot.cam === 'granted';

  return (
    <section
      className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${
        bothGranted
          ? 'border-emerald-200 bg-emerald-50/50'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              bothGranted
                ? 'bg-[#0F5132] text-white'
                : 'bg-[#0D2B3E] text-white'
            }`}
          >
            {bothGranted ? (
              <ShieldCheck className="h-5 w-5" />
            ) : (
              <Camera className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                Câmera e Microfone sem perguntar toda hora
              </h2>
              {bothGranted && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-[#0F5132]">
                  <CheckCircle2 className="h-3 w-3" />
                  Liberado sempre
                </span>
              )}
            </div>

            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {bothGranted
                ? 'Câmera e microfone já estão liberados permanentemente neste navegador. Suas chamadas vão conectar direto sem pedir permissão.'
                : isIOS
                  ? 'No iPhone, o Safari vem configurado para "Perguntar" em toda ligação. Libere abaixo e mude para "Permitir" 1 única vez para nunca mais pedir.'
                  : 'Libere câmera e microfone juntos de uma vez e escolha "Permitir ao visitar o site" para nunca mais aparecer o aviso ao ligar ou atender.'}
            </p>

            {!bothGranted && (snapshot.mic !== 'unknown' || snapshot.cam !== 'unknown') && (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 ${
                    snapshot.mic === 'granted'
                      ? 'bg-emerald-100 text-[#0F5132]'
                      : snapshot.mic === 'denied'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <Mic className="h-3 w-3" />
                  Microfone:{' '}
                  {snapshot.mic === 'granted'
                    ? 'Liberado'
                    : snapshot.mic === 'denied'
                      ? 'Bloqueado'
                      : 'Perguntando'}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 ${
                    snapshot.cam === 'granted'
                      ? 'bg-emerald-100 text-[#0F5132]'
                      : snapshot.cam === 'denied'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <Camera className="h-3 w-3" />
                  Câmera:{' '}
                  {snapshot.cam === 'granted'
                    ? 'Liberada'
                    : snapshot.cam === 'denied'
                      ? 'Bloqueada'
                      : 'Perguntando'}
                </span>
              </div>
            )}

            {feedback && (
              <p className="mt-2 text-xs font-semibold text-[#0F5132]">{feedback}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap shrink-0 items-center gap-2">
          {!bothGranted && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAuthorize()}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-[#0F5132] px-4 text-xs font-bold text-white transition hover:bg-[#146c43] disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Liberando...
                </>
              ) : (
                'Liberar agora'
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className="inline-flex min-h-[42px] items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <span>Fixar sempre</span>
            {showSteps ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {showSteps && (
        <div className="mt-3.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700 space-y-2">
          {isIOS ? (
            <>
              <p className="font-bold text-slate-900">
                Como deixar liberado para sempre no iPhone (nunca mais perguntar):
              </p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  Abra os <strong>Ajustes do iPhone</strong> → role até <strong>Apps</strong> → toque em <strong>Safari</strong>.
                </li>
                <li>
                  Toque em <strong>Câmera</strong> e mude de <em>Perguntar</em> para <strong>Permitir</strong>.
                </li>
                <li>
                  Toque em <strong>Microfone</strong> e mude de <em>Perguntar</em> para <strong>Permitir</strong>.
                </li>
              </ol>
              <p className="text-[11px] text-slate-500">
                Dica: isso funciona tanto no Safari quanto no Zapei instalado na Tela de Início.
              </p>
            </>
          ) : (
            <>
              <p className="font-bold text-slate-900">
                Como deixar liberado para sempre no Android / Chrome:
              </p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  Toque no botão <strong>Liberar agora</strong> acima e escolha{' '}
                  <strong>Permitir ao visitar o site</strong> (evite clicar em <em>Apenas desta vez</em>).
                </li>
                <li>
                  Se já clicou em <em>Apenas desta vez</em>, toque no ícone de{' '}
                  <strong>ajustes/cadeado</strong> ao lado do endereço do site →{' '}
                  <strong>Permissões</strong> → ative <strong>Câmera</strong> e{' '}
                  <strong>Microfone</strong> como <strong>Permitir</strong>.
                </li>
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
};
