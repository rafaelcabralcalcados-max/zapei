import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Store,
  Trash2,
  Upload,
  UserPlus,
  Video,
} from 'lucide-react';
import type { Contact } from '../types/zapei';
import type { PhoneLookupResult } from '../lib/firebase';
import {
  formatPhoneDisplay,
  normalizePhoneDigits,
  parseVCardText,
  pickRealDeviceContacts,
  shareRealZapeiInvite,
  supportsNativeContactPicker,
} from '../lib/phoneUtils';

interface ContactsViewProps {
  currentUserUid: string;
  contacts: Contact[];
  onLookupPhone: (rawPhone: string) => Promise<PhoneLookupResult | null>;
  onSaveContact: (name: string, phone: string) => Promise<{ matched: boolean; matchedName?: string }>;
  onImportBatchContacts: (
    entries: Array<{ name: string; phone: string }>
  ) => Promise<{ total: number; matched: number }>;
  onResyncContacts: () => Promise<number>;
  onMarkInvited: (contactId: string) => Promise<void>;
  onDeleteContact: (contactId: string) => Promise<void>;
  onOpenChat: (contact: Contact) => void;
  onOpenStorefront: (contact: Contact) => void;
  onStartCall: (contact: Contact, type: 'audio' | 'video') => void;
  onOpenDirectFoundChat: (found: PhoneLookupResult, rawPhone: string) => Promise<void>;
  onStartDirectFoundCall: (
    found: PhoneLookupResult,
    rawPhone: string,
    type: 'audio' | 'video'
  ) => Promise<void>;
}

