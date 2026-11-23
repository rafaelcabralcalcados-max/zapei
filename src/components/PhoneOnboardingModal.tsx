import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
  User as UserIcon,
  X,
} from 'lucide-react';
import type { ConfirmationResult, User } from 'firebase/auth';
import {
  clearPhoneRecaptcha,
  firebaseConfig,
  sendWhatsAppStyleSmsCode,
  signOutFirebase,
  verifyWhatsAppStyleSmsCode,
} from '../lib/firebase';
import {
  compressImageFileToDataUrl,
  formatPhoneDisplay,
} from '../lib/phoneUtils';

interface CountryOption {
  code: string;
  name: string;
  dial: string;
}

const COUNTRIES: CountryOption[] = [
  { code: 'BR', name: 'Brasil', dial: '55' },
  { code: 'PT', name: 'Portugal', dial: '351' },
  { code: 'US', name: 'Estados Unidos', dial: '1' },
  { code: 'AR', name: 'Argentina', dial: '54' },
  { code: 'PY', name: 'Paraguai', dial: '595' },
  { code: 'UY', name: 'Uruguai', dial: '598' },
  { code: 'CL', name: 'Chile', dial: '56' },
  { code: 'CO', name: 'Colômbia', dial: '57' },
  { code: 'MX', name: 'México', dial: '52' },
  { code: 'ES', name: 'Espanha', dial: '34' },
];

type GateStep = 'welcome' | 'phone' | 'otp' | 'profile';

interface PhoneOnboardingModalProps {
  mode: 'gate' | 'edit';
  authUser: User | null;
  initialName?: string;
  initialPhone?: string;
  initialStatus?: string;
  initialAvatarUrl?: string;
  onSaveProfile: (
    name: string,
    phone: string,
    statusMessage: string,
    avatarUrl?: string
  ) => Promise<void>;
  onClose?: () => void;
}

function formatLocalNumberInput(dial: string, raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 13);
  if (dial === '55') {
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  }
  return digits;
}

function parseFirebasePhoneError(err: unknown): {
  message: string;
  needsConsoleSetup: boolean;
  code?: string;
} {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';

  if (code === 'auth/operation-not-allowed') {
    const rawMsg = err instanceof Error ? err.message.toLowerCase() : '';
    if (rawMsg.includes('region')) {
      return {
        code,
        needsConsoleSetup: true,
        message:
          'O envio de SMS para o Brasil (+55) ainda não foi liberado na Política de Região de SMS do Firebase.',
      };
    }
    return {
      code,
      needsConsoleSetup: true,
      message:
        'O Firebase bloqueou o envio de SMS real neste número. No plano gratuito (Spark), cadastre este número em "Números de telefone para teste" ou ative o plano Blaze e libere o Brasil (+55) na Política de região de SMS.',
    };
  }
  if (code === 'auth/billing-not-enabled') {
    return {
      code,
      needsConsoleSetup: true,
      message:
        'O envio de SMS real exige o plano Blaze no Firebase, ou você pode cadastrar Números de Telefone para Teste gratuitamente no Console do Firebase.',
    };
  }
  if (code === 'auth/unauthorized-domain') {
    return {
      code,
      needsConsoleSetup: true,
      message:
        'Este domínio ainda não está autorizado em Authentication > Settings > Authorized domains no Firebase Console.',
    };
  }
  if (code === 'auth/invalid-phone-number') {
    return {
      code,
      needsConsoleSetup: false,
      message: 'Número de telefone inválido. Verifique o código do país, o DDD e o número.',
    };
  }
  if (code === 'auth/invalid-verification-code') {
    return {
      code,
      needsConsoleSetup: false,
      message: 'Código SMS incorreto. Confira os 6 dígitos enviados e tente novamente.',
    };
  }
  if (code === 'auth/code-expired') {
    return {
      code,
      needsConsoleSetup: false,
      message: 'O código SMS expirou. Toque em "Reenviar SMS" para receber um novo código.',
    };
  }
  if (code === 'auth/too-many-requests') {
    return {
      code,
      needsConsoleSetup: false,
      message: 'Muitas tentativas seguidas. Aguarde alguns minutos antes de solicitar outro SMS.',
    };
  }
  if (code === 'auth/captcha-check-failed') {
    return {
      code,
      needsConsoleSetup: false,
      message:
        'A verificação de segurança não foi concluída. Toque em Avançar para tentar novamente.',
    };
  }
  if (code === 'auth/network-request-failed') {
    return {
      code,
      needsConsoleSetup: false,
      message: 'Sem conexão com a internet. Verifique seu sinal e tente novamente.',
    };
  }
  if (code === 'auth/quota-exceeded') {
    return {
      code,
      needsConsoleSetup: false,
      message:
        'O limite diário de envio de SMS foi atingido temporariamente. Tente novamente mais tarde.',
    };
  }
  const rawMessage = err instanceof Error ? err.message : '';
  if (rawMessage.toLowerCase().includes('recaptcha')) {
    return {
      code,
      needsConsoleSetup: false,
      message:
        'A verificação de segurança precisou ser reiniciada. Toque em Avançar novamente.',
    };
  }
  return {
    code,
    needsConsoleSetup: false,
    message:
      rawMessage ||
      'Não foi possível concluir a verificação por SMS. Tente novamente.',
  };
}

