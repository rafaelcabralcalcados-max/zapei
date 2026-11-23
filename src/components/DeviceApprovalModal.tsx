import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CheckCircle2,
  KeyRound,
  Laptop,
  Loader2,
  QrCode,
  ShieldAlert,
  Smartphone,
  X,
} from 'lucide-react';
import { parseDeviceAuthQrPayload } from '../lib/cpfAndDeviceUtils';
import type { DeviceAuthRequest } from '../types/zapei';

interface DeviceApprovalModalProps {
  request: DeviceAuthRequest;
  onApprove: (request: DeviceAuthRequest) => Promise<void>;
  onReject: (request: DeviceAuthRequest) => Promise<void>;
}

export const DeviceApprovalModal: React.FC<DeviceApprovalModalProps> = ({
  request,
  onApprove,
  onReject,
}) => {
  const [enteredCode, setEnteredCode] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const approvingRef = useRef(false);

  const isMobileRequester = /Android|iPhone|iPad|iOS/i.test(
    `${request.deviceName} ${request.platform}`
  );

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    setEnteredCode('');
    setFormError('');
    setScannerError('');
    approvingRef.current = false;
  }, [request.id]);

  useEffect(() => {
    if (!scannerOpen) {
      stopCamera();
      return undefined;
    }

    let cancelled = false;
    setScannerError('');

    const startScanner = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setScannerError('Este navegador não liberou acesso à câmera. Digite o código de 6 dígitos abaixo.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }

        const scanFrame = () => {
          if (cancelled || approvingRef.current) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (v && c && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && v.videoWidth > 0) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, c.width, c.height);
              const imgData = ctx.getImageData(0, 0, c.width, c.height);
              const decoded = jsQR(imgData.data, imgData.width, imgData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (decoded?.data) {
                const parsed = parseDeviceAuthQrPayload(decoded.data);
                if (
                  parsed &&
                  parsed.requestId === request.id &&
                  parsed.requestToken === request.requestToken &&
                  parsed.code6 === request.code6
                ) {
                  approvingRef.current = true;
                  stopCamera();
                  setScannerOpen(false);
                  setEnteredCode(parsed.code6);
                  setBusy(true);
                  void onApprove(request).finally(() => {
                    setBusy(false);
                  });
                  return;
                } else if (parsed) {
                  setScannerError(
                    'Este QR Code pertence a outra tentativa. Atualize a tela do outro aparelho ou digite os 6 dígitos.'
                  );
                }
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
      } catch {
        if (!cancelled) {
          setScannerError(
            'Não foi possível abrir a câmera. Autorize a câmera ou digite o código de 6 dígitos.'
          );
        }
      }
    };

    void startScanner();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [scannerOpen, request, onApprove]);

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = enteredCode.replace(/\D/g, '');
    if (digits.length !== 6) {
      setFormError('Digite os 6 dígitos exibidos na tela do novo aparelho.');
      return;
    }
    if (digits !== request.code6) {
      setFormError('Código incorreto. Confira os 6 números exibidos no outro aparelho.');
      return;
    }
    setFormError('');
    setBusy(true);
    try {
      stopCamera();
      await onApprove(request);
    } catch {
      setFormError('Não foi possível autorizar agora. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    setBusy(true);
    stopCamera();
    try {
      await onReject(request);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/65 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        {/* Alert Header */}
        <div className="bg-[#0D2B3E] px-5 py-4 text-white">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/30">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                Alerta de segurança · Novo acesso
              </p>
              <h2 className="mt-0.5 text-base font-extrabold leading-snug">
                Tentativa de conexão detectada em {request.deviceName}. Deseja autorizar?
              </h2>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {/* Device details */}
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#0D2B3E] ring-1 ring-slate-200">
              {isMobileRequester ? (
                <Smartphone className="h-4.5 w-4.5" />
              ) : (
                <Laptop className="h-4.5 w-4.5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900">{request.deviceName}</p>
              <p className="text-xs text-slate-500">Plataforma: {request.platform}</p>
            </div>
          </div>

          {/* Toggle Camera QR Scanner */}
          {scannerOpen ? (
            <div className="space-y-2.5 rounded-2xl border border-emerald-200 bg-slate-900 p-3 text-white">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                  <Camera className="h-4 w-4" />
                  Aponte para o QR Code na tela do outro aparelho
                </span>
                <button
                  type="button"
                  onClick={() => setScannerOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  aria-label="Fechar câmera"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="relative overflow-hidden rounded-xl bg-black aspect-[4/3]">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-40 w-40 rounded-2xl border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
                </div>
              </div>
              <canvas ref={canvasRef} className="hidden" />
              {scannerError && (
                <p className="rounded-lg bg-red-500/20 px-2.5 py-1.5 text-[11px] text-red-200">
                  {scannerError}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 text-xs font-bold text-[#0F5132] transition hover:bg-emerald-100/70 disabled:opacity-50"
            >
              <QrCode className="h-4 w-4" />
              Ler QR Code pela câmera
            </button>
          )}

          {/* 6-digit code confirmation form */}
          <form onSubmit={handleConfirmCode} className="space-y-3">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <KeyRound className="h-3.5 w-3.5 text-[#0F5132]" />
                Ou digite o código de 6 dígitos mostrado no outro aparelho
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                value={enteredCode}
                onChange={(e) => {
                  setEnteredCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setFormError('');
                }}
                placeholder="000000"
                className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-center font-mono text-xl font-bold tracking-[0.35em] text-slate-900 focus:border-[#0F5132] focus:outline-none"
              />
            </div>

            {formError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {formError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleReject()}
                className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                Recusar
              </button>
              <button
                type="submit"
                disabled={busy || enteredCode.replace(/\D/g, '').length !== 6}
                className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#0F5132] text-xs font-bold text-white transition hover:bg-[#146c43] disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Autorizar Acesso
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
