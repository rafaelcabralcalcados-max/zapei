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
import type { Contact, FactoryConnection, Product } from '../types/zapei';
import {
  PRODUCT_CATEGORIES,
  type MainCategoryId,
  inferProductSubcategory,
  normalizeProductCategory,
  searchMatchesCategoryOrProduct,
} from '../lib/categories';
import { CategoryIcon } from '../lib/categoryIcons';
import type { PhoneLookupResult, PublicDirectoryUser } from '../lib/firebase';
import {
  formatPhoneDisplay,
  normalizePhoneDigits,
  pickRealDeviceContacts,
  shareRealZapeiInvite,
  supportsNativeContactPicker,
} from '../lib/phoneUtils';
import { getContactPresenceDisplay } from '../lib/presenceUtils';
import type { AvatarPreviewTarget } from './AvatarLightboxModal';
import { StarRatingBadge } from './StarRatingBadge';

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
  products?: Product[];
  connections?: FactoryConnection[];
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
  onOpenDirectoryChat?: (user: PublicDirectoryUser) => void;
  onOpenDirectoryStorefront?: (user: PublicDirectoryUser) => void;
  onStartDirectoryCall?: (user: PublicDirectoryUser, type: 'audio' | 'video') => void;
  onOpenDirectFoundChat: (found: PhoneLookupResult, rawPhone: string) => Promise<void>;
  onStartDirectFoundCall: (
    found: PhoneLookupResult,
    rawPhone: string,
    type: 'audio' | 'video'
  ) => Promise<void>;
  onPreviewAvatar?: (target: AvatarPreviewTarget) => void;
}

