import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckSquare,
  Film,
  HardDrive,
  Image as ImageIcon,
  Mic,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';
import {
  type CachedMediaType,
  type ChatStorageUsage,
  type LocalMediaRecord,
  type LocalStorageSummary,
  deleteLocalMediaItems,
  formatBytesPtBr,
  getLocalMediaByChat,
  getLocalStorageSummaryByChat,
  getOrCreateMediaObjectUrl,
  subscribeLocalMediaChanges,
} from '../lib/localMediaCache';

interface StorageManagerCardProps {
  onNotify?: (message: string) => void;
}

type MediaFilter = 'all' | CachedMediaType;

export const StorageManagerCard: React.FC<StorageManagerCardProps> = ({ onNotify }) => {
  const [summary, setSummary] = useState<LocalStorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<ChatStorageUsage | null>(null);
  const [chatItems, setChatItems] = useState<LocalMediaRecord[]>([]);
  const [loadingChatItems, setLoadingChatItems] = useState(false);
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getLocalStorageSummaryByChat();
      setSummary(next);
      setSelectedChat((prev) => {
        if (!prev) return null;
        return next.chats.find((c) => c.chatId === prev.chatId) || null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChatItems = useCallback(async (chatId: string) => {
    setLoadingChatItems(true);
    try {
      const rows = await getLocalMediaByChat(chatId);
      setChatItems(rows);
    } finally {
      setLoadingChatItems(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
    return subscribeLocalMediaChanges(() => {
      void loadSummary();
    });
  }, [loadSummary]);

  useEffect(() => {
    if (!selectedChat) {
      setChatItems([]);
      setSelectedIds(new Set());
      setConfirmDeleteOpen(false);
      return;
    }
    void loadChatItems(selectedChat.chatId);
  }, [selectedChat, loadChatItems]);

  const filteredItems = useMemo(() => {
    if (filter === 'all') return chatItems;
    return chatItems.filter((item) => item.mediaType === filter);
  }, [chatItems, filter]);

  const selectedBytes = useMemo(() => {
    let total = 0;
    for (const item of chatItems) {
      if (selectedIds.has(item.messageId)) {
        total += item.sizeBytes || item.blob?.size || 0;
      }
    }
    return total;
  }, [chatItems, selectedIds]);

  const toggleItemSelection = (messageId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
    setConfirmDeleteOpen(false);
  };

  const toggleSelectAllFiltered = () => {
    const allFilteredSelected =
      filteredItems.length > 0 && filteredItems.every((it) => selectedIds.has(it.messageId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredItems.forEach((it) => next.delete(it.messageId));
      } else {
        filteredItems.forEach((it) => next.add(it.messageId));
      }
      return next;
    });
    setConfirmDeleteOpen(false);
  };

  const handleConfirmDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const idsToDelete = Array.from(selectedIds);
      const freedBytes = selectedBytes;
      await deleteLocalMediaItems(idsToDelete);
      setSelectedIds(new Set());
      setConfirmDeleteOpen(false);
      if (selectedChat) {
        await loadChatItems(selectedChat.chatId);
      }
      await loadSummary();
      onNotify?.(
        `${idsToDelete.length} arquivo${idsToDelete.length > 1 ? 's' : ''} apagado${idsToDelete.length > 1 ? 's' : ''} deste aparelho (${formatBytesPtBr(freedBytes)} liberados).`
      );
    } finally {
      setDeleting(false);
    }
  };

  const videoPct =
    summary && summary.totalBytes > 0
      ? Math.round((summary.videoBytes / summary.totalBytes) * 100)
      : 0;
  const imagePct =
    summary && summary.totalBytes > 0
      ? Math.round((summary.imageBytes / summary.totalBytes) * 100)
      : 0;
  const audioPct =
    summary && summary.totalBytes > 0
      ? Math.max(0, 100 - videoPct - imagePct)
      : 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#0E7A34]">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Armazenamento e Dados
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Fotos, vídeos e áudios ficam salvos permanentemente neste aparelho para abrir na hora, igual ao WhatsApp.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={loading}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Overview vs Per-Conversation Drill-down */}
      {!selectedChat ? (
        <>
          {/* Total Usage Meter */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Espaço usado pelo ChatFi neste aparelho
                </p>
                <p className="mt-0.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                  {loading ? '...' : formatBytesPtBr(summary?.totalBytes || 0)}
                </p>
              </div>
              <span className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                {summary?.totalCount || 0}{' '}
                {(summary?.totalCount || 0) === 1 ? 'mídia salva' : 'mídias salvas'}
              </span>
            </div>

            {/* Segmented Bar */}
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 flex">
              {videoPct > 0 && (
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: `${videoPct}%` }}
                  title={`Vídeos: ${formatBytesPtBr(summary?.videoBytes || 0)}`}
                />
              )}
              {imagePct > 0 && (
                <div
                  className="h-full bg-[#0E7A34] transition-all"
                  style={{ width: `${imagePct}%` }}
                  title={`Fotos: ${formatBytesPtBr(summary?.imageBytes || 0)}`}
                />
              )}
              {audioPct > 0 && (summary?.audioBytes || 0) > 0 && (
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${audioPct}%` }}
                  title={`Áudios: ${formatBytesPtBr(summary?.audioBytes || 0)}`}
                />
              )}
            </div>

            {/* Legend */}
            <div className="grid grid-cols-3 gap-2 pt-0.5 text-xs">
              <div className="rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200/80">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 shrink-0" />
                  <span className="font-semibold">Vídeos</span>
                </div>
                <p className="mt-1 font-mono text-xs font-bold text-slate-900 tabular-nums">
                  {formatBytesPtBr(summary?.videoBytes || 0)}
                </p>
                <p className="text-[10px] text-slate-400">
                  {summary?.videoCount || 0} arquivo{(summary?.videoCount || 0) === 1 ? '' : 's'}
                </p>
              </div>
              <div className="rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200/80">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#0E7A34] shrink-0" />
                  <span className="font-semibold">Fotos</span>
                </div>
                <p className="mt-1 font-mono text-xs font-bold text-slate-900 tabular-nums">
                  {formatBytesPtBr(summary?.imageBytes || 0)}
                </p>
                <p className="text-[10px] text-slate-400">
                  {summary?.imageCount || 0} arquivo{(summary?.imageCount || 0) === 1 ? '' : 's'}
                </p>
              </div>
              <div className="rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200/80">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="font-semibold">Áudios</span>
                </div>
                <p className="mt-1 font-mono text-xs font-bold text-slate-900 tabular-nums">
                  {formatBytesPtBr(summary?.audioBytes || 0)}
                </p>
                <p className="text-[10px] text-slate-400">
                  {summary?.audioCount || 0} arquivo{(summary?.audioCount || 0) === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          </div>

          {/* Per-Conversation Breakdown */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Espaço por conversa
              </h3>
              <span className="text-[11px] text-slate-400">
                Toque para escolher o que apagar
              </span>
            </div>

            {!loading && (!summary || summary.chats.length === 0) ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-5 text-center">
                <HardDrive className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-xs font-semibold text-slate-700">
                  Nenhuma mídia salva localmente ainda
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Quando você enviar ou receber fotos, áudios ou vídeos, eles aparecerão aqui organizados por conversa.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                {(summary?.chats || []).map((chat) => {
                  const initials = chat.peerName
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((p) => p[0]?.toUpperCase() || '')
                    .join('') || 'CF';

                  const parts: string[] = [];
                  if (chat.videoCount > 0) {
                    parts.push(`${chat.videoCount} vídeo${chat.videoCount > 1 ? 's' : ''}`);
                  }
                  if (chat.imageCount > 0) {
                    parts.push(`${chat.imageCount} foto${chat.imageCount > 1 ? 's' : ''}`);
                  }
                  if (chat.audioCount > 0) {
                    parts.push(`${chat.audioCount} áudio${chat.audioCount > 1 ? 's' : ''}`);
                  }

                  return (
                    <button
                      key={chat.chatId}
                      type="button"
                      onClick={() => {
                        setFilter('all');
                        setSelectedIds(new Set());
                        setSelectedChat(chat);
                      }}
                      className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3 text-left transition hover:bg-slate-50"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0E7A34] text-xs font-bold text-white">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {chat.peerName}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {parts.join(' · ') || `${chat.itemCount} itens`}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                          {formatBytesPtBr(chat.totalBytes)}
                        </p>
                        <p className="text-[10px] font-semibold text-[#0E7A34]">
                          Gerenciar →
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Privacy & No-Auto-Delete Guarantee */}
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-700 ring-1 ring-emerald-200/70">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0E7A34]" />
            <span>
              <strong>Controle total:</strong> o ChatFi nunca apaga suas mensagens ou mídias automaticamente. A nuvem atua apenas como ponte temporária (até 14 dias se o contato estiver sem sinal) e limpa o arquivo assim que ele chega ao aparelho.
            </span>
          </div>
        </>
      ) : (
        /* Per-Conversation Manual Selection & Cleanup View */
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setSelectedChat(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                aria-label="Voltar para lista de conversas"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">
                  {selectedChat.peerName}
                </p>
                <p className="text-[11px] text-slate-500">
                  {formatBytesPtBr(selectedChat.totalBytes)} em {selectedChat.itemCount}{' '}
                  {selectedChat.itemCount === 1 ? 'arquivo' : 'arquivos'} neste aparelho
                </p>
              </div>
            </div>

            {filteredItems.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAllFiltered}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                {filteredItems.every((it) => selectedIds.has(it.messageId)) ? (
                  <>
                    <CheckSquare className="h-3.5 w-3.5 text-[#0E7A34]" />
                    Desmarcar todos
                  </>
                ) : (
                  <>
                    <Square className="h-3.5 w-3.5 text-slate-400" />
                    Selecionar todos
                  </>
                )}
              </button>
            )}
          </div>

          {/* Media Type Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `Tudo (${chatItems.length})` },
                { id: 'video', label: `Vídeos (${chatItems.filter((i) => i.mediaType === 'video').length})` },
                { id: 'image', label: `Fotos (${chatItems.filter((i) => i.mediaType === 'image').length})` },
                { id: 'audio', label: `Áudios (${chatItems.filter((i) => i.mediaType === 'audio').length})` },
              ] as Array<{ id: MediaFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  filter === tab.id
                    ? 'bg-[#0E7A34] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Media Items Grid / List */}
          {loadingChatItems ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Carregando arquivos desta conversa...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-6 text-center text-xs text-slate-500">
              Nenhum arquivo deste tipo armazenado nesta conversa.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 max-h-[380px] overflow-y-auto pr-0.5">
              {filteredItems.map((item) => {
                const isSelected = selectedIds.has(item.messageId);
                const previewUrl = item.blob
                  ? getOrCreateMediaObjectUrl(item.messageId, item.blob)
                  : '';
                const dateLabel = new Date(item.savedAtMs).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                });

                return (
                  <button
                    key={item.messageId}
                    type="button"
                    onClick={() => toggleItemSelection(item.messageId)}
                    className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition ${
                      isSelected
                        ? 'border-red-500 bg-red-50/40 ring-2 ring-red-500/30'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {/* Preview Box */}
                    <div className="relative h-28 w-full bg-slate-100 flex items-center justify-center overflow-hidden">
                      {item.mediaType === 'image' && previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={item.caption || 'Foto'}
                          className="h-full w-full object-cover"
                        />
                      ) : item.mediaType === 'video' && previewUrl ? (
                        <div className="relative h-full w-full bg-slate-900">
                          <video
                            src={previewUrl}
                            preload="metadata"
                            muted
                            playsInline
                            className="h-full w-full object-cover opacity-85"
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white">
                              <Film className="h-4 w-4" />
                            </span>
                          </div>
                          {item.durationLabel && (
                            <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                              {item.durationLabel}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-1 text-amber-700">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                            <Mic className="h-5 w-5" />
                          </div>
                          <span className="font-mono text-[11px] font-bold">
                            {item.durationLabel || 'Áudio'}
                          </span>
                        </div>
                      )}

                      {/* Selection Checkbox */}
                      <span
                        className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition ${
                          isSelected
                            ? 'border-red-600 bg-red-600 text-white'
                            : 'border-white/90 bg-black/40 text-transparent group-hover:bg-black/60'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>

                      {/* Type Badge */}
                      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {item.mediaType === 'image' ? (
                          <ImageIcon className="h-3 w-3" />
                        ) : item.mediaType === 'video' ? (
                          <Film className="h-3 w-3" />
                        ) : (
                          <Mic className="h-3 w-3" />
                        )}
                        {formatBytesPtBr(item.sizeBytes || item.blob?.size || 0)}
                      </span>
                    </div>

                    {/* Footer info */}
                    <div className="px-2.5 py-2">
                      <p className="truncate text-[11px] font-semibold text-slate-800">
                        {item.caption ||
                          (item.mediaType === 'image'
                            ? 'Foto'
                            : item.mediaType === 'video'
                              ? 'Vídeo'
                              : 'Mensagem de voz')}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        Salvo em {dateLabel}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Manual Deletion Action Bar */}
          {selectedIds.size > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold text-red-900">
                  {selectedIds.size}{' '}
                  {selectedIds.size === 1 ? 'arquivo selecionado' : 'arquivos selecionados'} (
                  {formatBytesPtBr(selectedBytes)})
                </p>
                <p className="text-[11px] text-red-700">
                  Remove apenas deste aparelho. As mensagens de texto continuam intactas.
                </p>
              </div>

              {!confirmDeleteOpen ? (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3.5 text-xs font-bold text-white hover:bg-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Apagar do aparelho
                </button>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteOpen(false)}
                    disabled={deleting}
                    className="min-h-[38px] rounded-xl border border-red-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmDeleteSelected()}
                    disabled={deleting}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-red-700 px-3.5 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    {deleting ? 'Apagando...' : 'Confirmar exclusão'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