export const PhoneOnboardingModal: React.FC<PhoneOnboardingModalProps> = ({
  mode,
  authUser,
  initialName = '',
  initialPhone = '',
  initialStatus = 'Disponível no Zapei',
  initialAvatarUrl = '',
  onSaveProfile,
  onClose,
}) => {
  const [step, setStep] = useState<GateStep>(authUser ? 'profile' : 'welcome');
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(COUNTRIES[0]);
  const [dialCode, setDialCode] = useState('55');
  const [localPhone, setLocalPhone] = useState(
    initialPhone ? formatLocalNumberInput('55', initialPhone) : ''
  );
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // OTP 6-digit state
  const [confirmationResult, setConfirmationResult] =
    useState<ConfirmationResult | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [resendSeconds, setResendSeconds] = useState(0);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Profile setup state (WhatsApp Step 4 & Edit mode)
  const [name, setName] = useState(initialName || authUser?.displayName || '');
  const [statusMessage, setStatusMessage] = useState(initialStatus);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [editPhone, setEditPhone] = useState(initialPhone);

  const [busy, setBusy] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{
    message: string;
    needsConsoleSetup: boolean;
    code?: string;
  } | null>(null);

  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Sync step automatically when Firebase Auth state transitions after SMS confirmation
  useEffect(() => {
    if (mode !== 'gate') return;
    if (authUser) {
      setStep('profile');
      if (authUser.phoneNumber) {
        setEditPhone(formatPhoneDisplay(authUser.phoneNumber));
      }
    }
  }, [authUser, mode]);

  // Countdown timer for "Reenviar SMS"
  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const id = window.setInterval(() => {
      setResendSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendSeconds]);

  useEffect(() => {
    return () => {
      clearPhoneRecaptcha();
    };
  }, []);

  const cleanDial = dialCode.replace(/\D/g, '') || '55';
  const cleanLocalDigits = localPhone.replace(/\D/g, '');
  const e164Phone = `+${cleanDial}${cleanLocalDigits}`;
  const formattedFullPhone = `+${cleanDial} ${formatLocalNumberInput(cleanDial, cleanLocalDigits)}`;

  const firebaseProvidersUrl = `https://console.firebase.google.com/project/${
    firebaseConfig.projectId || '_'
  }/authentication/providers`;

  const handleCountryChange = (code: string) => {
    const found = COUNTRIES.find((c) => c.code === code) || COUNTRIES[0];
    setSelectedCountry(found);
    setDialCode(found.dial);
    setLocalPhone((prev) => formatLocalNumberInput(found.dial, prev));
  };

  const handleDialInput = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    setDialCode(digits);
    const matched = COUNTRIES.find((c) => c.dial === digits);
    if (matched) setSelectedCountry(matched);
  };

  const handleRequestConfirmDialog = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorInfo(null);
    if (cleanLocalDigits.length < 8) {
      setErrorInfo({
        message: 'Digite seu número de telefone completo com DDD (ex: 11 99999-9999).',
        needsConsoleSetup: false,
      });
      return;
    }
    setShowConfirmDialog(true);
  };

  const handleSendRealSms = async () => {
    if (busy) return;
    setShowConfirmDialog(false);
    setErrorInfo(null);
    setBusy(true);
    try {
      const confirmation = await sendWhatsAppStyleSmsCode(
        e164Phone,
        'zapei-recaptcha-container'
      );
      setConfirmationResult(confirmation);
      setOtpDigits(['', '', '', '', '', '']);
      setResendSeconds(60);
      setStep('otp');
      window.setTimeout(() => otpRefs.current[0]?.focus(), 120);
    } catch (err) {
      setErrorInfo(parseFirebasePhoneError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitOtpCode = async (code: string) => {
    if (!confirmationResult || code.length !== 6 || busy) return;
    setErrorInfo(null);
    setBusy(true);
    try {
      await verifyWhatsAppStyleSmsCode(confirmationResult, code);
      // onAuthStateChanged in App.tsx will load existing profile or move to step === 'profile'
    } catch (err) {
      setErrorInfo(parseFirebasePhoneError(err));
      setOtpDigits(['', '', '', '', '', '']);
      window.setTimeout(() => otpRefs.current[0]?.focus(), 80);
    } finally {
      setBusy(false);
    }
  };

  const handleOtpDigitChange = (index: number, value: string) => {
    const onlyDigits = value.replace(/\D/g, '');
    if (onlyDigits.length > 1) {
      // Handle full 6-digit paste
      const pasted = onlyDigits.slice(0, 6).split('');
      const next = ['', '', '', '', '', ''];
      pasted.forEach((d, i) => {
        next[i] = d;
      });
      setOtpDigits(next);
      const focusIdx = Math.min(5, pasted.length);
      otpRefs.current[focusIdx]?.focus();
      if (pasted.length === 6) {
        void submitOtpCode(next.join(''));
      }
      return;
    }

    const next = [...otpDigits];
    next[index] = onlyDigits;
    setOtpDigits(next);

    if (onlyDigits && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    const joined = next.join('');
    if (joined.length === 6) {
      void submitOtpCode(joined);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const compressed = await compressImageFileToDataUrl(file, 256, 0.78);
      if (compressed.length <= 145000) {
        setAvatarUrl(compressed);
      } else {
        const smaller = await compressImageFileToDataUrl(file, 180, 0.65);
        setAvatarUrl(smaller);
      }
    } catch {
      setErrorInfo({
        message: 'Não foi possível processar a foto selecionada.',
        needsConsoleSetup: false,
      });
    }
  };

  const handleSaveProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorInfo(null);
    if (name.trim().length < 2) {
      setErrorInfo({
        message: 'Digite seu nome para que seus contatos identifiquem você.',
        needsConsoleSetup: false,
      });
      return;
    }
    const verifiedPhone =
      mode === 'edit'
        ? formatPhoneDisplay(editPhone || initialPhone)
        : authUser?.phoneNumber
          ? formatPhoneDisplay(authUser.phoneNumber)
          : formattedFullPhone;

    setBusy(true);
    try {
      await onSaveProfile(
        name.trim(),
        verifiedPhone,
        statusMessage.trim() || 'Disponível no Zapei',
        avatarUrl || undefined
      );
      onClose?.();
    } catch (err) {
      setErrorInfo({
        message:
          err instanceof Error
            ? err.message
            : 'Erro ao salvar seus dados de perfil. Tente novamente.',
        needsConsoleSetup: false,
      });
    } finally {
      setBusy(false);
    }
  };

  // --- EDIT MODAL INSIDE SETTINGS ---
  if (mode === 'edit') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-sm">
        <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Dados do perfil</h2>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarSelected}
            className="hidden"
          />

          <form onSubmit={handleSaveProfileSubmit} className="mt-5 space-y-5">
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="group relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-400 ring-2 ring-[#0F5132]/20 transition hover:ring-[#0F5132]"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Foto de perfil"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserIcon className="h-10 w-10" />
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition group-hover:opacity-100">
                  <Camera className="h-6 w-6" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="mt-2 text-xs font-semibold text-[#0F5132] hover:underline"
              >
                {avatarUrl ? 'Alterar foto de perfil' : 'Adicionar foto de perfil'}
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600">
                Seu nome
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-11 w-full border-b-2 border-slate-200 bg-transparent px-1 text-sm text-slate-900 focus:border-[#0F5132] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600">
                Recado
              </label>
              <input
                type="text"
                value={statusMessage}
                onChange={(e) => setStatusMessage(e.target.value)}
                placeholder="Disponível no Zapei"
                className="mt-1 h-11 w-full border-b-2 border-slate-200 bg-transparent px-1 text-sm text-slate-900 focus:border-[#0F5132] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600">
                Número verificado
              </label>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-700 tabular-nums">
                {editPhone || initialPhone}
              </p>
            </div>

            {errorInfo && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                {errorInfo.message}
              </p>
            )}

            <div className="flex gap-2.5 pt-2">
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 flex-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              )}
              <button
                type="submit"
                disabled={busy}
                className="h-11 flex-1 rounded-xl bg-[#0F5132] text-xs font-semibold text-white hover:bg-[#146c43] disabled:opacity-50"
              >
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // --- FULL-SCREEN WHATSAPP-IDENTICAL LOGIN & VERIFICATION FLOW ---
  const stepIndex =
    step === 'welcome' ? 0 : step === 'phone' ? 1 : step === 'otp' ? 2 : 3;

  return (
    <div className="relative min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-white md:bg-[#EFF3F6]">
      {/* Invisible Firebase Phone Auth reCAPTCHA Mount Point */}
      <div id="zapei-recaptcha-container" />

      {/* Authentic WhatsApp Web Top Emerald Ribbon (Desktop) */}
      <div className="hidden md:block h-52 w-full bg-[#0F5132]">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 pt-7 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#0F5132] shadow-sm">
            <MessageCircle className="h-6 w-6 fill-current" />
          </div>
          <span className="text-base font-bold tracking-wide uppercase">ZAPEI</span>
        </div>
      </div>

      {/* Main Content Container */}
      <div className="mx-auto flex min-h-[100dvh] md:min-h-0 max-w-5xl flex-col justify-center md:-mt-32 md:px-6 md:pb-12">
        <div className="flex flex-1 md:flex-none flex-col md:flex-row overflow-hidden bg-white md:rounded-2xl md:border md:border-slate-200 md:shadow-lg">
          {/* Desktop Left Column — WhatsApp Web Clean Guidance */}
          <div className="hidden md:flex md:w-5/12 flex-col justify-between border-r border-slate-100 bg-[#F8FAFC] p-9">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Entre no Zapei com seu número de telefone
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-600">
                Verificação rápida por SMS, exatamente como no WhatsApp. Seus contatos da agenda encontram você automaticamente pelo seu número.
              </p>

              <ol className="mt-8 space-y-5 text-sm text-slate-700">
                {[
                  {
                    num: '1',
                    title: 'Insira seu número de telefone',
                    desc: 'Escolha o país (+55 Brasil) e digite seu DDD e celular.',
                    done: stepIndex > 1,
                    active: stepIndex <= 1,
                  },
                  {
                    num: '2',
                    title: 'Confirme o código SMS de 6 dígitos',
                    desc: 'Digite o código enviado por SMS para validar sua conta.',
                    done: stepIndex > 2,
                    active: stepIndex === 2,
                  },
                  {
                    num: '3',
                    title: 'Configure seu nome e foto',
                    desc: 'Defina como seus contatos e clientes verão você no Zapei.',
                    done: false,
                    active: stepIndex === 3,
                  },
                ].map((item) => (
                  <li key={item.num} className="flex items-start gap-3.5">
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
                        item.done
                          ? 'bg-[#0F5132] text-white'
                          : item.active
                            ? 'bg-[#0D2B3E] text-white'
                            : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {item.done ? <Check className="h-4 w-4" /> : item.num}
                    </span>
                    <div>
                      <p className="font-semibold text-slate-900">{item.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-8 flex items-center gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500">
              <Lock className="h-4 w-4 shrink-0 text-[#0F5132]" />
              <span>Mensagens, chamadas de voz/vídeo e compras são gratuitas para sempre.</span>
            </div>
          </div>

          {/* Right Column (Full Screen on Mobile) — Authentic WhatsApp Screens */}
          <div className="flex flex-1 flex-col justify-between px-4 sm:px-8 pt-safe pb-safe md:py-10 min-h-[100dvh] md:min-h-[540px]">
            {/* STEP 1: WELCOME (Identical to WhatsApp Welcome Screen) */}
            {step === 'welcome' && (
              <>
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-50 text-[#0F5132] ring-8 ring-emerald-50/60">
                    <MessageCircle className="h-12 w-12 fill-current" />
                  </div>

                  <h1 className="mt-8 text-2xl font-bold tracking-tight text-slate-900">
                    Boas-vindas ao Zapei
                  </h1>
                  <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-500">
                    Leia nossa{' '}
                    <span className="font-medium text-[#0F5132]">
                      Política de Privacidade
                    </span>
                    . Toque em &ldquo;Concordar e continuar&rdquo; para aceitar os{' '}
                    <span className="font-medium text-[#0F5132]">
                      Termos de Serviço
                    </span>
                    .
                  </p>
                </div>

                <div className="mt-8 w-full max-w-sm mx-auto space-y-3">
                  <button
                    type="button"
                    onClick={() => setStep('phone')}
                    className="h-12 w-full rounded-full bg-[#0F5132] text-sm font-bold tracking-wide text-white uppercase shadow-sm transition hover:bg-[#146c43] active:scale-[0.99]"
                  >
                    Concordar e continuar
                  </button>
                  <p className="text-center text-xs text-slate-400">
                    Zapei · Mensagens, Ligações e Vitrines
                  </p>
                </div>
              </>
            )}

            {/* STEP 2: PHONE ENTRY (Identical to WhatsApp Phone Input) */}
            {step === 'phone' && (
              <form
                onSubmit={handleRequestConfirmDialog}
                className="flex flex-1 flex-col justify-between"
              >
                <div className="mx-auto w-full max-w-sm">
                  <div className="flex items-center justify-center relative">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorInfo(null);
                        setStep('welcome');
                      }}
                      className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                      aria-label="Voltar"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <h1 className="text-lg font-bold text-[#0F5132]">
                      Insira seu número de telefone
                    </h1>
                  </div>

                  <p className="mt-4 text-center text-xs leading-relaxed text-slate-600">
                    O Zapei precisará verificar sua conta. Podem ser aplicadas tarifas da operadora.
                  </p>

                  {/* Country Dropdown with WhatsApp Bottom Border */}
                  <div className="relative mt-7">
                    <select
                      aria-label="País"
                      value={selectedCountry.code}
                      onChange={(e) => handleCountryChange(e.target.value)}
                      className="h-11 w-full appearance-none border-b-2 border-[#0F5132] bg-transparent pr-8 text-center text-sm font-medium text-slate-900 focus:outline-none"
                    >
                      {COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0F5132]" />
                  </div>

                  {/* Classic WhatsApp +DDI | Phone Number Split Underlines */}
                  <div className="mt-4 flex items-end gap-3">
                    <div className="flex w-24 items-center border-b-2 border-[#0F5132] pb-1">
                      <span className="pl-1 font-mono text-base font-medium text-slate-500">
                        +
                      </span>
                      <input
                        type="tel"
                        aria-label="Código do país"
                        value={dialCode}
                        onChange={(e) => handleDialInput(e.target.value)}
                        className="h-9 w-full bg-transparent text-center font-mono text-base font-medium text-slate-900 tabular-nums focus:outline-none"
                      />
                    </div>
                    <div className="flex-1 border-b-2 border-[#0F5132] pb-1">
                      <input
                        type="tel"
                        autoFocus
                        required
                        aria-label="Número de telefone"
                        value={localPhone}
                        onChange={(e) =>
                          setLocalPhone(formatLocalNumberInput(cleanDial, e.target.value))
                        }
                        placeholder="número de telefone"
                        className="h-9 w-full bg-transparent px-1 font-mono text-base text-slate-900 placeholder:font-sans placeholder:text-sm placeholder:text-slate-400 tabular-nums focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Error & Actionable Firebase Phone Setup Helper */}
                  {errorInfo && (
                    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-left text-xs text-amber-900 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <p className="font-medium leading-relaxed">{errorInfo.message}</p>
                      </div>
                      {errorInfo.needsConsoleSetup && (
                        <div className="border-t border-amber-200/80 pt-2 text-[11px] leading-relaxed text-amber-800 space-y-1.5">
                          <p className="font-semibold">
                            Como ativar o SMS no seu projeto Firebase (leva 1 minuto):
                          </p>
                          <ol className="list-decimal pl-4 space-y-0.5">
                            <li>
                              Abra <strong>Authentication &gt; Sign-in method</strong> no Firebase Console.
                            </li>
                            <li>
                              Clique em <strong>Adicionar novo provedor &gt; Telefone</strong> e ative.
                            </li>
                            <li>
                              Para testar grátis sem cartão, abra <strong>Números de telefone para teste</strong> dentro do provedor Telefone e cadastre seu número + código de 6 dígitos.
                            </li>
                          </ol>
                          <a
                            href={firebaseProvidersUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 pt-1 font-semibold text-[#0F5132] underline"
                          >
                            Abrir Provedores no Firebase Console
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-8 pb-14 md:pb-0 mx-auto w-full max-w-sm">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0F5132] text-sm font-bold tracking-wide text-white uppercase shadow-sm transition hover:bg-[#146c43] disabled:opacity-50"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Enviando SMS...
                      </>
                    ) : (
                      'Avançar'
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3: 6-DIGIT SMS VERIFICATION (Identical to WhatsApp OTP Screen) */}
            {step === 'otp' && (
              <div className="flex flex-1 flex-col justify-between">
                <div className="mx-auto w-full max-w-sm text-center">
                  <div className="flex items-center justify-center relative">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorInfo(null);
                        setStep('phone');
                      }}
                      className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                      aria-label="Voltar"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <h1 className="text-base font-bold text-[#0F5132]">
                      Verificando {formattedFullPhone}
                    </h1>
                  </div>

                  <p className="mt-4 text-xs leading-relaxed text-slate-600">
                    Enviamos um SMS com um código de 6 dígitos para{' '}
                    <strong className="font-mono text-slate-900 tabular-nums">
                      {formattedFullPhone}
                    </strong>
                    .{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setErrorInfo(null);
                        setStep('phone');
                      }}
                      className="font-semibold text-[#0F5132] hover:underline"
                    >
                      Número errado?
                    </button>
                  </p>

                  {/* 6-Digit WhatsApp Split OTP Boxes (- - -   - - -) */}
                  <div className="mt-8 flex items-center justify-center gap-1.5 sm:gap-2">
                    {otpDigits.map((digit, idx) => (
                      <React.Fragment key={idx}>
                        <input
                          ref={(el) => {
                            otpRefs.current[idx] = el;
                          }}
                          type="text"
                          inputMode="numeric"
                          autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                          maxLength={6}
                          value={digit}
                          disabled={busy}
                          onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                          className="h-11 w-9 sm:h-12 sm:w-10 border-b-2 border-[#0F5132] bg-slate-50/70 text-center font-mono text-lg sm:text-xl font-bold text-slate-900 tabular-nums focus:bg-emerald-50/40 focus:outline-none disabled:opacity-50"
                        />
                        {idx === 2 && (
                          <span className="px-0.5 sm:px-1 font-mono text-base sm:text-lg text-slate-400">–</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    Insira o código de 6 dígitos
                  </p>

                  {/* Resend SMS Row */}
                  <div className="mt-6 flex items-center justify-center border-t border-slate-100 pt-5">
                    {resendSeconds > 0 ? (
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        Reenviar SMS em 00:
                        {resendSeconds.toString().padStart(2, '0')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSendRealSms()}
                        disabled={busy}
                        className="inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold text-[#0F5132] hover:underline disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reenviar SMS
                      </button>
                    )}
                  </div>

                  {errorInfo && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      {errorInfo.message}
                    </div>
                  )}
                </div>

                <div className="mt-8 mx-auto w-full max-w-sm">
                  <button
                    type="button"
                    disabled={busy || otpDigits.join('').length < 6}
                    onClick={() => void submitOtpCode(otpDigits.join(''))}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0F5132] text-sm font-bold tracking-wide text-white uppercase shadow-sm transition hover:bg-[#146c43] disabled:opacity-40"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verificando...
                      </>
                    ) : (
                      'Verificar código'
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: PROFILE INFO (Identical to WhatsApp Profile Setup Screen) */}
            {step === 'profile' && (
              <form
                onSubmit={handleSaveProfileSubmit}
                className="flex flex-1 flex-col justify-between"
              >
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarSelected}
                  className="hidden"
                />

                <div className="mx-auto w-full max-w-sm text-center">
                  <h1 className="text-lg font-bold text-[#0F5132]">Dados do perfil</h1>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    Insira seu nome e, se desejar, adicione uma foto de perfil.
                  </p>

                  {/* Circular WhatsApp Photo Upload */}
                  <div className="mt-7 flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="group relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-400 transition hover:bg-slate-200"
                      aria-label="Adicionar foto de perfil"
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt="Foto de perfil"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Camera className="h-10 w-10 text-slate-400" />
                      )}
                      <span className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#0F5132] text-white shadow">
                        <Camera className="h-4 w-4" />
                      </span>
                    </button>
                  </div>

                  {/* Classic Underline Name Input */}
                  <div className="mt-7 text-left space-y-4">
                    <div>
                      <input
                        type="text"
                        autoFocus
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Digite seu nome"
                        maxLength={80}
                        className="h-11 w-full border-b-2 border-[#0F5132] bg-transparent px-1 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>
                    {authUser?.phoneNumber && (
                      <p className="text-center font-mono text-xs text-slate-500 tabular-nums">
                        Número verificado:{' '}
                        <strong className="text-slate-700">
                          {formatPhoneDisplay(authUser.phoneNumber)}
                        </strong>
                      </p>
                    )}
                  </div>

                  {errorInfo && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      {errorInfo.message}
                    </div>
                  )}
                </div>

                <div className="mt-8 mx-auto w-full max-w-sm space-y-3">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0F5132] text-sm font-bold tracking-wide text-white uppercase shadow-sm transition hover:bg-[#146c43] disabled:opacity-50"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Entrando...
                      </>
                    ) : (
                      'Avançar'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await signOutFirebase();
                      setStep('phone');
                    }}
                    className="w-full py-1.5 text-center text-xs font-medium text-slate-500 hover:text-slate-800"
                  >
                    Usar outro número de telefone
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Iconic WhatsApp Phone Number Confirmation Modal */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-sm text-slate-600">
              Você inseriu o número de telefone:
            </p>
            <p className="mt-3 font-mono text-lg font-bold text-slate-900 tabular-nums">
              {formattedFullPhone}
            </p>
            <p className="mt-3 text-sm text-slate-600">
              Este número está correto ou você deseja editá-lo?
            </p>

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmDialog(false)}
                className="min-h-[44px] px-3 text-xs font-bold tracking-wide text-[#0F5132] uppercase hover:bg-emerald-50 rounded-lg"
              >
                Editar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSendRealSms()}
                className="min-h-[44px] px-5 text-xs font-bold tracking-wide text-[#0F5132] uppercase hover:bg-emerald-50 rounded-lg disabled:opacity-50"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
