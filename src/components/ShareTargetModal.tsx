import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Film,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Mic,
  Search,
  Send,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { formatBytesPtBr } from '../lib/localMediaCache';
import {
  classifySharedFile,
  extractAudioDurationLabel,
  normalizeSharedAudioMimeType,
  type SharedMediaKind,
  type StoredSharedPayload,
} from '../lib/shareTargetInbox';
import { extractVideoDurationLabel } from '../lib/phoneUtils';

export interface ShareTargetRecipient {
  uid: string;
  name: string;
  subtitle: string;
  initials: string;
  avatarBg: string;
  avatarUrl?: string;
}

export interface PreparedShareItem {
  id: string;
  kind: 'image' | 'audio' | 'video';
  name: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
  previewUrl: string;
  durationLabel: string;
}

interface ShareTargetModalProps {
  payloads: StoredSharedPayload[];
  recipients: ShareTargetRecipient[];
  onClose: () => void;
  onSendSharedContent: (params: {
    recipients: ShareTargetRecipient[];
    items: PreparedShareItem[];
    textMessage: string;
    caption: string;
    onProgress?: (current: number, total: number) => void;
  }) => Promise<void>;
}

export const ShareTargetModal: React.FC<ShareTargetModalProps> = ({
  payloads,
  recipients,
  onClose,
  onSendSharedContent,
}) => {
  const [items, setItems] = useState<PreparedShareItem[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [preparing, setPreparing] = useState(true);
  const [sharedText, setSharedText] = useState('');
  const [caption, setCaption] = useState('');
  const [search, setSearch] = useState('');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];

    const buildItems = async () => {
      setPreparing(true);
      const textParts: string[] = [];
      const prepared: PreparedShareItem[] = [];
      let unsupported = 0;

      for (const payload of payloads) {
        const pieces = [payload.title, payload.text, payload.url]
          .map((s) => s.trim())
          .filter(Boolean);
        // Deduplicate identical strings (Android often puts same text in title & text)
        for (const p of pieces) {
          if (!textParts.includes(p)) {
            textParts.push(p);
          }
        }

        for (let idx = 0; idx < payload.files.length; idx += 1) {
          const file = payload.files[idx];
          const kind: SharedMediaKind = classifySharedFile(file);
          if (kind === 'unsupported') {
            unsupported += 1;
            continue;
          }

          const mimeType =
            kind === 'audio'
              ? normalizeSharedAudioMimeType(file)
              : file.type || (kind === 'image' ? 'image/jpeg' : 'video/mp4');
          const typedBlob =
            file.blob.type === mimeType
              ? file.blob
              : new Blob([file.blob], { type: mimeType });
          const previewUrl = URL.createObjectURL(typedBlob);
          createdUrls.push(previewUrl);

          let durationLabel = '';
          if (kind === 'audio') {
            durationLabel = await extractAudioDurationLabel(typedBlob);
          } else if (kind === 'video') {
            durationLabel = await extractVideoDurationLabel(typedBlob);
          }

          prepared.push({
            id: `${payload.id}_${idx}`,
            kind,
            name: file.name || `midia_${idx + 1}`,
            mimeType,
            sizeBytes: typedBlob.size,
            blob: typedBlob,
            previewUrl,
            durationLabel,
          });
        }
      }

      if (cancelled) {
        createdUrls.forEach((u) => URL.revokeObjectURL(u));
        return;
      }

      setItems(prepared);
      setIgnoredCount(unsupported);
      const joinedText = textParts.join('\n').trim();
      if (prepared.length > 0 && prepared.some((i) => i.kind === 'image' || i.kind === 'video')) {
        setCaption(joinedText);
        setSharedText('');
      } else {
        setSharedText(joinedText);
        setCaption('');
      }
      setPreparing(false);
    };

    void buildItems();

    return () => {
      cancelled = true;
      createdUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [payloads]);

  const filteredRecipients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.subtitle.toLowerCase().includes(q)
    );
  }, [recipients, search]);

  const toggleRecipient = (uid: string) => {
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const hasContent = items.length > 0 || sharedText.trim().length > 0;
  const hasImageOrVideo = items.some((i) => i.kind === 'image' || i.kind === 'video');

  const handleConfirmSend = async () => {
    if (sending || !hasContent || selectedUids.length === 0) return;
    const chosenRecipients = recipients.filter((r) => selectedUids.includes(r.uid));
    if (chosenRecipients.length === 0) return;

    setSending(true);
    setErrorMsg('');
    setProgressLabel('Preparando envio...');
    try {
      await onSendSharedContent({
        recipients: chosenRecipients,
        items,
        textMessage: sharedText.trim(),
        caption: caption.trim(),
        onProgress: (current, total) => {
          setProgressLabel(`Enviando ${current} de ${total}...`);
        },
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Não foi possível enviar o conteúdo compartilhado.'
      );
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B5D27] px-4 py-3.5 text-white">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <Share2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold">
                Compartilhado com o ChatFi
              </h2>
              <p className="text-[11px] text-emerald-100">
                Escolha para quem enviar {items.length > 0 ? `(${items.length} ${items.length === 1 ? 'arquivo' : 'arquivos'})` : 'a mensagem'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 space-y-4">
          {preparing ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-500">
              <Loader2 className="h-7 w-7 animate-spin text-[#0E7A34]" />
              <p className="text-xs font-semibold">Carregando arquivos compartilhados...</p>
            </div>
          ) : (
            <>
              {/* Shared Media Previews */}
              {items.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Mídias recebidas
                  </p>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                      >
                        {item.kind === 'image' && (
                          <img
                            src={item.previewUrl}
                            alt={item.name}
                            className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                          />
                        )}
                        {item.kind === 'audio' && (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0E7A34] text-white">
                            <Mic className="h-5 w-5" />
                          </div>
                        )}
                        {item.kind === 'video' && (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0D2B3E] text-white">
                            <Film className="h-5 w-5" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {item.kind === 'image' && (
                              <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#0E7A34]" />
                            )}
                            <p className="truncate text-xs font-bold text-slate-900">
                              {item.kind === 'audio'
                                ? `Áudio (${item.durationLabel || '0:00'})`
                                : item.name}
                            </p>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {item.kind === 'audio' ? `${item.name} · ` : ''}
                            {formatBytesPtBr(item.sizeBytes)}
                          </p>
                          {item.kind === 'audio' && (
                            <audio
                              controls
                              src={item.previewUrl}
                              className="mt-1.5 h-8 w-full max-w-[260px]"
                            />
                          )}
                        </div>

                        <button
                          type="button"
                          disabled={sending}
                          onClick={() => removeItem(item.id)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Remover este item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ignoredCount > 0 && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900">
                  {ignoredCount === 1
                    ? '1 arquivo em formato não suportado foi ignorado (suportamos imagens, áudios e vídeos).'
                    : `${ignoredCount} arquivos em formato não suportado foram ignorados.`}
                </p>
              )}

              {/* Optional Caption for Images/Videos OR Shared Text */}
              {hasImageOrVideo && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Legenda (opcional)
                  </label>
                  <input
                    type="text"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Escreva uma legenda para a imagem ou vídeo..."
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0E7A34] focus:bg-white focus:outline-none"
                  />
                </div>
              )}

              {(!hasImageOrVideo || sharedText.length > 0) && (
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <MessageSquare className="h-3.5 w-3.5 text-[#0E7A34]" />
                    Mensagem compartilhada {items.length > 0 ? '(opcional)' : ''}
                  </label>
                  <textarea
                    rows={2}
                    value={sharedText}
                    onChange={(e) => setSharedText(e.target.value)}
                    placeholder="Texto ou link compartilhado..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0E7A34] focus:bg-white focus:outline-none"
                  />
                </div>
              )}

              {errorMsg && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                  {errorMsg}
                </div>
              )}

              {/* Recipient Picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Enviar para qual conversa?
                  </p>
                  {selectedUids.length > 0 && (
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-[#0E7A34]">
                      {selectedUids.length}{' '}
                      {selectedUids.length === 1 ? 'selecionado' : 'selecionados'}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar contato ou conversa..."
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0E7A34] focus:bg-white focus:outline-none"
                  />
                </div>

                {filteredRecipients.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                    Nenhum contato encontrado no ChatFi. Adicione um contato na aba Contatos para enviar.
                  </p>
                ) : (
                  <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                    {filteredRecipients.map((r) => {
                      const isSelected = selectedUids.includes(r.uid);
                      return (
                        <button
                          key={r.uid}
                          type="button"
                          disabled={sending}
                          onClick={() => toggleRecipient(r.uid)}
                          className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
                            isSelected ? 'bg-emerald-50/80' : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          {r.avatarUrl ? (
                            <img
                              src={r.avatarUrl}
                              alt={r.name}
                              className="h-10 w-10 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                              style={{ backgroundColor: r.avatarBg || '#0E7A34' }}
                            >
                              {r.initials}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {r.name}
                            </p>
                            <p className="truncate text-xs text-slate-500">{r.subtitle}</p>
                          </div>

                          <div
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
                              isSelected
                                ? 'border-[#0E7A34] bg-[#0E7A34] text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {isSelected && <Check className="h-3.5 w-3.5" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 pb-safe">
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={preparing || sending || !hasContent || selectedUids.length === 0}
            onClick={() => void handleConfirmSend()}
            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#0E7A34] px-4 text-xs font-bold text-white transition hover:bg-[#0B5D27] disabled:opacity-50 sm:flex-none sm:min-w-[190px]"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {progressLabel || 'Enviando...'}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Enviar no ChatFi
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
