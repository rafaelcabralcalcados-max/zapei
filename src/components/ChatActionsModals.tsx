import React, { useEffect, useState } from 'react';
import {
  Ban,
  Bell,
  BellOff,
  Check,
  Copy,
  Eraser,
  ExternalLink,
  FolderPlus,
  KeyRound,
  Link2,
  ListPlus,
  Lock,
  LockOpen,
  MessageSquare,
  Phone,
  Plus,
  Share2,
  Star,
  Store,
  Trash2,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import type { ChatCustomList } from '../types/zapei';
import type { AvatarPreviewTarget } from './AvatarLightboxModal';
import { StarRatingBadge } from './StarRatingBadge';

export interface ContactDetailsTarget {
  uid: string;
  chatId: string;
  name: string;
  initials: string;
  avatarBg: string;
  avatarUrl?: string;
  phone?: string;
  virtualLine?: string;
  statusMessage?: string;
  presenceLabel?: string;
  isOnline?: boolean;
  role: 'normal' | 'reseller' | 'manufacturer';
  hasStorefront: boolean;
  storefrontName?: string;
  deliveryPolicyLabel?: string;
  ratingAverage?: number;
  ratingCount?: number;
  isSavedContact: boolean;
}

interface ContactInfoModalProps {
  target: ContactDetailsTarget;
  isFavorite: boolean;
  isMuted: boolean;
  isLocked: boolean;
  isBlocked: boolean;
  hasShortcut: boolean;
  onClose: () => void;
  onPreviewAvatar: (preview: AvatarPreviewTarget) => void;
  onOpenChat: () => void;
  onStartCall: (callType: 'audio' | 'video') => void;
  onOpenStorefront?: () => void;
  onSaveToContacts?: () => Promise<void>;
  onToggleFavorite: () => void;
  onToggleMute: () => void;
  onToggleLock: () => void;
  onOpenAddToList: () => void;
  onOpenShortcut: () => void;
  onClearChat: () => void;
  onToggleBlock: () => void;
}

export const ContactInfoModal: React.FC<ContactInfoModalProps> = ({
  target,
  isFavorite,
  isMuted,
  isLocked,
  isBlocked,
  hasShortcut,
  onClose,
  onPreviewAvatar,
  onOpenChat,
  onStartCall,
  onOpenStorefront,
  onSaveToContacts,
  onToggleFavorite,
  onToggleMute,
  onToggleLock,
  onOpenAddToList,
  onOpenShortcut,
  onClearChat,
  onToggleBlock,
}) => {
  const [copiedKey, setCopiedKey] = useState<'phone' | 'virtual' | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleCopy = async (value: string, kind: 'phone' | 'virtual') => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(kind);
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // ignore clipboard error
    }
  };

  const roleLabel =
    target.role === 'manufacturer'
      ? 'Fabricante'
      : target.role === 'reseller'
        ? 'Vendedor'
        : 'Conta pessoal';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Dados de ${target.name}`}
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chatfi-header-wave flex shrink-0 items-center justify-between px-4 py-3.5 text-white">
          <h3 className="text-base font-bold">Dados do contato</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar dados do contato"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-safe space-y-4">
          {/* Avatar + Identity */}
          <div className="flex flex-col items-center text-center">
            <button
              type="button"
              onClick={() =>
                onPreviewAvatar({
                  name: target.name,
                  initials: target.initials,
                  avatarBg: target.avatarBg,
                  avatarUrl: target.avatarUrl,
                  phone: target.phone,
                  virtualLine: target.virtualLine,
                  subtitle: target.storefrontName || target.presenceLabel,
                  ratingAverage: target.ratingAverage,
                  ratingCount: target.ratingCount,
                })
              }
              className="relative rounded-full transition hover:opacity-95 active:scale-95"
              title="Ampliar foto"
            >
              {target.avatarUrl ? (
                <img
                  src={target.avatarUrl}
                  alt={target.name}
                  className="h-24 w-24 rounded-full object-cover ring-4 ring-[#0E7A34]/20"
                />
              ) : (
                <div
                  className="flex h-24 w-24 items-center justify-center rounded-full text-2xl font-extrabold text-white ring-4 ring-[#0E7A34]/20"
                  style={{ backgroundColor: target.avatarBg || '#0E7A34' }}
                >
                  {target.initials}
                </div>
              )}
            </button>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <h4 className="text-lg font-extrabold text-slate-900">{target.name}</h4>
              <StarRatingBadge
                average={target.ratingAverage}
                count={target.ratingCount}
                variant="inline"
              />
            </div>

            <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-xs text-slate-500">
              <span>{roleLabel}</span>
              {target.presenceLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className={target.isOnline ? 'font-semibold text-[#0E7A34]' : ''}>
                    {target.presenceLabel}
                  </span>
                </>
              )}
            </div>

            {isBlocked && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-red-600">
                <Ban className="h-3.5 w-3.5" />
                Contato bloqueado
              </p>
            )}
          </div>

          {/* Primary Quick Actions */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={onOpenChat}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold text-slate-800 transition hover:bg-emerald-50 hover:text-[#0E7A34]"
            >
              <MessageSquare className="h-4 w-4 text-[#0E7A34]" />
              <span>Conversar</span>
            </button>
            <button
              type="button"
              disabled={isBlocked}
              onClick={() => onStartCall('audio')}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold text-slate-800 transition hover:bg-emerald-50 hover:text-[#0E7A34] disabled:opacity-45"
            >
              <Phone className="h-4 w-4 text-[#0E7A34]" />
              <span>Ligar</span>
            </button>
            <button
              type="button"
              disabled={isBlocked}
              onClick={() => onStartCall('video')}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-semibold text-slate-800 transition hover:bg-emerald-50 hover:text-[#0E7A34] disabled:opacity-45"
            >
              <Video className="h-4 w-4 text-[#0E7A34]" />
              <span>Vídeo</span>
            </button>
          </div>

          {/* Storefront CTA if active */}
          {target.hasStorefront && onOpenStorefront && (
            <button
              type="button"
              onClick={onOpenStorefront}
              className="flex min-h-[46px] w-full items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-left transition hover:brightness-95"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Store className="h-4 w-4 shrink-0 text-[#0E7A34]" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-900">
                    {target.storefrontName || 'Vitrine comercial'}
                  </p>
                  {target.deliveryPolicyLabel && (
                    <p className="truncate text-[11px] text-slate-600">
                      {target.deliveryPolicyLabel}
                    </p>
                  )}
                </div>
              </div>
              <ExternalLink className="h-4 w-4 shrink-0 text-[#0E7A34]" />
            </button>
          )}

          {/* Phone, Virtual Line & Status */}
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {target.statusMessage && (
              <div className="px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Recado
                </p>
                <p className="mt-0.5 text-sm text-slate-800">{target.statusMessage}</p>
              </div>
            )}

            {target.phone && (
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Telefone
                  </p>
                  <p className="mt-0.5 truncate font-mono text-sm font-bold text-slate-900 tabular-nums">
                    {target.phone}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopy(target.phone || '', 'phone')}
                  className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {copiedKey === 'phone' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#0E7A34]" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {target.virtualLine && target.virtualLine !== target.phone && (
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Linha Virtual ChatFi
                  </p>
                  <p className="mt-0.5 truncate font-mono text-sm font-bold text-[#0E7A34] tabular-nums">
                    {target.virtualLine}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopy(target.virtualLine || '', 'virtual')}
                  className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {copiedKey === 'virtual' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#0E7A34]" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {!target.isSavedContact && onSaveToContacts && (
            <button
              type="button"
              disabled={savingContact}
              onClick={async () => {
                setSavingContact(true);
                try {
                  await onSaveToContacts();
                } finally {
                  setSavingContact(false);
                }
              }}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-[#0E7A34] px-4 text-sm font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4" />
              <span>{savingContact ? 'Salvando...' : 'Salvar na minha agenda'}</span>
            </button>
          )}

          {/* Organization & Privacy Controls */}
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={onToggleFavorite}
              className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <span className="flex items-center gap-3">
                <Star
                  className={`h-4 w-4 ${
                    isFavorite ? 'fill-amber-400 text-amber-500' : 'text-slate-500'
                  }`}
                />
                <span>{isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}</span>
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenAddToList}
              className="flex min-h-[48px] w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <ListPlus className="h-4 w-4 text-[#0E7A34]" />
              <span>Adicionar à lista</span>
            </button>

            <button
              type="button"
              onClick={onOpenShortcut}
              className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <span className="flex items-center gap-3">
                <Link2 className="h-4 w-4 text-[#0E7A34]" />
                <span>
                  {hasShortcut ? 'Gerenciar atalho da conversa' : 'Adicionar atalho para conversa'}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              className="flex min-h-[48px] w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              {isMuted ? (
                <Bell className="h-4 w-4 text-[#0E7A34]" />
              ) : (
                <BellOff className="h-4 w-4 text-slate-500" />
              )}
              <span>{isMuted ? 'Reativar notificações' : 'Silenciar notificações'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleLock}
              className="flex min-h-[48px] w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              {isLocked ? (
                <LockOpen className="h-4 w-4 text-[#0E7A34]" />
              ) : (
                <Lock className="h-4 w-4 text-slate-500" />
              )}
              <span>{isLocked ? 'Destrancar conversa' : 'Trancar conversa'}</span>
            </button>

            <button
              type="button"
              onClick={onClearChat}
              className="flex min-h-[48px] w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Eraser className="h-4 w-4 text-slate-500" />
              <span>Limpar conversa</span>
            </button>

            <button
              type="button"
              onClick={onToggleBlock}
              className={`flex min-h-[48px] w-full items-center gap-3 px-4 py-3 text-left text-sm font-bold hover:bg-red-50 ${
                isBlocked ? 'text-[#0E7A34]' : 'text-red-600'
              }`}
            >
              <Ban className="h-4 w-4" />
              <span>{isBlocked ? `Desbloquear ${target.name}` : `Bloquear ${target.name}`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ChatShortcutModalProps {
  peerName: string;
  peerUid: string;
  hasShortcut: boolean;
  onToggleInAppShortcut: () => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const ChatShortcutModal: React.FC<ChatShortcutModalProps> = ({
  peerName,
  peerUid,
  hasShortcut,
  onToggleInAppShortcut,
  onClose,
  onNotify,
}) => {
  const [copied, setCopied] = useState(false);
  const shortcutUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?openChat=${encodeURIComponent(peerUid)}`
      : `/?openChat=${encodeURIComponent(peerUid)}`;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shortcutUrl);
      setCopied(true);
      onNotify('Link do atalho copiado!');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify('Não foi possível copiar o link.');
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `ChatFi · ${peerName}`,
          text: `Atalho direto para conversar com ${peerName} no ChatFi`,
          url: shortcutUrl,
        });
        return;
      } catch {
        // user cancelled or unavailable
      }
    }
    await handleCopyLink();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Atalho para conversa"
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-t-3xl bg-white p-5 pb-safe shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-[#0E7A34]">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Atalho da conversa</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Acesso direto para abrir o chat com <strong>{peerName}</strong> em um toque.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Link direto do atalho
          </p>
          <p className="mt-1 truncate font-mono text-xs text-slate-700">{shortcutUrl}</p>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              onToggleInAppShortcut();
            }}
            className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition ${
              hasShortcut
                ? 'border border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
                : 'bg-[#0E7A34] text-white hover:bg-[#0B5D27]'
            }`}
          >
            {hasShortcut ? (
              <>
                <Trash2 className="h-4 w-4 text-slate-500" />
                <span>Remover dos atalhos rápidos do ChatFi</span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                <span>Fixar nos atalhos rápidos do ChatFi</span>
              </>
            )}
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800 hover:bg-slate-50"
            >
              {copied ? <Check className="h-4 w-4 text-[#0E7A34]" /> : <Copy className="h-4 w-4" />}
              <span>{copied ? 'Copiado' : 'Copiar link'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleNativeShare()}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-[#0E7A34] hover:brightness-95"
            >
              <Share2 className="h-4 w-4" />
              <span>Enviar / Salvar</span>
            </button>
          </div>

          <p className="mt-1 text-center text-[11px] leading-relaxed text-slate-500">
            Dica: abra o link acima no navegador e toque em &ldquo;Adicionar à tela inicial&rdquo; para criar um ícone direto no celular.
          </p>
        </div>
      </div>
    </div>
  );
};

interface ChatLockPinModalProps {
  mode: 'create_and_lock' | 'verify_unlock' | 'verify_to_remove';
  targetLabel?: string;
  onSubmitPin: (pin: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

export const ChatLockPinModal: React.FC<ChatLockPinModalProps> = ({
  mode,
  targetLabel,
  onSubmitPin,
  onClose,
}) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanPin = pin.replace(/\D/g, '');
    if (cleanPin.length < 4 || cleanPin.length > 6) {
      setError('Digite uma senha numérica de 4 a 6 dígitos.');
      return;
    }
    if (mode === 'create_and_lock') {
      const cleanConfirm = confirmPin.replace(/\D/g, '');
      if (cleanPin !== cleanConfirm) {
        setError('As senhas digitadas não conferem.');
        return;
      }
    }
    setBusy(true);
    try {
      const res = await onSubmitPin(cleanPin);
      if (!res.ok) {
        setError(res.error || 'Senha incorreta.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Senha das conversas trancadas"
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
      onClick={() => !busy && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm overflow-hidden rounded-t-3xl bg-white p-5 pb-safe shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-[#0E7A34]">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {mode === 'create_and_lock'
                  ? 'Criar senha para trancar conversa'
                  : mode === 'verify_to_remove'
                    ? 'Destrancar conversa'
                    : 'Conversas trancadas'}
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                {mode === 'create_and_lock'
                  ? 'Defina um PIN de 4 a 6 dígitos para ocultar e proteger conversas trancadas.'
                  : targetLabel
                    ? `Digite sua senha para ${mode === 'verify_to_remove' ? 'destrancar' : 'acessar'} ${targetLabel}.`
                    : 'Digite sua senha para visualizar suas conversas trancadas.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Senha numérica (4 a 6 dígitos)
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••"
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-center font-mono text-lg font-bold tracking-[0.4em] text-slate-900 focus:border-[#0E7A34] focus:bg-white focus:outline-none"
            />
          </div>

          {mode === 'create_and_lock' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Confirmar senha
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) =>
                  setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="••••"
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-center font-mono text-lg font-bold tracking-[0.4em] text-slate-900 focus:border-[#0E7A34] focus:bg-white focus:outline-none"
              />
            </div>
          )}

          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || pin.length < 4}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] text-sm font-bold text-white hover:bg-[#0B5D27] disabled:opacity-50"
          >
            <Lock className="h-4 w-4" />
            <span>
              {mode === 'create_and_lock'
                ? 'Salvar e trancar'
                : mode === 'verify_to_remove'
                  ? 'Destrancar'
                  : 'Desbloquear'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};

interface AddToListModalProps {
  targetChatIds: string[];
  targetTitle: string;
  lists: ChatCustomList[];
  onToggleChatInList: (listId: string, chatIds: string[]) => void;
  onCreateListAndAdd: (name: string, chatIds: string[]) => void;
  onDeleteList: (listId: string) => void;
  onClose: () => void;
}

export const AddToListModal: React.FC<AddToListModalProps> = ({
  targetChatIds,
  targetTitle,
  lists,
  onToggleChatInList,
  onCreateListAndAdd,
  onDeleteList,
  onClose,
}) => {
  const [newListName, setNewListName] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newListName.trim().slice(0, 40);
    if (!trimmed) return;
    onCreateListAndAdd(trimmed, targetChatIds);
    setNewListName('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Adicionar à lista"
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[82dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3.5">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">Adicionar à lista</h3>
            <p className="truncate text-xs text-slate-500">{targetTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newListName}
              maxLength={40}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="Nova lista (ex.: Clientes VIP, Fábricas)..."
              className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-[#0E7A34] focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newListName.trim()}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-45"
            >
              <FolderPlus className="h-4 w-4" />
              <span>Criar</span>
            </button>
          </div>
        </form>

        <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto pb-safe">
          {lists.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Você ainda não criou nenhuma lista personalizada. Digite um nome acima para organizar suas conversas por categorias.
            </div>
          ) : (
            lists.map((list) => {
              const allIncluded =
                targetChatIds.length > 0 &&
                targetChatIds.every((id) => list.chatIds.includes(id));
              return (
                <div
                  key={list.id}
                  className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50"
                >
                  <button
                    type="button"
                    onClick={() => onToggleChatInList(list.id, targetChatIds)}
                    className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                        allIncluded
                          ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {allIncluded && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{list.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {list.chatIds.length}{' '}
                        {list.chatIds.length === 1 ? 'conversa' : 'conversas'}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteList(list.id)}
                    title={`Excluir lista ${list.name}`}
                    aria-label={`Excluir lista ${list.name}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 p-3 pb-safe">
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white hover:bg-slate-800"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};

