import React, { useEffect, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import QRCode from 'qrcode';
import {
  CheckCircle2,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  Mail,
  MessageSquareCode,
  PowerOff,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  cleanCpfDigits,
  encodeDeviceAuthQrPayload,
  formatCpfMask,
  isValidCpf,
  maskEmailForDisplay,
  maskPhoneForDisplay,
} from '../lib/cpfAndDeviceUtils';
import type { DeviceAuthRequest } from '../types/zapei';
import { ChatFiLogo } from './ChatFiLogo';

interface DeviceAuthorizationGateProps {
  userName: string;
  userIdentifier: string;
  authMethod: 'phone' | 'cpf';
  registeredPhone?: string;
  recoveryEmail?: string;
  recentlyVerifiedAtSignIn: boolean;
  request: DeviceAuthRequest;
  statusMessage?: string;
  regenerating: boolean;
  onRegenerate: () => Promise<void>;
  onSendTakeoverSms: (containerId: string) => Promise<ConfirmationResult>;
  onConfirmTakeoverSms: (
    confirmation: ConfirmationResult,
    code: string,
    containerId: string
  ) => Promise<void>;
  onVerifyCpfForTakeover: (cpfRaw: string, password: string) => Promise<void>;
  onSendRecoveryEmail: () => Promise<{ maskedEmail: string }>;
  onTakeOverPrimary: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

const TAKEOVER_RECAPTCHA_ID = 'zapei-takeover-recaptcha';

export const DeviceAuthorizationGate: React.FC<DeviceAuthorizationGateProps> = ({
  userName,
  userIdentifier,
  authMethod,
  registeredPhone,
  recoveryEmail,
  recentlyVerifiedAtSignIn,
  request,
  statusMessage,
  regenerating,
  onRegenerate,
  onSendTakeoverSms,
  onConfirmTakeoverSms,
  onVerifyCpfForTakeover,
  onSendRecoveryEmail,
  onTakeOverPrimary,
  onSignOut,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Elapsed wait timer so the user is NEVER trapped waiting indefinitely for an offline/lost device
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [autoPromptedTimeout, setAutoPromptedTimeout] = useState(false);

  // Phone SMS re-verification state
  const [forceFreshSms, setForceFreshSms] = useState(false);
  const [smsConfirmation, setSmsConfirmation] = useState<ConfirmationResult | null>(null);
  const [smsCode, setSmsCode] = useState('');
  const [sendingSms, setSendingSms] = useState(false);

  // CPF + password / recovery email re-verification state
  const [forceFreshCpfCheck, setForceFreshCpfCheck] = useState(false);
  const [cpfInput, setCpfInput] = useState('');
  const [cpfPassword, setCpfPassword] = useState('');
  const [showCpfPassword, setShowCpfPassword] = useState(false);
  const [sendingRecoveryEmail, setSendingRecoveryEmail] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState('');

  const [takingOver, setTakingOver] = useState(false);
  const [takeOverError, setTakeOverError] = useState('');

  const isMobileDevice = /Android|iPhone|iPad|iOS/i.test(
    `${request.deviceName} ${request.platform}`
  );
  const isRejected = request.status === 'rejected';
  const isExpired =
    request.status === 'expired' ||
    (request.expiresAtMs > 0 && Date.now() > request.expiresAtMs);

  const maskedPhone = registeredPhone ? maskPhoneForDisplay(registeredPhone) : userIdentifier;
  const maskedRecoveryEmail = recoveryEmail ? maskEmailForDisplay(recoveryEmail) : '';

  useEffect(() => {
    setWaitingSeconds(0);
    setAutoPromptedTimeout(false);
  }, [request.id]);

  useEffect(() => {
    if (isRejected || isExpired) {
      setRecoveryOpen(true);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setWaitingSeconds((prev) => {
        const next = prev + 1;
        if (next === 20) {
          setAutoPromptedTimeout(true);
          setRecoveryOpen(true);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRejected, isExpired, request.id]);

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

  const handleImmediateTakeover = async () => {
    setTakingOver(true);
    setTakeOverError('');
    try {
      await onTakeOverPrimary();
    } catch (err) {
      setTakeOverError(
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível transferir o acesso agora. Verifique sua internet e tente novamente.'
      );
      setTakingOver(false);
    }
  };

  const handleSendSmsForTakeover = async () => {
    if (sendingSms || takingOver) return;
    setTakeOverError('');
    setRecoveryNotice('');
    setSendingSms(true);
    try {
      const confirmation = await onSendTakeoverSms(TAKEOVER_RECAPTCHA_ID);
      setSmsConfirmation(confirmation);
      setSmsCode('');
      setRecoveryNotice(`Código SMS de 6 dígitos enviado para ${maskedPhone}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setTakeOverError(
        msg ||
          'Não foi possível enviar o SMS agora. Se você acabou de fazer login por SMS, use a confirmação direta acima ou aguarde 1 minuto.'
      );
    } finally {
      setSendingSms(false);
    }
  };

  const handleVerifySmsAndTakeOver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsConfirmation || takingOver) return;
    const digits = smsCode.replace(/\D/g, '');
    if (digits.length !== 6) {
      setTakeOverError('Digite os 6 dígitos recebidos por SMS.');
      return;
    }
    setTakeOverError('');
    setTakingOver(true);
    try {
      await onConfirmTakeoverSms(smsConfirmation, digits, TAKEOVER_RECAPTCHA_ID);
      await onTakeOverPrimary();
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (code === 'auth/invalid-verification-code') {
        setTakeOverError('Código SMS incorreto. Confira os 6 dígitos e tente novamente.');
      } else if (code === 'auth/code-expired') {
        setTakeOverError('O código SMS expirou. Toque em "Reenviar SMS" abaixo.');
        setSmsConfirmation(null);
      } else {
        setTakeOverError(
          err instanceof Error && err.message
            ? err.message
            : 'Não foi possível validar o código SMS. Tente novamente.'
        );
      }
      setTakingOver(false);
    }
  };

  const handleVerifyCpfAndTakeOver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (takingOver) return;
    if (!isValidCpf(cpfInput)) {
      setTakeOverError('CPF inválido. Confira os 11 dígitos digitados.');
      return;
    }
    if (!cpfPassword) {
      setTakeOverError('Digite a senha da sua conta para confirmar.');
      return;
    }
    setTakeOverError('');
    setTakingOver(true);
    try {
      await onVerifyCpfForTakeover(cpfInput, cpfPassword);
      await onTakeOverPrimary();
    } catch (err) {
      setTakeOverError(
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível validar seu CPF e senha. Tente novamente.'
      );
      setTakingOver(false);
    }
  };

  const handleSendLinkedRecoveryEmail = async () => {
    if (sendingRecoveryEmail) return;
    setTakeOverError('');
    setRecoveryNotice('');
    setSendingRecoveryEmail(true);
    try {
      const { maskedEmail } = await onSendRecoveryEmail();
      setRecoveryNotice(
        `Link de recuperação enviado para ${maskedEmail}. Após redefinir a senha, toque em "Sair" no topo e entre com a nova senha para assumir este aparelho.`
      );
    } catch (err) {
      setTakeOverError(
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível enviar o e-mail de recuperação agora.'
      );
    } finally {
      setSendingRecoveryEmail(false);
    }
  };

  const showPhoneDirectConfirm = authMethod === 'phone' && recentlyVerifiedAtSignIn && !forceFreshSms;
  const showCpfDirectConfirm = authMethod === 'cpf' && recentlyVerifiedAtSignIn && !forceFreshCpfCheck;
  const cpfDigitsComplete = cleanCpfDigits(cpfInput).length === 11;

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#F8FAFC] p-4">
      <div id={TAKEOVER_RECAPTCHA_ID} />

      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="bg-[#0D2B3E] px-6 py-5 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
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
                    ? 'O acesso foi negado pelo aparelho já conectado. Você pode gerar um novo código ou confirmar sua conta diretamente abaixo.'
                    : 'O QR Code e a senha de 6 dígitos expiraram. Gere um novo código ou conclua pela verificação direta abaixo.'}
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
                Sua conta já possui outro aparelho conectado. Se ele estiver por perto, aprove usando{' '}
                <strong>Código QR</strong> ou <strong>Senha de 6 dígitos</strong>. Caso o aparelho antigo esteja desligado, sem internet ou perdido, use a verificação direta abaixo:
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

              {/* Live waiting indicator with non-blocking timeout guidance */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0E7A34]" />
                  <p className="text-xs font-medium text-slate-700">
                    {autoPromptedTimeout
                      ? 'Sem resposta do aparelho antigo. Não precisa esperar — conclua o login pela verificação direta abaixo.'
                      : statusMessage ||
                        `Aguardando resposta do aparelho antigo (${waitingSeconds}s)... Ou use a verificação direta abaixo a qualquer momento.`}
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

          {/* Direct Account Verification & Primary Takeover (when old device is powered off, offline, or lost) */}
          <div
            className={`rounded-2xl border p-4 transition ${
              autoPromptedTimeout || recoveryOpen
                ? 'border-amber-300 bg-amber-50/90 shadow-sm'
                : 'border-amber-200 bg-amber-50/70'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
                <PowerOff className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900">
                  Aparelho antigo desligado, sem internet ou perdido?
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  Conclua o login verificando sua conta diretamente aqui ({authMethod === 'phone' ? 'código SMS no telefone cadastrado' : 'CPF + senha ou e-mail de recuperação'}). Este dispositivo assumirá como{' '}
                  <strong>Aparelho Principal</strong> e o aparelho antigo será desconectado.
                </p>

                {!recoveryOpen ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTakeOverError('');
                      setRecoveryNotice('');
                      setRecoveryOpen(true);
                    }}
                    className="mt-3 inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-bold text-amber-900 transition hover:bg-amber-100/70"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-[#0E7A34]" />
                    Verificar conta diretamente e entrar agora
                  </button>
                ) : (
                  <div className="mt-3 space-y-3 rounded-xl border border-amber-200/90 bg-white p-3.5">
                    {takeOverError && (
                      <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-medium text-red-700">
                        {takeOverError}
                      </p>
                    )}

                    {recoveryNotice && (
                      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] font-medium text-emerald-900">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0E7A34]" />
                        <span>{recoveryNotice}</span>
                      </div>
                    )}

                    {/* PHONE ACCOUNT DIRECT VERIFICATION */}
                    {authMethod === 'phone' && (
                      <>
                        {showPhoneDirectConfirm ? (
                          <div className="space-y-2.5">
                            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-[11px] font-semibold text-emerald-900">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                              <span>
                                SMS confirmado neste login ({maskedPhone}). Pronto para assumir como Aparelho Principal.
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={takingOver}
                                onClick={() => void handleImmediateTakeover()}
                                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
                              >
                                {takingOver ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Assumindo aparelho...
                                  </>
                                ) : (
                                  'Assumir este aparelho como Principal'
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={takingOver}
                                onClick={() => {
                                  setForceFreshSms(true);
                                  setTakeOverError('');
                                  setRecoveryNotice('');
                                }}
                                className="inline-flex min-h-[38px] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Enviar novo código SMS
                              </button>
                            </div>
                          </div>
                        ) : !smsConfirmation ? (
                          <div className="space-y-2.5">
                            <p className="text-[11px] text-slate-600">
                              Enviaremos um código SMS de 6 dígitos para{' '}
                              <strong className="font-mono text-slate-900">{maskedPhone}</strong> para confirmar sua identidade e transferir o aparelho principal.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={sendingSms || takingOver}
                                onClick={() => void handleSendSmsForTakeover()}
                                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
                              >
                                {sendingSms ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Enviando SMS...
                                  </>
                                ) : (
                                  <>
                                    <MessageSquareCode className="h-3.5 w-3.5" />
                                    Enviar código SMS agora
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={sendingSms || takingOver}
                                onClick={() => setRecoveryOpen(false)}
                                className="inline-flex min-h-[38px] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                Voltar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <form onSubmit={handleVerifySmsAndTakeOver} className="space-y-2.5">
                            <label className="block text-[11px] font-semibold text-slate-700">
                              Digite o código SMS de 6 dígitos enviado para {maskedPhone}
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              autoFocus
                              value={smsCode}
                              onChange={(e) =>
                                setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                              }
                              placeholder="000000"
                              className="h-10 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-center font-mono text-base font-bold tracking-[0.25em] text-slate-900 tabular-nums focus:border-[#0E7A34] focus:bg-white focus:outline-none"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="submit"
                                disabled={takingOver || smsCode.replace(/\D/g, '').length !== 6}
                                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
                              >
                                {takingOver ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Validando e entrando...
                                  </>
                                ) : (
                                  'Confirmar SMS e entrar agora'
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={sendingSms || takingOver}
                                onClick={() => void handleSendSmsForTakeover()}
                                className="inline-flex min-h-[38px] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                Reenviar SMS
                              </button>
                            </div>
                          </form>
                        )}
                      </>
                    )}

                    {/* CPF + RECOVERY EMAIL ACCOUNT DIRECT VERIFICATION */}
                    {authMethod === 'cpf' && (
                      <>
                        {showCpfDirectConfirm ? (
                          <div className="space-y-2.5">
                            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-[11px] font-semibold text-emerald-900">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                              <span>
                                CPF e senha verificados neste login. Pronto para assumir como Aparelho Principal.
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={takingOver}
                                onClick={() => void handleImmediateTakeover()}
                                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
                              >
                                {takingOver ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Assumindo aparelho...
                                  </>
                                ) : (
                                  'Assumir este aparelho como Principal'
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={takingOver}
                                onClick={() => {
                                  setForceFreshCpfCheck(true);
                                  setTakeOverError('');
                                  setRecoveryNotice('');
                                }}
                                className="inline-flex min-h-[38px] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Revalidar CPF ou e-mail
                              </button>
                            </div>
                          </div>
                        ) : (
                          <form onSubmit={handleVerifyCpfAndTakeOver} className="space-y-2.5">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700">
                                CPF cadastrado na conta
                              </label>
                              <div className="relative mt-1">
                                <CreditCard className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={14}
                                  value={cpfInput}
                                  onChange={(e) => {
                                    setCpfInput(formatCpfMask(e.target.value));
                                    setTakeOverError('');
                                  }}
                                  placeholder="000.000.000-00"
                                  className="h-10 w-full rounded-xl border border-slate-300 bg-slate-50 pl-8 pr-3 font-mono text-xs text-slate-900 tabular-nums focus:border-[#0E7A34] focus:bg-white focus:outline-none"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700">
                                Senha da conta
                              </label>
                              <div className="relative mt-1">
                                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                <input
                                  type={showCpfPassword ? 'text' : 'password'}
                                  value={cpfPassword}
                                  onChange={(e) => {
                                    setCpfPassword(e.target.value);
                                    setTakeOverError('');
                                  }}
                                  placeholder="Digite sua senha"
                                  className="h-10 w-full rounded-xl border border-slate-300 bg-slate-50 pl-8 pr-9 text-xs text-slate-900 focus:border-[#0E7A34] focus:bg-white focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowCpfPassword((v) => !v)}
                                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60"
                                >
                                  {showCpfPassword ? (
                                    <EyeOff className="h-3.5 w-3.5" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 pt-0.5">
                              <button
                                type="submit"
                                disabled={takingOver || !cpfDigitsComplete || !cpfPassword}
                                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
                              >
                                {takingOver ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Verificando...
                                  </>
                                ) : (
                                  'Verificar conta e assumir aparelho'
                                )}
                              </button>
                              {maskedRecoveryEmail && (
                                <button
                                  type="button"
                                  disabled={sendingRecoveryEmail || takingOver}
                                  onClick={() => void handleSendLinkedRecoveryEmail()}
                                  className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  {sendingRecoveryEmail ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Mail className="h-3.5 w-3.5 text-[#0E7A34]" />
                                  )}
                                  Recuperar por {maskedRecoveryEmail}
                                </button>
                              )}
                            </div>
                          </form>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
