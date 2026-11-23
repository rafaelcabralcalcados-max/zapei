import React, { useEffect, useMemo, useState } from 'react';
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
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import type { Contact } from '../types/zapei';
import type { PhoneLookupResult, PublicDirectoryUser } from '../lib/firebase';
import {
  formatPhoneDisplay,
  normalizePhoneDigits,
  pickRealDeviceContacts,
  shareRealZapeiInvite,
  supportsNativeContactPicker,
} from '../lib/phoneUtils';

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

interface ContactsViewProps {
  currentUserUid: string;
  contacts: Contact[];
  directoryUsers: PublicDirectoryUser[];
  onLookupPhone: (rawPhone: string) => Promise<PhoneLookupResult | null>;
  onSaveContact: (name: string, phone: string) => Promise<{ matched: boolean; matchedName?: string }>;
  onImportBatchContacts: (
    entries: Array<{ name: string; phone: string }>
  ) => Promise<{ total: number; matched: number }>;
  onResyncContacts: () => Promise<number>;
  onMarkInvited: (contactId: string) => Promise<void>;
  onDeleteContact: (contactId: string) => Promise<void>;
  onOpenChat: (contact: Contact, avatarUrl?: string) => void;
  onOpenStorefront: (contact: Contact) => void;
  onStartCall: (contact: Contact, type: 'audio' | 'video', avatarUrl?: string) => void;
  onOpenDirectoryChat: (user: PublicDirectoryUser) => void;
  onOpenDirectoryStorefront: (user: PublicDirectoryUser) => void;
  onStartDirectoryCall: (user: PublicDirectoryUser, type: 'audio' | 'video') => void;
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
  directoryUsers,
  onLookupPhone,
  onSaveContact,
  onImportBatchContacts,
  onResyncContacts,
  onMarkInvited,
  onDeleteContact,
  onOpenChat,
  onOpenStorefront,
  onStartCall,
  onOpenDirectoryChat,
  onOpenDirectoryStorefront,
  onStartDirectoryCall,
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

  const hasNativePicker = supportsNativeContactPicker();

  const directoryByUid = useMemo(() => {
    const map = new Map<string, PublicDirectoryUser>();
    for (const u of directoryUsers) {
      map.set(u.uid, u);
    }
    return map;
  }, [directoryUsers]);

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

  const normalizedQuery = normalizeSearchText(search);

  const filtered = contacts.filter((c) => {
    if (!normalizedQuery) return true;
    const dir = c.matchedUid ? directoryByUid.get(c.matchedUid) : undefined;
    return (
      normalizeSearchText(c.name).includes(normalizedQuery) ||
      c.phone.toLowerCase().includes(normalizedQuery) ||
      normalizeSearchText(c.storefrontName || '').includes(normalizedQuery) ||
      (dir ? normalizeSearchText(dir.displayName).includes(normalizedQuery) : false)
    );
  });

  const onZapeiContacts = filtered.filter((c) => c.onZapei);
  const inviteContacts = filtered.filter((c) => !c.onZapei);

  const savedMatchedUids = new Set(
    contacts.filter((c) => c.onZapei && c.matchedUid).map((c) => c.matchedUid as string)
  );

  const filteredDirectory = directoryUsers.filter((u) => {
    if (u.uid === currentUserUid) return false;
    if (savedMatchedUids.has(u.uid)) return false;
    if (!normalizedQuery) return true;
    return (
      normalizeSearchText(u.displayName).includes(normalizedQuery) ||
      normalizeSearchText(u.storefrontName || '').includes(normalizedQuery) ||
      normalizeSearchText(u.statusMessage || '').includes(normalizedQuery)
    );
  });

