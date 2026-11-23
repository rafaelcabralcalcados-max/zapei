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

type ApprovalOption = 'qr' | 'password';

export const DeviceApprovalModal: React.FC<DeviceApprovalModalProps> = ({
  request,
  onApprove,
  onReject,
}) => {
  const [selectedOption, setSelectedOption] = useState<ApprovalOption | null>(null);
  const [enteredCode, setEnteredCode] = useState('');
  const [scannerError, setScannerError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const approvingRef = useRef(false);
  const onApproveRef = useRef(onApprove);
  onApproveRef.current = onApprove;
  const requestRef = useRef(request);
  requestRef.current = request;

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
    setSelectedOption(null);
    setEnteredCode('');
    setFormError('');
    setScannerError('');
    approvingRef.current = false;
  }, [request.id]);

  useEffect(() => {
    if (selectedOption !== 'qr') {
      stopCamera();
      return undefined;
    }

    let cancelled = false;
    setScannerError('');

    const startScanner = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setScannerError(
          'Câmera indisponível neste aparelho. Escolha a opção "Senha (6 dígitos)" para autorizar.'
        );
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
          const currentReq = requestRef.current;
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
                  parsed.requestId === currentReq.id &&
                  parsed.requestToken === currentReq.requestToken &&
                  parsed.code6 === currentReq.code6
                ) {
                  approvingRef.current = true;
                  stopCamera();
                  setEnteredCode(parsed.code6);
                  setBusy(true);
                  void onApproveRef.current(currentReq).finally(() => {
                    setBusy(false);
                  });
                  return;
                } else if (parsed) {
                  setScannerError(
                    'Este Código QR pertence a outra tentativa. Atualize a tela do aparelho novo ou use a opção Senha.'
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
            'Não foi possível abrir a câmera. Autorize o uso da câmera ou escolha a opção "Senha (6 dígitos)".'
          );
        }
      }
    };

    void startScanner();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [selectedOption, request.id]);

  const handleConfirmPasswordCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = enteredCode.replace(/\D/g, '');
    if (digits.length !== 6) {
      setFormError('Digite a senha de 6 dígitos exibida na tela do aparelho novo.');
      return;
    }
    if (digits !== request.code6) {
      setFormError('Senha incorreta. Confira os 6 números exibidos no outro aparelho.');
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
                Novo aparelho tentando conectar
              </p>
              <h2 className="mt-0.5 text-base font-extrabold leading-snug">
                Outro dispositivo solicitou acesso à sua conta. Deseja liberar o login?
              </h2>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {/* Requester device details */}
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

          {/* 2 Login Authorization Options for the New Device */}
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              Escolha como liberar o aparelho novo
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setFormError('');
                  setSelectedOption('qr');
                }}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border p-3.5 text-center transition disabled:opacity-50 ${
                  selectedOption === 'qr'
                    ? 'border-[#0E7A34] bg-emerald-50 text-[#0E7A34] ring-2 ring-[#0E7A34]/20'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/40'
                }`}
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    selectedOption === 'qr'
                      ? 'bg-[#0E7A34] text-white'
                      : 'bg-slate-100 text-[#0D2B3E]'
                  }`}
                >
                  <QrCode className="h-5 w-5" />
                </div>
                <span className="text-xs font-extrabold">1. Código QR</span>
                <span className="text-[11px] leading-tight text-slate-500">
                  Ler pela câmera
                </span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setScannerError('');
                  setSelectedOption('password');
                }}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border p-3.5 text-center transition disabled:opacity-50 ${
                  selectedOption === 'password'
                    ? 'border-[#0E7A34] bg-emerald-50 text-[#0E7A34] ring-2 ring-[#0E7A34]/20'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/40'
                }`}
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    selectedOption === 'password'
                      ? 'bg-[#0E7A34] text-white'
                      : 'bg-slate-100 text-[#0D2B3E]'
                  }`}
                >
                  <KeyRound className="h-5 w-5" />
                </div>
                <span className="text-xs font-extrabold">2. Senha</span>
                <span className="text-[11px] leading-tight text-slate-500">
                  Código de 6 dígitos
                </span>
              </button>
            </div>
          </div>

          {/* Option 1: Live Camera QR Code Scanner */}
          {selectedOption === 'qr' && (
            <div className="space-y-2.5 rounded-2xl border border-emerald-200 bg-slate-900 p-3 text-white">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                  <Camera className="h-4 w-4" />
                  Aponte para o Código QR no aparelho novo
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedOption(null)}
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
          )}

          {/* Option 2: 6-Digit Access Password Input */}
          {selectedOption === 'password' && (
            <form onSubmit={handleConfirmPasswordCode} className="space-y-3">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <KeyRound className="h-3.5 w-3.5 text-[#0E7A34]" />
                  Digite a senha de 6 dígitos exibida no aparelho novo
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  autoComplete="one-time-code"
                  value={enteredCode}
                  onChange={(e) => {
                    setEnteredCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setFormError('');
                  }}
                  placeholder="000000"
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-center font-mono text-xl font-bold tracking-[0.35em] text-slate-900 focus:border-[#0E7A34] focus:outline-none"
                />
              </div>

              {formError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || enteredCode.replace(/\D/g, '').length !== 6}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Autorizar Login no Novo Aparelho
              </button>
            </form>
          )}

          {/* Always-visible Reject Action */}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleReject()}
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Recusar acesso deste aparelho
          </button>
        </div>
      </div>
    </div>
  );
};