export const ContactsView: React.FC<ContactsViewProps> = ({
  currentUserUid,
  contacts,
  directoryUsers,
  products = [],
  connections = [],
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
  onOpenDirectFoundChat,
  onStartDirectFoundCall,
  onPreviewAvatar,
}) => {
  const [search, setSearch] = useState('');
  const [selectedDirectoryCategory, setSelectedDirectoryCategory] = useState<
    'Todas' | MainCategoryId | null
  >(null);
  const [selectedDirectorySubcategory, setSelectedDirectorySubcategory] =
    useState<string>('Todas');
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
  const trimmedSearchUpper = search.trim().toUpperCase();
  const looksLikeVirtualLineQuery = /^(CFI|ZAP)-\d{4}-\d{4}$/.test(trimmedSearchUpper);
  const looksLikePhoneQuery =
    looksLikeVirtualLineQuery ||
    (searchDigits.length >= 10 && !/[a-zA-ZÀ-ÿ]/.test(search.trim()));

  useEffect(() => {
    if (!looksLikePhoneQuery) {
      setLiveLookupResult(null);
      setLiveLookupCheckedPhone('');
      setLiveLookupBusy(false);
      return undefined;
    }

    if (!looksLikeVirtualLineQuery) {
      const normalized = normalizePhoneDigits(search);
      if (normalized.length < 10) return undefined;
    }

    let cancelled = false;
    setLiveLookupBusy(true);
    const timer = window.setTimeout(async () => {
      const label = looksLikeVirtualLineQuery
        ? trimmedSearchUpper
        : formatPhoneDisplay(search);
      try {
        const found = await onLookupPhone(looksLikeVirtualLineQuery ? trimmedSearchUpper : search);
        if (cancelled) return;
        setLiveLookupResult(found && found.uid !== currentUserUid ? found : null);
        setLiveLookupCheckedPhone(label);
      } catch {
        if (!cancelled) {
          setLiveLookupResult(null);
          setLiveLookupCheckedPhone(label);
        }
      } finally {
        if (!cancelled) setLiveLookupBusy(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, looksLikePhoneQuery, looksLikeVirtualLineQuery, trimmedSearchUpper, currentUserUid, onLookupPhone]);

  const normalizedQuery = normalizeSearchText(search);

  const filtered = contacts.filter((c) => {
    if (!normalizedQuery) return true;
    const dir = c.matchedUid ? directoryByUid.get(c.matchedUid) : undefined;
    return (
      normalizeSearchText(c.name).includes(normalizedQuery) ||
      c.phone.toLowerCase().includes(normalizedQuery) ||
      normalizeSearchText(c.storefrontName || '').includes(normalizedQuery) ||
      (dir ? normalizeSearchText(dir.displayName).includes(normalizedQuery) : false) ||
      (dir?.virtualLine
        ? normalizeSearchText(dir.virtualLine).includes(normalizedQuery)
        : false)
    );
  });

  const onZapeiContacts = filtered.filter((c) => c.onZapei);
  const inviteContacts = filtered.filter((c) => !c.onZapei);

  // Map each discoverable storefront owner to its visible catalog products (preserving factory confidentiality for resellers)
  const storefrontCatalogByUid = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const user of directoryUsers) {
      if (!user.hasStorefront || user.commercialBanned || user.uid === currentUserUid) continue;
      if (user.role === 'manufacturer') {
        const items = products.filter(
          (p) =>
            p.factoryId === user.uid &&
            !p.isSoldOutToday &&
            p.stockBoxes > 0 &&
            p.moderationStatus === 'approved'
        );
        map.set(user.uid, items);
      } else if (user.role === 'reseller') {
        const activeConns = connections.filter(
          (c) => c.resellerId === user.uid && !c.paused
        );
        const items: Product[] = [];
        for (const conn of activeConns) {
          for (const p of products) {
            if (p.factoryId !== conn.factoryId) continue;
            if (p.isSoldOutToday || p.stockBoxes <= 0 || p.moderationStatus !== 'approved') {
              continue;
            }
            if (conn.rejectedProductIds.includes(p.id)) continue;
            if (conn.reviewPhotos && !conn.approvedProductIds.includes(p.id)) continue;
            items.push(p);
          }
        }
        map.set(user.uid, items);
      }
    }
    return map;
  }, [directoryUsers, products, connections, currentUserUid]);

  const activeDirCatDef = useMemo(
    () =>
      selectedDirectoryCategory && selectedDirectoryCategory !== 'Todas'
        ? PRODUCT_CATEGORIES.find((c) => c.id === selectedDirectoryCategory) ?? null
        : null,
    [selectedDirectoryCategory]
  );

  const showStorefrontDirectoryResults =
    selectedDirectoryCategory !== null ||
    (!looksLikePhoneQuery && normalizedQuery.length >= 2);

  const filteredDirectoryStorefronts = useMemo(() => {
    if (!showStorefrontDirectoryResults) return [];
    const results: Array<{
      user: PublicDirectoryUser;
      matchingCount: number;
      totalProducts: number;
      categories: MainCategoryId[];
    }> = [];

    for (const user of directoryUsers) {
      if (!user.hasStorefront || user.commercialBanned || user.uid === currentUserUid) continue;
      const items = storefrontCatalogByUid.get(user.uid) ?? [];
      const catSet = new Set<MainCategoryId>();
      for (const p of items) {
        catSet.add(normalizeProductCategory(p.category));
      }

      const matchingProducts = items.filter((p) => {
        const mainCat = normalizeProductCategory(p.category);
        const subCat = inferProductSubcategory(p.category, p.subcategory);
        if (
          selectedDirectoryCategory &&
          selectedDirectoryCategory !== 'Todas' &&
          mainCat !== selectedDirectoryCategory
        ) {
          return false;
        }
        if (
          selectedDirectorySubcategory !== 'Todas' &&
          subCat !== selectedDirectorySubcategory
        ) {
          return false;
        }
        if (normalizedQuery) {
          const storeTextMatch =
            normalizeSearchText(user.storefrontName || user.displayName).includes(
              normalizedQuery
            ) || normalizeSearchText(user.displayName).includes(normalizedQuery);
          if (storeTextMatch) return true;
          const prodMatch =
            normalizeSearchText(p.name).includes(normalizedQuery) ||
            normalizeSearchText(p.specsSummary || '').includes(normalizedQuery) ||
            searchMatchesCategoryOrProduct(normalizedQuery, p.category, subCat);
          return prodMatch;
        }
        return true;
      });

      const storeMatchesQueryDirectly =
        normalizedQuery.length >= 2 &&
        (selectedDirectoryCategory === null || selectedDirectoryCategory === 'Todas') &&
        (normalizeSearchText(user.storefrontName || '').includes(normalizedQuery) ||
          normalizeSearchText(user.displayName).includes(normalizedQuery));

      if (matchingProducts.length > 0 || storeMatchesQueryDirectly) {
        results.push({
          user,
          matchingCount: matchingProducts.length,
          totalProducts: items.length,
          categories: Array.from(catSet),
        });
      } else if (selectedDirectoryCategory === 'Todas' && !normalizedQuery) {
        results.push({
          user,
          matchingCount: items.length,
          totalProducts: items.length,
          categories: Array.from(catSet),
        });
      }
    }

    return results.sort((a, b) => b.matchingCount - a.matchingCount);
  }, [
    showStorefrontDirectoryResults,
    directoryUsers,
    currentUserUid,
    storefrontCatalogByUid,
    selectedDirectoryCategory,
    selectedDirectorySubcategory,
    normalizedQuery,
  ]);

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
        `${res.total} contato(s) selecionado(s) · ${res.matched} encontrado(s) no ChatFi.`
      );
    } catch {
      setStatusFeedback('Use a busca por nome abaixo para encontrar quem já está no ChatFi.');
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
        `Lista atualizada: ${matched} contato(s) ativo(s) no ChatFi.`
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
          ? `${newName.trim()} salvo e encontrado no ChatFi (${res.matchedName})!`
          : `${newName.trim()} salvo. Ainda não possui conta no ChatFi — você pode enviar um convite abaixo.`
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
              Apenas seus contatos salvos aparecem aqui. Importe sua agenda ou adicione um telefone ou Linha Virtual (CFI-...).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasNativePicker && (
              <button
                type="button"
                onClick={() => void handleNativeDeviceSync()}
                disabled={busy}
                className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-50"
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
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-[#0E7A34]">
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
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0E7A34] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                Telefone com DDD ou Linha Virtual
              </label>
              <input
                type="text"
                required
                autoComplete="off"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="(37) 99999-9999 ou CFI-1234-5678"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#0E7A34] focus:outline-none"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={busy}
                className="h-10 flex-1 rounded-lg bg-[#0E7A34] px-4 text-xs font-semibold text-white hover:bg-[#0B5D27] disabled:opacity-50"
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

        {/* Search Input with Instant Name, Category & Phone Search (Autofill disabled) */}
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            inputMode="search"
            name="zapei_contact_search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar contato, produto, categoria ou telefone / CFI-..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-10 text-sm text-slate-900 focus:border-[#0E7A34] focus:bg-white focus:outline-none"
          />
          {liveLookupBusy ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#0E7A34]" />
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

        {/* Category Filter Strip to Explore Active Storefronts */}
        <div className="mt-3.5 space-y-2 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Explorar vitrines por categoria
            </span>
            {selectedDirectoryCategory !== null && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDirectoryCategory(null);
                  setSelectedDirectorySubcategory('Todas');
                }}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
              >
                Ocultar vitrines
              </button>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => {
                setSelectedDirectoryCategory((prev) =>
                  prev === 'Todas' ? null : 'Todas'
                );
                setSelectedDirectorySubcategory('Todas');
              }}
              className={`inline-flex min-h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition ${
                selectedDirectoryCategory === 'Todas'
                  ? 'bg-[#0E7A34] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <CategoryIcon categoryId="Todas" className="h-3.5 w-3.5" />
              Todas
            </button>
            {PRODUCT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setSelectedDirectoryCategory((prev) =>
                    prev === cat.id ? null : cat.id
                  );
                  setSelectedDirectorySubcategory('Todas');
                }}
                className={`inline-flex min-h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition ${
                  selectedDirectoryCategory === cat.id
                    ? 'bg-[#0E7A34] text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <CategoryIcon categoryId={cat.id} className="h-3.5 w-3.5" />
                {cat.shortLabel}
              </button>
            ))}
          </div>

          {activeDirCatDef && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setSelectedDirectorySubcategory('Todas')}
                className={`min-h-[30px] shrink-0 whitespace-nowrap rounded-lg px-2.5 text-[11px] font-semibold transition ${
                  selectedDirectorySubcategory === 'Todas'
                    ? 'bg-[#0D2B3E] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Tudo em {activeDirCatDef.shortLabel}
              </button>
              {activeDirCatDef.subcategories.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setSelectedDirectorySubcategory(sub)}
                  className={`min-h-[30px] shrink-0 whitespace-nowrap rounded-lg px-2.5 text-[11px] font-semibold transition ${
                    selectedDirectorySubcategory === sub
                      ? 'bg-[#0D2B3E] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {sub}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Instant Live Lookup Result Card (when typing a phone number or virtual line) */}
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
                  style={{ backgroundColor: liveLookupResult.avatarColor || '#0E7A34' }}
                >
                  {liveLookupResult.initials}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-slate-900">
                    {liveLookupResult.displayName}
                  </span>
                  <span className="rounded-md bg-[#0E7A34] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    No ChatFi
                  </span>
                  <StarRatingBadge
                    average={liveLookupResult.ratingAverage}
                    count={liveLookupResult.ratingCount}
                    variant="inline"
                  />
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
                className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0E7A34] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0B5D27]"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Conversar
              </button>
              <button
                type="button"
                onClick={() => void onStartDirectFoundCall(liveLookupResult, search, 'audio')}
                title="Ligação de voz"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-white text-[#0E7A34] hover:bg-emerald-50"
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
              <strong className="font-mono text-slate-800">{liveLookupCheckedPhone}</strong> ainda não entrou no ChatFi.
            </span>
            <button
              type="button"
              onClick={async () => {
                await shareRealZapeiInvite(liveLookupCheckedPhone, search);
                setStatusFeedback(`Convite preparado para ${liveLookupCheckedPhone}.`);
              }}
              className="inline-flex items-center gap-1 font-semibold text-[#0E7A34] hover:underline"
            >
              <Send className="h-3.5 w-3.5" />
              Enviar convite
            </button>
          </div>
        )}
      </div>

      {/* Directory Storefronts Matching Selected Category or Product Search */}
      {showStorefrontDirectoryResults && (
        <section className="mt-5">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Vitrines encontradas ({filteredDirectoryStorefronts.length})
            </h2>
          </div>

          {filteredDirectoryStorefronts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
              Nenhuma vitrine ativa encontrada com produtos nesta categoria ou busca.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {filteredDirectoryStorefronts.map(
                ({ user, matchingCount, categories }) => (
                  <div
                    key={user.uid}
                    className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewAvatar?.({
                            name: user.storefrontName || user.displayName,
                            initials: user.initials,
                            avatarBg: user.avatarColor || '#0E7A34',
                            avatarUrl: user.avatarUrl,
                            phone: user.virtualLine,
                            virtualLine: user.virtualLine,
                            subtitle: user.storefrontName || user.displayName,
                            ratingAverage: user.ratingAverage,
                            ratingCount: user.ratingCount,
                          })
                        }
                        title={`Ver foto de ${user.storefrontName || user.displayName}`}
                        aria-label={`Ampliar foto de ${user.storefrontName || user.displayName}`}
                        className="shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/40"
                      >
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt={user.storefrontName || user.displayName}
                            className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                          />
                        ) : (
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                            style={{ backgroundColor: user.avatarColor || '#0E7A34' }}
                          >
                            {user.initials}
                          </div>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {user.storefrontName || user.displayName}
                          </p>
                          <StarRatingBadge
                            average={user.ratingAverage}
                            count={user.ratingCount}
                            variant="inline"
                          />
                        </div>
                        <p className="truncate text-xs text-slate-500">
                          {matchingCount > 0
                            ? `${matchingCount} produto(s) nesta busca`
                            : 'Vitrine ativa'}
                          {categories.length > 0
                            ? ` · ${categories.slice(0, 3).join(', ')}`
                            : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {onOpenDirectoryStorefront && (
                        <button
                          type="button"
                          onClick={() => onOpenDirectoryStorefront(user)}
                          className="flex min-h-[38px] items-center gap-1 rounded-lg bg-[#0E7A34] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0B5D27]"
                        >
                          <Store className="h-3.5 w-3.5" />
                          Ver Vitrine
                        </button>
                      )}
                      {onOpenDirectoryChat && (
                        <button
                          type="button"
                          onClick={() => onOpenDirectoryChat(user)}
                          className="flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          Conversar
                        </button>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </section>
      )}

      {/* Saved Contacts Already on ChatFi */}
      {onZapeiContacts.length > 0 && (
        <section className="mt-5">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Seus Contatos no ChatFi ({onZapeiContacts.length})
            </h2>
          </div>

          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {onZapeiContacts.map((contact) => {
              const dir = contact.matchedUid ? directoryByUid.get(contact.matchedUid) : undefined;
              const photoUrl = dir?.avatarUrl;
              const activeStorefront = Boolean(contact.hasStorefront && !dir?.commercialBanned);
              return (
                <div
                  key={contact.id}
                  className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        onPreviewAvatar?.({
                          name: contact.name,
                          initials: contact.initials,
                          avatarBg: contact.avatarBg || '#0E7A34',
                          avatarUrl: photoUrl,
                          phone: contact.phone,
                          virtualLine: dir?.virtualLine,
                          subtitle: activeStorefront ? contact.storefrontName : undefined,
                          ratingAverage: dir?.ratingAverage,
                          ratingCount: dir?.ratingCount,
                        })
                      }
                      title={`Ver foto de ${contact.name}`}
                      aria-label={`Ampliar foto de ${contact.name}`}
                      className="relative shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/40"
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
                          style={{ backgroundColor: contact.avatarBg || '#0E7A34' }}
                        >
                          {contact.initials}
                        </div>
                      )}
                      {getContactPresenceDisplay(dir).isOnline && (
                        <span
                          className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-[#0E7A34] ring-2 ring-white"
                          aria-label="Online"
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenChat(contact, photoUrl)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-bold text-slate-900">
                          {contact.name}
                        </span>
                        {activeStorefront && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-[#0E7A34]">
                            <Store className="h-3 w-3" />
                            Vitrine Ativa
                          </span>
                        )}
                        <StarRatingBadge
                          average={dir?.ratingAverage}
                          count={dir?.ratingCount}
                          variant="inline"
                        />
                      </div>
                      {(() => {
                        const presence = getContactPresenceDisplay(dir, {
                          fallback:
                            (activeStorefront ? contact.storefrontName : undefined) ||
                            contact.phone,
                        });
                        return (
                          <p
                            className={`truncate text-xs ${
                              presence.isOnline
                                ? 'font-semibold text-[#0E7A34]'
                                : 'text-slate-500'
                            }`}
                          >
                            {presence.isOnline
                              ? activeStorefront && contact.storefrontName
                                ? `online · ${contact.storefrontName}`
                                : 'online'
                              : presence.isPresence
                                ? presence.label
                                : (activeStorefront ? contact.storefrontName : undefined) ||
                                  presence.label}
                          </p>
                        );
                      })()}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeStorefront && (
                      <button
                        type="button"
                        onClick={() => onOpenStorefront(contact)}
                        className="flex min-h-[38px] items-center gap-1 rounded-lg bg-[#0E7A34] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0B5D27]"
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
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#0E7A34]"
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

      {/* Invite to ChatFi Section (only when user has saved contacts not yet registered) */}
      {inviteContacts.length > 0 && (
        <section className="mt-5">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Convidar para o ChatFi ({inviteContacts.length})
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
                        ? 'border border-emerald-200 bg-emerald-50 text-[#0E7A34]'
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

      {/* Empty State when no saved contacts match */}
      {onZapeiContacts.length === 0 &&
        inviteContacts.length === 0 &&
        !showStorefrontDirectoryResults &&
        !(looksLikePhoneQuery && liveLookupResult) && (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <Smartphone className="mx-auto h-10 w-10 text-slate-400" />
            <h2 className="mt-3 text-base font-bold text-slate-900">
              {normalizedQuery
                ? `Nenhum contato encontrado para "${search.trim()}"`
                : 'Sua lista de contatos está vazia'}
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
              {normalizedQuery
                ? 'Para iniciar conversa com quem ainda não está salvo na sua agenda, digite o telefone completo com DDD ou a Linha Virtual (CFI-XXXX-XXXX) na busca acima.'
                : 'Apenas contatos da sua agenda aparecem aqui. Toque em "+ Novo contato" ou sincronize sua agenda, ou escolha uma categoria acima para explorar vitrines.'}
            </p>
          </div>
        )}
    </div>
  );
};