  const handleNativeDeviceSync = async () => {
    setBusy(true);
    setStatusFeedback('');
    try {
      const picked = await pickRealDeviceContacts();
      if (picked.length === 0) {
        setStatusFeedback('Nenhum contato selecionado da agenda do celular.');
        return;
      }
      const res = await onImportBatchContacts(picked);
      setStatusFeedback(
        `${res.total} contato(s) selecionado(s) · ${res.matched} encontrado(s) no Zapei.`
      );
    } catch {
      setStatusFeedback('Use a busca por nome abaixo para encontrar quem já está no Zapei.');
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
        `Lista atualizada: ${matched} contato(s) ativo(s) no Zapei.`
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
          : `${newName.trim()} salvo. Ainda não possui conta no Zapei — você pode enviar um convite abaixo.`
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
    <div className="mx-auto w-full max-w-4xl overflow-x-hidden px-3.5 sm:px-4 py-4 sm:py-5 pb-safe-nav md:pb-8">
      {/* Top Action Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Contatos</h1>
            <p className="text-xs text-slate-500">
              Digite o nome da pessoa para encontrar quem já está no Zapei com foto, conversar ou ligar.
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
                Agenda do celular
              </button>
            )}
            {contacts.length > 0 && (
              <button
                type="button"
                onClick={() => void handleResync()}
                disabled={busy}
                className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#0D2B3E] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#143d57]"
            >
              <UserPlus className="h-4 w-4" />
              + Novo contato
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
            autoComplete="off"
            className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:grid-cols-3"
          >
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                Nome do contato
              </label>
              <input
                type="text"
                required
                autoComplete="off"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Beatriz"
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
                autoComplete="off"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="(37) 99999-9999"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0F5132] focus:outline-none"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={busy}
                className="h-10 flex-1 rounded-lg bg-[#0F5132] px-4 text-xs font-semibold text-white hover:bg-[#146c43] disabled:opacity-50"
              >
                Salvar
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

        {/* Search Input with Instant Name & Phone Search (Autofill disabled) */}
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            name="zapei_contact_search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pessoa pelo nome, vitrine ou número..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-10 text-sm text-slate-900 focus:border-[#0F5132] focus:bg-white focus:outline-none"
          />
          {liveLookupBusy ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#0F5132]" />
          ) : search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* Instant Live Lookup Result Card (when typing a phone number) */}
        {looksLikePhoneQuery && !liveLookupBusy && liveLookupResult && (
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {liveLookupResult.avatarUrl ? (
                <img
                  src={liveLookupResult.avatarUrl}
                  alt={liveLookupResult.displayName}
                  className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-emerald-200"
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
                    setStatusFeedback(`${liveLookupResult.displayName} salvo na sua lista.`);
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

      {/* Saved Contacts Already on Zapei (shown first when user has saved contacts) */}
      {onZapeiContacts.length > 0 && (
        <section className="mt-5">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Seus Contatos no Zapei ({onZapeiContacts.length})
            </h2>
          </div>

          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {onZapeiContacts.map((contact) => {
              const dir = contact.matchedUid ? directoryByUid.get(contact.matchedUid) : undefined;
              const photoUrl = dir?.avatarUrl;
              return (
                <div
                  key={contact.id}
                  className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <button
                    type="button"
                    onClick={() => onOpenChat(contact, photoUrl)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={contact.name}
                        className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                      />
                    ) : (
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                        style={{ backgroundColor: contact.avatarBg || '#0F5132' }}
                      >
                        {contact.initials}
                      </div>
                    )}
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
                      <p className="truncate text-xs text-slate-500">
                        {contact.storefrontName
                          ? contact.storefrontName
                          : dir?.statusMessage || contact.phone}
                      </p>
                    </div>
                  </button>

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
                      onClick={() => onOpenChat(contact, photoUrl)}
                      className="flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Conversar
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartCall(contact, 'audio', photoUrl)}
                      title="Ligação de voz"
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#0F5132]"
                    >
                      <Phone className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartCall(contact, 'video', photoUrl)}
                      title="Chamada de vídeo"
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#0D2B3E]"
                    >
                      <Video className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteContact(contact.id)}
                      title="Remover contato"
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Live Directory: Pessoas no Zapei (Instant Name Search with Photos) */}
      {filteredDirectory.length > 0 && (
        <section className="mt-5">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Pessoas no Zapei ({filteredDirectory.length})
            </h2>
          </div>

          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {filteredDirectory.map((person) => (
              <div
                key={person.uid}
                className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <button
                  type="button"
                  onClick={() => onOpenDirectoryChat(person)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  {person.avatarUrl ? (
                    <img
                      src={person.avatarUrl}
                      alt={person.displayName}
                      className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                    />
                  ) : (
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{ backgroundColor: person.avatarColor || '#0F5132' }}
                    >
                      {person.initials}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-bold text-slate-900">
                        {person.displayName}
                      </span>
                      {person.hasStorefront && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-[#0F5132]">
                          <Store className="h-3 w-3" />
                          Vitrine Ativa
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {person.hasStorefront && person.storefrontName
                        ? person.storefrontName
                        : person.statusMessage || 'Disponível no Zapei'}
                    </p>
                  </div>
                </button>

                <div className="flex flex-wrap items-center gap-1.5">
                  {person.hasStorefront && (
                    <button
                      type="button"
                      onClick={() => onOpenDirectoryStorefront(person)}
                      className="flex min-h-[38px] items-center gap-1 rounded-lg bg-[#0F5132] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#146c43]"
                    >
                      <Store className="h-3.5 w-3.5" />
                      Ver Vitrine
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenDirectoryChat(person)}
                    className="flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Conversar
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartDirectoryCall(person, 'audio')}
                    title="Ligação de voz"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#0F5132]"
                  >
                    <Phone className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartDirectoryCall(person, 'video')}
                    title="Chamada de vídeo"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#0D2B3E]"
                  >
                    <Video className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Invite to Zapei Section (only when user has saved contacts not yet registered) */}
      {inviteContacts.length > 0 && (
        <section className="mt-5">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Convidar para o Zapei ({inviteContacts.length})
            </h2>
          </div>

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
                    title="Remover contato"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty State when no matches exist */}
      {onZapeiContacts.length === 0 &&
        filteredDirectory.length === 0 &&
        inviteContacts.length === 0 && (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <Smartphone className="mx-auto h-10 w-10 text-slate-400" />
            <h2 className="mt-3 text-base font-bold text-slate-900">
              {normalizedQuery
                ? `Nenhuma pessoa chamada "${search.trim()}" no Zapei ainda`
                : 'Nenhuma outra pessoa no Zapei ainda'}
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
              Assim que a pessoa abrir o Zapei no celular dela com a versão atualizada, o nome e a foto dela aparecem automaticamente aqui para você conversar ou ligar na hora.
            </p>
          </div>
        )}
    </div>
  );
};