interface ChatActionConfirmModalProps {
  kind: 'clear' | 'delete_chat' | 'block' | 'unblock';
  count: number;
  targetName?: string;
  onConfirm: (opts?: { deleteLocalMedia?: boolean }) => Promise<void> | void;
  onClose: () => void;
}

export const ChatActionConfirmModal: React.FC<ChatActionConfirmModalProps> = ({
  kind,
  count,
  targetName,
  onConfirm,
  onClose,
}) => {
  const [deleteLocalMedia, setDeleteLocalMedia] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const title =
    kind === 'clear'
      ? count > 1
        ? `Limpar ${count} conversas?`
        : 'Limpar esta conversa?'
      : kind === 'delete_chat'
        ? count > 1
          ? `Apagar ${count} conversas?`
          : 'Apagar esta conversa?'
        : kind === 'block'
          ? count > 1
            ? `Bloquear ${count} contatos?`
            : `Bloquear ${targetName || 'este contato'}?`
          : count > 1
            ? `Desbloquear ${count} contatos?`
            : `Desbloquear ${targetName || 'este contato'}?`;

  const description =
    kind === 'clear'
      ? 'As mensagens desta conversa serão removidas da sua visualização neste aparelho, mantendo o contato na sua lista.'
      : kind === 'delete_chat'
        ? 'A conversa será removida da sua lista e as mensagens atuais serão limpas neste aparelho.'
        : kind === 'block'
          ? 'Contatos bloqueados não poderão mais enviar notificações nem ligar para você pelo ChatFi.'
          : 'Este contato voltará a poder conversar e ligar para você normalmente pelo ChatFi.';

  const confirmLabel =
    kind === 'clear'
      ? 'Limpar conversa'
      : kind === 'delete_chat'
        ? 'Apagar conversa'
        : kind === 'block'
          ? 'Bloquear'
          : 'Desbloquear';

  const isDestructive = kind === 'delete_chat' || kind === 'block' || kind === 'clear';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-t-3xl bg-white p-5 pb-safe shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
              kind === 'unblock' ? 'bg-emerald-50 text-[#0E7A34]' : 'bg-red-50 text-red-600'
            }`}
          >
            {kind === 'clear' ? (
              <Eraser className="h-5 w-5" />
            ) : kind === 'delete_chat' ? (
              <Trash2 className="h-5 w-5" />
            ) : (
              <Ban className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
          </div>
        </div>

        {(kind === 'clear' || kind === 'delete_chat') && (
          <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={deleteLocalMedia}
              onChange={(e) => setDeleteLocalMedia(e.target.checked)}
              className="h-4 w-4 rounded accent-[#0E7A34]"
            />
            <span>Apagar também fotos, áudios e vídeos salvos deste chat</span>
          </label>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm({ deleteLocalMedia });
              } finally {
                setBusy(false);
              }
            }}
            className={`flex h-11 flex-1 items-center justify-center rounded-xl px-4 text-sm font-bold text-white transition disabled:opacity-60 ${
              isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0E7A34] hover:bg-[#0B5D27]'
            }`}
          >
            {busy ? 'Processando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
