import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  CheckCircle2,
  Copy,
  Laptop,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { encodeDeviceAuthQrPayload } from '../lib/cpfAndDeviceUtils';
import type { DeviceAuthRequest } from '../types/zapei';
import { ChatFiLogo } from './ChatFiLogo';

interface DeviceAuthorizationGateProps {
  userName: string;
  userIdentifier: string;
  request: DeviceAuthRequest;
  statusMessage?: string;
  regenerating: boolean;
  onRegenerate: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export const DeviceAuthorizationGate: React.FC<DeviceAuthorizationGateProps> = ({
  userName,
  userIdentifier,
  request,
  statusMessage,
  regenerating,
  onRegenerate,
  onSignOut,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const isMobileDevice = /Android|iPhone|iPad|iOS/i.test(
    `${request.deviceName} ${request.platform}`
  );
  const isRejected = request.status === 'rejected';
  const isExpired =
    request.status === 'expired' ||
    (request.expiresAtMs > 0 && Date.now() > request.expiresAtMs);

  useEffect(() => {
    let active = true;
    const payload = encodeDeviceAuthQrPayload({
      requestId: request.id,
      requestToken: request.requestToken,
      code6: request.code6,
    });
    void QRCode.toDataURL(payload, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0D2B3E',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [request.id, request.requestToken, request.code6]);

  const formattedCode = `${request.code6.slice(0, 3)} ${request.code6.slice(3, 6)}`;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(request.code6);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard restriction
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#F8FAFC] p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="bg-[#0D2B3E] px-6 py-5 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ChatFiLogo className="h-11 w-11 shrink-0 rounded-2xl shadow-sm ring-2 ring-white/15" />
              <div className="min-w-0">
                <h1 className="text-lg font-extrabold tracking-tight">
                  Autorizar Novo Aparelho
                </h1>
                <p className="truncate text-xs text-emerald-200">
                  {userName} · {userIdentifier}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          {/* Detected Device Banner */}
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#0D2B3E] shadow-xs ring-1 ring-slate-200">
              {isMobileDevice ? (
                <Smartphone className="h-5 w-5" />
              ) : (
                <Laptop className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Este aparelho aguardando liberação
              </p>
              <p className="truncate text-sm font-bold text-slate-900">
                {request.deviceName}
              </p>
            </div>
          </div>

          {isRejected || isExpired ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center space-y-3">
              <ShieldAlert className="mx-auto h-8 w-8 text-red-600" />
              <div>
                <p className="text-sm font-bold text-red-900">
                  {isRejected
                    ? 'Solicitação recusada no aparelho principal'
                    : 'Código de autorização expirado'}
                </p>
                <p className="mt-1 text-xs text-red-700">
                  {isRejected
                    ? 'O acesso foi negado pelo aparelho já conectado. Se for você mesmo, gere uma nova solicitação abaixo.'
                    : 'Por segurança, o QR Code e o código de 6 dígitos expiram após 10 minutos.'}
                </p>
              </div>
              <button
                type="button"
                disabled={regenerating}
                onClick={() => void onRegenerate()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0E7A34] px-5 text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
              >
                {regenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Gerar novo QR Code e Código
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-slate-600">
                Sua conta já está ativa em outro aparelho. Um quadro de autorização foi aberto no
                aparelho que já tem acesso — escolha <strong>Código QR</strong> ou{' '}
                <strong>Senha de 6 dígitos</strong> para liberar este login:
              </p>

              {/* Simultaneous QR Code + 6-Digit Code */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Option A: Dynamic QR Code */}
                <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                  <span className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Opção 1 · Código QR
                  </span>
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="Código QR de autorização do ChatFi"
                      className="h-44 w-44 rounded-xl border border-slate-100"
                    />
                  ) : (
                    <div className="flex h-44 w-44 items-center justify-center rounded-xl bg-slate-50">
                      <Loader2 className="h-6 w-6 animate-spin text-[#0E7A34]" />
                    </div>
                  )}
                  <p className="mt-2 text-center text-[11px] text-slate-500">
                    Aponte a câmera do aparelho conectado
                  </p>
                </div>

                {/* Option B: 6-Digit Access Password */}
                <div className="flex flex-col items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#0E7A34]">
                    Opção 2 · Senha de 6 dígitos
                  </span>

                  <div className="my-4 text-center">
                    <div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 font-mono text-2xl font-black tracking-[0.22em] text-[#0D2B3E] shadow-xs tabular-nums">
                      {formattedCode}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopyCode()}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-[#0E7A34] transition hover:bg-emerald-100/70"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Código copiado
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copiar código
                        </>
                      )}
                    </button>
                  </div>

                  <p className="text-center text-[11px] text-slate-600">
                    Digite esta senha no quadro que apareceu no aparelho conectado.
                  </p>
                </div>
              </div>

              {/* Live waiting indicator */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0E7A34]" />
                  <p className="text-xs font-medium text-slate-700">
                    {statusMessage ||
                      'Aguardando aprovação em tempo real... Assim que liberar, suas conversas abrirão automaticamente.'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={regenerating}
                  onClick={() => void onRegenerate()}
                  title="Gerar novo código"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
