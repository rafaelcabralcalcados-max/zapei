import React, { useState } from 'react';
import {
  Bell,
  Camera,
  Check,
  FileText,
  FolderCheck,
  Loader2,
  Mic,
  ShieldCheck,
  X,
} from 'lucide-react';
import { CURRENT_POLICY_VERSION, type PolicyConsentRecord } from '../lib/policyConsent';
import { ChatFiLogo } from './ChatFiLogo';

interface TermsAndPermissionsModalProps {
  mode: 'gate' | 'review';
  existingConsent?: PolicyConsentRecord | null;
  onAcceptAndAuthorize: () => Promise<void>;
  onClose?: () => void;
}

type PolicyTab = 'terms' | 'privacy';

export const TermsAndPermissionsModal: React.FC<TermsAndPermissionsModalProps> = ({
  mode,
  existingConsent,
  onAcceptAndAuthorize,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<PolicyTab>('terms');
  const [accepted, setAccepted] = useState(mode === 'review');
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy || (mode === 'gate' && !accepted)) return;
    setBusy(true);
    try {
      await onAcceptAndAuthorize();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/65 p-0 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 bg-[#0B5D27] px-5 py-4 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <ChatFiLogo className="h-10 w-10 shrink-0 rounded-xl shadow-sm ring-2 ring-white/20" />
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-tight">
                Termos de Uso e Política de Privacidade
              </h2>
              <p className="mt-0.5 text-[11px] text-emerald-100">
                ChatFi · Versão {CURRENT_POLICY_VERSION} · Segurança, LGPD e Permissões
              </p>
            </div>
          </div>

          {mode === 'review' && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Section Tabs */}
        <div className="flex shrink-0 border-b border-slate-200 bg-slate-50 px-5 pt-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('terms')}
            className={`flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-xs font-bold transition ${
              activeTab === 'terms'
                ? 'border-[#0E7A34] text-[#0E7A34]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Política de Responsabilidade
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('privacy')}
            className={`flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-xs font-bold transition ${
              activeTab === 'privacy'
                ? 'border-[#0E7A34] text-[#0E7A34]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Privacidade e Permissões
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs leading-relaxed text-slate-600">
          {activeTab === 'terms' ? (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  1. Condições Gerais e Responsabilidade do Usuário
                </h3>
                <p className="mt-1">
                  Ao utilizar o ChatFi, você declara ser integralmente responsável pelas mensagens, áudios, fotos, vídeos, catálogos e negociações enviadas por meio da sua conta e da sua Linha Virtual ou número de telefone vinculado.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  2. Conduta Adequada e Segurança da Conta
                </h3>
                <p className="mt-1">
                  É proibido utilizar o ChatFi para envio de spam, fraudes, conteúdo ilícito, violação de direitos autorais ou falsidade ideológica. O vínculo de conta por CPF permite apenas uma Linha Virtual ativa (CFI-XXXX-XXXX) por titular, garantindo autenticidade e proteção contra contas falsas.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  3. Ferramentas Comerciais e Vitrines
                </h3>
                <p className="mt-1">
                  A comunicação pessoal (mensagens e chamadas) é gratuita. Usuários que optarem por ativar vitrines comerciais de Fabricante ou Revendedor assumem total responsabilidade pelas informações de produtos, estoques, preços, prazos de entrega e acordos firmados com seus clientes.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  4. Proteção de Dados (LGPD — Lei nº 13.709/2018)
                </h3>
                <p className="mt-1">
                  Seus dados cadastrais são tratados em conformidade com a legislação brasileira. O CPF utilizado no cadastro é protegido por criptografia unidirecional (hash), e fotos, áudios e vídeos trocados ficam armazenados localmente no seu aparelho, sendo removidos automaticamente dos servidores temporários após a entrega ao destinatário.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p>
                Para oferecer uma experiência fluida, sem interrupções durante conversas e ligações, o ChatFi solicita autorização única aos seguintes recursos deste aparelho:
              </p>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0E7A34]/10 text-[#0E7A34]">
                    <Mic className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Microfone</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      Utilizado exclusivamente em chamadas de voz, videochamadas e gravação de mensagens de áudio.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0E7A34]/10 text-[#0E7A34]">
                    <Camera className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Câmera</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      Utilizada em chamadas de vídeo, captura de fotos para conversas e leitura de QR Code de vínculo.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0E7A34]/10 text-[#0E7A34]">
                    <Bell className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Notificações e Sons</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      Permite alertas sonoros e avisos de mensagens e ligações mesmo com a tela bloqueada.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0E7A34]/10 text-[#0E7A34]">
                    <FolderCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Fotos, Áudios e Mídias</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      Salva mídias recebidas no aparelho, reproduz toques personalizados e recebe arquivos compartilhados.
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                O ChatFi nunca acessa câmera, microfone ou arquivos sem a sua ação direta. Você pode gerenciar ou revogar essas permissões a qualquer momento nas configurações do aparelho.
              </p>
            </div>
          )}

          {/* Compact Resource Release Summary (always visible in gate mode) */}
          {mode === 'gate' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-2">
              <p className="text-xs font-bold text-[#0E7A34]">
                Autorização única de recursos incluída ao aceitar:
              </p>
              <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-slate-700">
                <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 ring-1 ring-emerald-200">
                  <Camera className="h-3.5 w-3.5 text-[#0E7A34]" />
                  Câmera
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 ring-1 ring-emerald-200">
                  <Mic className="h-3.5 w-3.5 text-[#0E7A34]" />
                  Microfone
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 ring-1 ring-emerald-200">
                  <Bell className="h-3.5 w-3.5 text-[#0E7A34]" />
                  Notificações
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 ring-1 ring-emerald-200">
                  <FolderCheck className="h-3.5 w-3.5 text-[#0E7A34]" />
                  Mídias locais
                </span>
              </div>
            </div>
          )}

          {mode === 'review' && existingConsent && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-[11px] font-semibold text-[#0E7A34]">
              Política versão {existingConsent.version} aceita neste aparelho em {existingConsent.acceptedAtLabel}.
            </div>
          )}
        </div>

        {/* Footer Acceptance Action */}
        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-4 pb-safe space-y-3">
          {mode === 'gate' && (
            <label className="flex cursor-pointer items-start gap-2.5 select-none">
              <button
                type="button"
                role="checkbox"
                aria-checked={accepted}
                onClick={() => setAccepted((v) => !v)}
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                  accepted
                    ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                    : 'border-slate-300 bg-white text-transparent'
                }`}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs leading-snug text-slate-700">
                Li e aceito os <strong>Termos de Uso</strong>, a{' '}
                <strong>Política de Responsabilidade</strong> e a{' '}
                <strong>Política de Privacidade (LGPD)</strong>, autorizando o acesso à câmera, microfone, notificações e armazenamento local de mídias.
              </span>
            </label>
          )}

          <div className="flex items-center justify-end gap-2">
            {mode === 'review' && onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] rounded-xl bg-[#0E7A34] px-5 text-xs font-bold text-white hover:bg-[#0B5D27]"
              >
                Fechar
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !accepted}
                onClick={() => void handleConfirm()}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#0E7A34] px-5 text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Configurando acesso...
                  </>
                ) : (
                  'Concordar e Continuar'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