export const ContactsView: React.FC<ContactsViewProps> = ({
  currentUserUid,
  contacts,
  onLookupPhone,
  onSaveContact,
  onImportBatchContacts,
  onResyncContacts,
  onMarkInvited,
  onDeleteContact,
  onOpenChat,
  onOpenStorefront,
  onStartCall,
  onOpenDirectFoundChat,
  onStartDirectFoundCall,
}) => {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState('');
  const [liveLookupBusy, setLiveLookupBusy] = useState(false);
  const [liveLookupResult, setLiveLookupResult] = useState<PhoneLookupResult | null>(null);
  const [liveLookupCheckedPhone, setLiveLookupCheckedPhone] = useState('');

  const vcfInputRef = useRef<HTMLInputElement | null>(null);
  const hasNativePicker = supportsNativeContactPicker();

  const searchDigits = search.replace(/\D/g, '');
  const looksLikePhoneQuery =
    searchDigits.length >= 10 && !/[a-zA-ZÀ-ÿ]/.test(search.trim());

  useEffect(() => {
    if (!looksLikePhoneQuery) {
      setLiveLookupResult(null);
      setLiveLookupCheckedPhone('');
      setLiveLookupBusy(false);
      return undefined;
    }

    const normalized = normalizePhoneDigits(search);
    if (normalized.length < 10) return undefined;

    let cancelled = false;
    setLiveLookupBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await onLookupPhone(search);
        if (cancelled) return;
        setLiveLookupResult(found && found.uid !== currentUserUid ? found : null);
        setLiveLookupCheckedPhone(formatPhoneDisplay(search));
      } catch {
        if (!cancelled) {
          setLiveLookupResult(null);
          setLiveLookupCheckedPhone(formatPhoneDisplay(search));
        }
      } finally {
        if (!cancelled) setLiveLookupBusy(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, looksLikePhoneQuery, currentUserUid, onLookupPhone]);

  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.storefrontName || '').toLowerCase().includes(q)
    );
  });

  const onZapeiContacts = filtered.filter((c) => c.onZapei);
  const inviteContacts = filtered.filter((c) => !c.onZapei);

  const handleNativeDeviceSync = async () => {
    setBusy(true);
    setStatusFeedback('');
    try {
      const picked = await pickRealDeviceContacts();
      if (picked.length === 0) {
        setStatusFeedback('Nenhum contato selecionado da agenda do aparelho.');
        return;
      }
      const res = await onImportBatchContacts(picked);
      setStatusFeedback(
        `${res.total} contato(s) importado(s) da agenda · ${res.matched} encontrado(s) no Zapei.`
      );
    } catch {
      setStatusFeedback(
        'O seletor nativo de agenda é suportado em navegadores móveis compatíveis (ex: Android Chrome). No computador ou iOS, importe seu arquivo .vcf.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleVcfFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setStatusFeedback('');
    try {
      const text = await file.text();
      const parsed = parseVCardText(text);
      if (parsed.length === 0) {
        setStatusFeedback('Nenhum número de telefone válido encontrado no arquivo .vcf.');
        return;
      }
      const limited = parsed.slice(0, 100);
      const res = await onImportBatchContacts(limited);
      setStatusFeedback(
        `${res.total} contato(s) lido(s) do vCard · ${res.matched} já usa(m) o Zapei.`
      );
    } catch {
      setStatusFeedback('Erro ao ler o arquivo .vcf de contatos.');
    } finally {
      setBusy(false);
    }
  };

  const handleResync = async () => {
    setBusy(true);
    setStatusFeedback('');
    try {
      const matched = await onResyncContacts();
      setStatusFeedback(
        `Agenda verificada em tempo real: ${matched} contato(s) ativo(s) no Zapei.`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) return;
    setBusy(true);
    setStatusFeedback('');
    try {
      const res = await onSaveContact(newName.trim(), newPhone.trim());
      setStatusFeedback(
        res.matched
          ? `${newName.trim()} salvo e encontrado no Zapei (${res.matchedName})!`
          : `${newName.trim()} salvo na sua agenda. Ainda não possui conta no Zapei — você pode enviar um convite abaixo.`
      );
      setNewName('');
      setNewPhone('');
      setShowAddForm(false);
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = async (contact: Contact) => {
    const outcome = await shareRealZapeiInvite(contact.name, contact.phone);
    await onMarkInvited(contact.id);
    setStatusFeedback(
      outcome === 'shared'
        ? `Convite compartilhado com ${contact.name}.`
        : `Link de convite copiado para enviar para ${contact.name} (${contact.phone}).`
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 pb-24 md:pb-8">
      <input
        ref={vcfInputRef}
        type="file"
        accept=".vcf,text/vcard"
        onChange={handleVcfFileSelected}
        className="hidden"
      />

      {/* Top Action Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Contatos da Agenda</h1>
            <p className="text-xs text-slate-500">
              Encontre quem da sua agenda já usa o Zapei para conversar, ligar ou ver a vitrine.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasNativePicker && (
              <button
                type="button"
                onClick={() => void handleNativeDeviceSync()}
                disabled={busy}
                className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#0F5132] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#146c43] disabled:opacity-50"
              >
                <Smartphone className="h-4 w-4" />
                Sincronizar Agenda
              </button>
            )}
            <button
              type="button"
              onClick={() => vcfInputRef.current?.click()}
              disabled={busy}
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              Importar .vcf
            </button>
            {contacts.length > 0 && (
              <button
                type="button"
                onClick={() => void handleResync()}
                disabled={busy}
                className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                Verificar
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#0D2B3E] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#143d57]"
            >
              <UserPlus className="h-4 w-4" />
              + Salvar número
            </button>
          </div>
        </div>

        {statusFeedback && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-[#0F5132]">
            {statusFeedback}
          </div>
        )}

        {/* Quick Add Phone Form */}
        {showAddForm && (
          <form
            onSubmit={handleAddSingle}
            className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:grid-cols-3"
          >
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                Nome do contato
              </label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Maria Calçados"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0F5132] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                Telefone com DDD
              </label>
              <input
                type="tel"
                required
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0F5132] focus:outline-none"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={busy}
                className="h-10 flex-1 rounded-lg bg-[#0F5132] px-4 text-xs font-semibold text-white hover:bg-[#146c43] disabled:opacity-50"
              >
                Salvar e verificar
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Search Input with Instant Phone Lookup */}
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar contato ou digitar número com DDD (ex: 37 99999-9999)..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-10 text-sm text-slate-900 focus:border-[#0F5132] focus:bg-white focus:outline-none"
          />
          {liveLookupBusy && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#0F5132]" />
          )}
        </div>

        {/* Instant Live Lookup Result Card */}
        {looksLikePhoneQuery && !liveLookupBusy && liveLookupResult && (
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {liveLookupResult.avatarUrl ? (
                <img
                  src={liveLookupResult.avatarUrl}
                  alt={liveLookupResult.displayName}
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: liveLookupResult.avatarColor || '#0F5132' }}
                >
                  {liveLookupResult.initials}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-slate-900">
                    {liveLookupResult.displayName}
                  </span>
                  <span className="rounded-md bg-[#0F5132] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    No Zapei
                  </span>
                </div>
                <p className="font-mono text-xs text-slate-600 tabular-nums">
                  {liveLookupCheckedPhone}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void onOpenDirectFoundChat(liveLookupResult, search)}
                className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0F5132] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#146c43]"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Conversar
              </button>
              <button
                type="button"
                onClick={() => void onStartDirectFoundCall(liveLookupResult, search, 'audio')}
                title="Ligação de voz"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-white text-[#0F5132] hover:bg-emerald-50"
              >
                <Phone className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void onStartDirectFoundCall(liveLookupResult, search, 'video')}
                title="Chamada de vídeo"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-white text-[#0D2B3E] hover:bg-emerald-50"
              >
                <Video className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onSaveContact(liveLookupResult.displayName, search);
                    setStatusFeedback(`${liveLookupResult.displayName} salvo na sua agenda.`);
                    setSearch('');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex min-h-[38px] items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Salvar
              </button>
            </div>
          </div>
        )}

        {looksLikePhoneQuery && !liveLookupBusy && !liveLookupResult && liveLookupCheckedPhone && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
            <span>
              <strong className="font-mono text-slate-800">{liveLookupCheckedPhone}</strong> ainda não entrou no Zapei.
            </span>
            <button
              type="button"
              onClick={async () => {
                await shareRealZapeiInvite(liveLookupCheckedPhone, search);
                setStatusFeedback(`Convite preparado para ${liveLookupCheckedPhone}.`);
              }}
              className="inline-flex items-center gap-1 font-semibold text-[#0F5132] hover:underline"
            >
              <Send className="h-3.5 w-3.5" />
              Enviar convite
            </button>
          </div>
        )}
      </div>

      {/* Empty State */}
      {contacts.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <Smartphone className="mx-auto h-10 w-10 text-slate-400" />
          <h2 className="mt-3 text-base font-bold text-slate-900">
            Encontre seus contatos no Zapei
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
            Digite qualquer <strong>número com DDD</strong> na barra de busca acima para achar quem já tem o Zapei e começar a conversar ou ligar na hora — sem precisar importar nada. Se preferir, salve números em <strong>+ Salvar número</strong> ou importe sua agenda.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {/* On Zapei Section */}
          <section>
            <div className="mb-2.5 flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                No Zapei ({onZapeiContacts.length})
              </h2>
            </div>

            {onZapeiContacts.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
                Nenhum contato da sua lista ainda ativou conta no Zapei com o número salvo. Clique em{' '}
                <strong>Verificar</strong> após um contato criar conta ou envie um convite abaixo.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {onZapeiContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                        style={{ backgroundColor: contact.avatarBg || '#0F5132' }}
                      >
                        {contact.initials}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-bold text-slate-900">
                            {contact.name}
                          </span>
                          {contact.hasStorefront && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-[#0F5132]">
                              <Store className="h-3 w-3" />
                              Vitrine Ativa
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-xs text-slate-500 tabular-nums">
                          {contact.phone}
                          {contact.storefrontName ? ` · ${contact.storefrontName}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {contact.hasStorefront && (
                        <button
                          type="button"
                          onClick={() => onOpenStorefront(contact)}
                          className="flex min-h-[38px] items-center gap-1 rounded-lg bg-[#0F5132] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#146c43]"
                        >
                          <Store className="h-3.5 w-3.5" />
                          Ver Vitrine
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenChat(contact)}
                        className="flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Conversar
                      </button>
                      <button
                        type="button"
                        onClick={() => onStartCall(contact, 'audio')}
                        title="Ligação de voz"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#0F5132]"
                      >
                        <Phone className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onStartCall(contact, 'video')}
                        title="Chamada de vídeo"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#0D2B3E]"
                      >
                        <Video className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteContact(contact.id)}
                        title="Remover da agenda"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Invite to Zapei Section */}
          <section>
            <div className="mb-2.5 flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Convidar para o Zapei ({inviteContacts.length})
              </h2>
            </div>

            {inviteContacts.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
                Todos os seus contatos salvos já estão no Zapei.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {inviteContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center justify-between gap-3 p-3.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                        {contact.initials}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {contact.name}
                        </p>
                        <p className="font-mono text-xs text-slate-500 tabular-nums">
                          {contact.phone}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleInvite(contact)}
                        className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          contact.invited
                            ? 'border border-emerald-200 bg-emerald-50 text-[#0F5132]'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {contact.invited ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            Reenviar convite
                          </>
                        ) : (
                          <>
                            <Send className="h-3.5 w-3.5" />
                            Convidar
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteContact(contact.id)}
                        title="Remover da agenda"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
