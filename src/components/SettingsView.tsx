import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Edit3,
  Eye,
  EyeOff,
  Factory,
  HelpCircle,
  LifeBuoy,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Store,
} from 'lucide-react';
import type { PolicyConsentRecord } from '../lib/policyConsent';
import { sanitizeStatusMessage } from '../lib/presenceUtils';
import type { CommercialMode, ConnectedDevice, UserProfile } from '../types/zapei';
import { ConnectedDevicesCard } from './ConnectedDevicesCard';
import { CustomSoundsCard } from './CustomSoundsCard';
import { PrivacyAndPermissionsCard } from './PrivacyAndPermissionsCard';
import { PWAInstallButton } from './PWAInstallButton';
import { StorageManagerCard } from './StorageManagerCard';
import { WalletIdSplitCard } from './WalletIdSplitCard';
import type { AvatarPreviewTarget } from './AvatarLightboxModal';

interface SettingsViewProps {
  profile: UserProfile;
  connectedDevices: ConnectedDevice[];
  currentDeviceId: string;
  onDisconnectDevice: (device: ConnectedDevice) => Promise<void>;
  policyConsent: PolicyConsentRecord | null;
  onOpenPolicies: () => void;
  onEditProfile: () => void;
  onPreviewAvatar?: (target: AvatarPreviewTarget) => void;
  onUpdatePresencePrivacy: (opts: {
    showOnlineStatus: boolean;
    showLastSeen: boolean;
  }) => Promise<void>;
  onSelectMode: (mode: CommercialMode) => void;
  onSaveWalletId?: (walletId: string) => Promise<void>;
  onOpenBilling: () => void;
  onOpenCommercialPanel: () => void;
  onOpenHelp?: () => void;
  openTicketCount?: number;
  onNotify?: (message: string) => void;
  onSignOut: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profile,
  connectedDevices,
  currentDeviceId,
  onDisconnectDevice,
  policyConsent,
  onOpenPolicies,
  onEditProfile,
  onPreviewAvatar,
  onUpdatePresencePrivacy,
  onSelectMode,
  onSaveWalletId,
  onOpenBilling,
  onOpenCommercialPanel,
  onOpenHelp,
  openTicketCount = 0,
  onNotify,
  onSignOut,
}) => {
  const [copiedLine, setCopiedLine] = useState(false);
  const [presenceSaving, setPresenceSaving] = useState(false);

  const showOnlineStatus = profile.showOnlineStatus !== false;
  const showLastSeen = profile.showLastSeen !== false;
  const cleanStatus = sanitizeStatusMessage(profile.statusMessage);

  const handleTogglePresence = async (next: {
    showOnlineStatus: boolean;
    showLastSeen: boolean;
  }) => {
    if (presenceSaving) return;
    setPresenceSaving(true);
    try {
      await onUpdatePresencePrivacy(next);
    } finally {
      setPresenceSaving(false);
    }
  };

  const handleCopyVirtualLine = async () => {
    if (!profile.virtualLine) return;
    try {
      await navigator.clipboard.writeText(profile.virtualLine);
      setCopiedLine(true);
      window.setTimeout(() => setCopiedLine(false), 2000);
    } catch {
      // Ignore clipboard restriction
    }
  };
  return (
    <div className="mx-auto w-full max-w-4xl overflow-x-hidden px-3.5 sm:px-5 py-4 sm:py-6 pb-safe-nav md:pb-8 space-y-5">
      {/* User Identity Card */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={() =>
                onPreviewAvatar?.({
                  name: profile.name,
                  initials: profile.initials,
                  avatarBg: profile.avatarBg,
                  avatarUrl: profile.avatarUrl,
                  phone: profile.phone,
                  virtualLine: profile.virtualLine,
                  subtitle: cleanStatus,
                })
              }
              title="Ampliar foto de perfil"
              aria-label="Ampliar foto de perfil"
              className="shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/40"
            >
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.name}
                  className="h-14 w-14 shrink-0 rounded-full object-cover border border-slate-200"
                />
              ) : (
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
                  style={{ backgroundColor: profile.avatarBg || '#0E7A34' }}
                >
                  {profile.initials}
                </div>
              )}
            </button>
            <div>
              <h1 className="text-lg font-bold text-slate-900">{profile.name}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <p className="font-mono text-xs text-slate-600 tabular-nums">
                  {profile.virtualLine || profile.phone}
                </p>
                {profile.virtualLine && (
                  <button
                    type="button"
                    onClick={() => void handleCopyVirtualLine()}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-[#0E7A34] transition hover:bg-emerald-100"
                  >
                    {copiedLine ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        Copiada
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Linha Virtual
                      </>
                    )}
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{cleanStatus}</span>
                <span className="text-slate-300">•</span>
                {showOnlineStatus ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#0E7A34]">
                    <span className="h-2 w-2 rounded-full bg-[#0E7A34]" />
                    online
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-slate-500">
                    <EyeOff className="h-3.5 w-3.5" />
                    Status online oculto
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onEditProfile}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Edit3 className="h-4 w-4" />
              Editar Perfil
            </button>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 text-xs font-semibold text-red-700 hover:bg-red-100"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </div>
        </div>
      </section>

      {/* WhatsApp-Style Presence Privacy Controls (Online & Visto por último) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#0E7A34]">
              {showOnlineStatus || showLastSeen ? (
                <Eye className="h-5 w-5" />
              ) : (
                <EyeOff className="h-5 w-5 text-slate-600" />
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Visto por último e Online
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Escolha se seus contatos podem ver quando você está online ou o horário do seu último acesso.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={presenceSaving}
            onClick={() =>
              void handleTogglePresence(
                showOnlineStatus || showLastSeen
                  ? { showOnlineStatus: false, showLastSeen: false }
                  : { showOnlineStatus: true, showLastSeen: true }
              )
            }
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition disabled:opacity-60 ${
              !showOnlineStatus && !showLastSeen
                ? 'border-[#0E7A34] bg-emerald-50 text-[#0E7A34] hover:bg-emerald-100'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {!showOnlineStatus && !showLastSeen ? (
              <>
                <Eye className="h-3.5 w-3.5" />
                Voltar a mostrar
              </>
            ) : (
              <>
                <EyeOff className="h-3.5 w-3.5" />
                Ficar invisível
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 transition hover:border-slate-300">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <span
                  className={`h-2 w-2 rounded-full ${
                    showOnlineStatus ? 'bg-[#0E7A34]' : 'bg-slate-300'
                  }`}
                />
                Mostrar quando estou online
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {showOnlineStatus
                  ? 'Seus contatos veem "online" enquanto você usa o ChatFi.'
                  : 'Ninguém sabe quando você está com o ChatFi aberto.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showOnlineStatus}
              disabled={presenceSaving}
              onClick={() =>
                void handleTogglePresence({
                  showOnlineStatus: !showOnlineStatus,
                  showLastSeen,
                })
              }
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                showOnlineStatus ? 'bg-[#0E7A34]' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  showOnlineStatus ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 transition hover:border-slate-300">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <Clock className="h-3.5 w-3.5 text-slate-600" />
                Mostrar "visto por último"
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {showLastSeen
                  ? 'Exibe "visto por último hoje às HH:mm" ao sair.'
                  : 'O horário do seu último acesso fica oculto para todos.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showLastSeen}
              disabled={presenceSaving}
              onClick={() =>
                void handleTogglePresence({
                  showOnlineStatus,
                  showLastSeen: !showLastSeen,
                })
              }
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                showLastSeen ? 'bg-[#0E7A34]' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  showLastSeen ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">Como seus contatos veem você:</span>
          {showOnlineStatus && showLastSeen ? (
            <span className="text-[#0E7A34] font-medium">
              online · visto por último hoje às{' '}
              {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : showOnlineStatus ? (
            <span className="text-[#0E7A34] font-medium">
              online (horário de último acesso oculto)
            </span>
          ) : showLastSeen ? (
            <span className="font-medium text-slate-700">
              visto por último hoje às{' '}
              {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{' '}
              (indicador online oculto)
            </span>
          ) : (
            <span className="font-medium text-slate-600">
              Apenas "{cleanStatus}" — ninguém vê se você está online ou seu último acesso
            </span>
          )}
        </div>
      </section>

      {/* Commercial Tools Section */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Perfis e Planos
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Converse, faça chamadas e compre nas vitrines gratuitamente. Para vender ou gerenciar sua operação, selecione um perfil comercial abaixo.
            </p>
          </div>

          {(profile.manufacturerActivated || profile.resellerActivated) && (
            <button
              type="button"
              onClick={onOpenBilling}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100"
            >
              <CreditCard className="h-4 w-4 text-[#0E7A34]" />
              {profile.subscriptionStatus === 'active'
                ? 'Plano Ativo — R$ 59,90/mês'
                : profile.subscriptionStatus === 'trial'
                  ? `Teste: ${profile.trialDaysLeft} dias restantes`
                  : 'Vitrine Pausada — Renovar'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* Standard Free Mode */}
          <button
            type="button"
            onClick={() => onSelectMode('buyer')}
            className={`flex flex-col justify-between rounded-2xl border p-4 text-left transition ${
              profile.commercialMode === 'buyer'
                ? 'border-[#0E7A34] bg-emerald-50/60 ring-1 ring-[#0E7A34]'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <MessageSquare className="h-6 w-6 text-[#0E7A34]" />
                {profile.commercialMode === 'buyer' && (
                  <CheckCircle2 className="h-5 w-5 text-[#0E7A34]" />
                )}
              </div>
              <h3 className="mt-3 text-sm font-bold text-slate-900">
                Uso Pessoal
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Mensagens instantâneas, chamadas de voz e vídeo, agenda de contatos e compras diretas nas vitrines.
              </p>
            </div>
            <span className="mt-3 text-xs font-bold text-[#0E7A34]">
              Gratuito para sempre
            </span>
          </button>

          {/* Manufacturer Mode */}
          <button
            type="button"
            onClick={() => onSelectMode('manufacturer')}
            className={`flex flex-col justify-between rounded-2xl border p-4 text-left transition ${
              profile.commercialMode === 'manufacturer'
                ? 'border-[#0D2B3E] bg-slate-100 ring-1 ring-[#0D2B3E]'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <Factory className="h-6 w-6 text-[#0D2B3E]" />
                {profile.commercialMode === 'manufacturer' && (
                  <CheckCircle2 className="h-5 w-5 text-[#0D2B3E]" />
                )}
              </div>
              <h3 className="mt-3 text-sm font-bold text-slate-900">
                Sou Fabricante
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Catálogo atacadista completo, controle rápido de estoque, conferência ágil de pedidos e gestão de envios.
              </p>
            </div>
            <span className="mt-3 text-xs font-bold text-[#0D2B3E]">
              {profile.manufacturerActivated
                ? 'Perfil ativado • Abrir painel'
                : '30 dias grátis • R$ 59,90/mês'}
            </span>
          </button>

          {/* Reseller Mode */}
          <button
            type="button"
            onClick={() => onSelectMode('reseller')}
            className={`flex flex-col justify-between rounded-2xl border p-4 text-left transition ${
              profile.commercialMode === 'reseller'
                ? 'border-[#0E7A34] bg-emerald-50/60 ring-1 ring-[#0E7A34]'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <Store className="h-6 w-6 text-[#0E7A34]" />
                {profile.commercialMode === 'reseller' && (
                  <CheckCircle2 className="h-5 w-5 text-[#0E7A34]" />
                )}
              </div>
              <h3 className="mt-3 text-sm font-bold text-slate-900">
                Sou Revendedor
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Conexão direta com fábricas, vitrine personalizada, precificação automática por margem e controle financeiro integrado.
              </p>
            </div>
            <span className="mt-3 text-xs font-bold text-[#0E7A34]">
              {profile.resellerActivated
                ? 'Perfil ativado • Abrir painel'
                : '30 dias grátis • R$ 59,90/mês'}
            </span>
          </button>
        </div>

        {profile.commercialMode !== 'buyer' && (
          <div className="space-y-4 pt-1">
            {onSaveWalletId && (
              <WalletIdSplitCard
                currentWalletId={profile.asaasWalletId}
                onSaveWalletId={onSaveWalletId}
                roleHint={
                  profile.commercialMode === 'manufacturer'
                    ? 'Receba automaticamente sua cota de produção via Split Asaas nos pedidos.'
                    : 'Receba automaticamente sua comissão de vendas via Split Asaas nos pedidos.'
                }
              />
            )}

            <button
              type="button"
              onClick={onOpenCommercialPanel}
              className="h-11 w-full rounded-xl bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27]"
            >
              Abrir Painel{' '}
              {profile.commercialMode === 'manufacturer' ? 'do Fabricante' : 'do Revendedor'}
            </button>
          </div>
        )}
      </section>

      {/* Connected Devices (Primary Session + Remote Disconnect) */}
      <ConnectedDevicesCard
        devices={connectedDevices}
        currentDeviceId={currentDeviceId}
        onDisconnectDevice={onDisconnectDevice}
      />

      {/* WhatsApp-Style Local Media Storage Manager (IndexedDB per chat + manual cleanup) */}
      <StorageManagerCard onNotify={onNotify} />

      {/* Custom Phone Sounds for Calls, Text Messages, and Audio Messages */}
      <CustomSoundsCard onNotify={onNotify} />

      {/* Privacy & Terms of Responsibility */}
      <PrivacyAndPermissionsCard
        consent={policyConsent}
        onOpenPolicies={onOpenPolicies}
      />

      {/* Central de Ajuda e Suporte */}
      {onOpenHelp && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#0E7A34]">
              <LifeBuoy className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Central de Ajuda e Suporte
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Tire dúvidas por perfil (Comprador, Revendedor ou Fabricante), abra chamados ou fale diretamente com o Suporte Oficial ChatFi.
                {openTicketCount > 0 && (
                  <span className="font-semibold text-[#0E7A34]">
                    {' '}· {openTicketCount} chamado(s) em andamento
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenHelp}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0D2B3E] px-4 text-xs font-semibold text-white transition hover:bg-[#143d57]"
          >
            <HelpCircle className="h-4 w-4" />
            Abrir Ajuda e Suporte
          </button>
        </section>
      )}

      {/* PWA Install & Mobile Share Target Info */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#0E7A34]" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Instalar ChatFi no Aparelho
            </h3>
            <p className="text-xs text-slate-500">
              Adicione o ChatFi na tela inicial para abrir em tela cheia e fazê-lo aparecer automaticamente no botão <strong>Compartilhar</strong> do seu celular para enviar imagens, vídeos e áudios direto para suas conversas.
            </p>
          </div>
        </div>
        <PWAInstallButton />
      </section>
    </div>
  );
};
