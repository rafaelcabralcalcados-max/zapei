import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  CreditCard,
  Edit3,
  Factory,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Store,
} from 'lucide-react';
import type { BackgroundPushStatus } from '../lib/pushService';
import type { PolicyConsentRecord } from '../lib/policyConsent';
import type { CommercialMode, ConnectedDevice, UserProfile } from '../types/zapei';
import { BackgroundCallPushCard } from './BackgroundCallPushCard';
import { ConnectedDevicesCard } from './ConnectedDevicesCard';
import { CustomSoundsCard } from './CustomSoundsCard';
import { PrivacyAndPermissionsCard } from './PrivacyAndPermissionsCard';
import { PWAInstallButton } from './PWAInstallButton';
import { StorageManagerCard } from './StorageManagerCard';

interface SettingsViewProps {
  profile: UserProfile;
  connectedDevices: ConnectedDevice[];
  currentDeviceId: string;
  onDisconnectDevice: (device: ConnectedDevice) => Promise<void>;
  pushStatus: BackgroundPushStatus;
  pushBusy: boolean;
  pushFeedback: string;
  onEnableBackgroundPush: () => Promise<void>;
  policyConsent: PolicyConsentRecord | null;
  onOpenPolicies: () => void;
  onAuthorizeResources: () => Promise<void>;
  onEditProfile: () => void;
  onSelectMode: (mode: CommercialMode) => void;
  onOpenBilling: () => void;
  onOpenCommercialPanel: () => void;
  onNotify?: (message: string) => void;
  onSignOut: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profile,
  connectedDevices,
  currentDeviceId,
  onDisconnectDevice,
  pushStatus,
  pushBusy,
  pushFeedback,
  onEnableBackgroundPush,
  policyConsent,
  onOpenPolicies,
  onAuthorizeResources,
  onEditProfile,
  onSelectMode,
  onOpenBilling,
  onOpenCommercialPanel,
  onNotify,
  onSignOut,
}) => {
  const [copiedLine, setCopiedLine] = useState(false);

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
    <div className="mx-auto w-full max-w-4xl overflow-x-hidden px-3.5 sm:px-4 py-4 sm:py-5 pb-safe-nav md:pb-8 space-y-5">
      {/* User Identity Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.name}
                className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-slate-100"
              />
            ) : (
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
                style={{ backgroundColor: profile.avatarBg || '#0E7A34' }}
              >
                {profile.initials}
              </div>
            )}
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
              <p className="mt-0.5 text-xs text-slate-500">{profile.statusMessage}</p>
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
          <button
            type="button"
            onClick={onOpenCommercialPanel}
            className="h-11 w-full rounded-xl bg-[#0E7A34] text-xs font-semibold text-white hover:bg-[#0B5D27]"
          >
            Abrir Painel{' '}
            {profile.commercialMode === 'manufacturer' ? 'do Fabricante' : 'do Revendedor'}
          </button>
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

      {/* Privacy, Terms of Responsibility & One-Time Device Permissions */}
      <PrivacyAndPermissionsCard
        consent={policyConsent}
        pushStatus={pushStatus}
        onOpenPolicies={onOpenPolicies}
        onAuthorizeResources={onAuthorizeResources}
      />

      {/* Real Background Call Push Notifications */}
      <BackgroundCallPushCard
        status={pushStatus}
        busy={pushBusy}
        feedback={pushFeedback}
        onEnable={onEnableBackgroundPush}
      />

      {/* PWA Install & WhatsApp Share Target Info */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#0E7A34]" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Instalar ChatFi e Receber do WhatsApp
            </h3>
            <p className="text-xs text-slate-500">
              Adicione o ChatFi na tela inicial para abrir em tela cheia e fazê-lo aparecer automaticamente no botão <strong>Compartilhar</strong> do WhatsApp para enviar imagens e áudios direto para suas conversas.
            </p>
          </div>
        </div>
        <PWAInstallButton />
      </section>
    </div>
  );
};
