import React, { useMemo, useState } from 'react';
import {
  Check,
  Loader2,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import type { PublicDirectoryUser } from '../lib/firebase';
import type { CallSessionRecord, Contact } from '../types/zapei';
import type { AvatarPreviewTarget } from './AvatarLightboxModal';

interface CallsViewProps {
  myUid: string;
  calls: CallSessionRecord[];
  zapeiContacts: Contact[];
  directoryUsers: PublicDirectoryUser[];
  onPreviewAvatar?: (target: AvatarPreviewTarget) => void;
  onDeleteCall?: (callId: string) => Promise<void>;
  onStartCallWithPeer: (
    peer: {
      uid: string;
      name: string;
      initials: string;
      avatarBg: string;
      avatarUrl?: string;
    },
    type: 'audio' | 'video'
  ) => void;
}

export const CallsView: React.FC<CallsViewProps> = ({
  myUid,
  calls,
  zapeiContacts,
  directoryUsers,
  onPreviewAvatar,
  onDeleteCall,
  onStartCallWithPeer,
}) => {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const directoryByUid = useMemo(() => {
    const map = new Map<string, PublicDirectoryUser>();
    for (const u of directoryUsers) {
      map.set(u.uid, u);
    }
    return map;
  }, [directoryUsers]);

  const contactByUid = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of zapeiContacts) {
      if (c.matchedUid) map.set(c.matchedUid, c);
    }
    return map;
  }, [zapeiContacts]);

  const callablePeers = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{
      uid: string;
      name: string;
      initials: string;
      avatarBg: string;
      avatarUrl?: string;
      phone?: string;
      virtualLine?: string;
    }> = [];

    for (const c of zapeiContacts) {
      if (!c.matchedUid || c.matchedUid === myUid || seen.has(c.matchedUid)) continue;
      seen.add(c.matchedUid);
      const dir = directoryByUid.get(c.matchedUid);
      list.push({
        uid: c.matchedUid,
        name: c.name,
        initials: c.initials,
        avatarBg: c.avatarBg || dir?.avatarColor || '#0E7A34',
        avatarUrl: dir?.avatarUrl,
        phone: c.phone,
        virtualLine: dir?.virtualLine,
      });
    }

    return list;
  }, [zapeiContacts, directoryByUid, myUid]);

  const handleConfirmDelete = async (callId: string) => {
    if (!onDeleteCall || deletingId) return;
    setDeletingId(callId);
    try {
      await onDeleteCall(callId);
      setConfirmDeleteId((curr) => (curr === callId ? null : curr));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl overflow-x-hidden px-3.5 sm:px-5 py-4 sm:py-6 pb-safe-nav md:pb-8 space-y-5">
      {/* Quick Real Call Strip */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">
              Ligações de Voz e Vídeo
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Faça ligações de voz e vídeo gratuitas para seus contatos no ChatFi.
            </p>
          </div>
        </div>

        {callablePeers.length > 0 ? (
          <div className="mt-4 flex gap-2.5 overflow-x-auto pb-1">
            {callablePeers.map((peer) => (
              <div
                key={peer.uid}
                className="flex min-w-[184px] shrink-0 items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onPreviewAvatar?.({
                        name: peer.name,
                        initials: peer.initials,
                        avatarBg: peer.avatarBg,
                        avatarUrl: peer.avatarUrl,
                        phone: peer.phone,
                        virtualLine: peer.virtualLine,
                      })
                    }
                    title={`Ver foto de ${peer.name}`}
                    aria-label={`Ampliar foto de ${peer.name}`}
                    className="shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/40"
                  >
                    {peer.avatarUrl ? (
                      <img
                        src={peer.avatarUrl}
                        alt={peer.name}
                        className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                      />
                    ) : (
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: peer.avatarBg || '#0E7A34' }}
                      >
                        {peer.initials}
                      </div>
                    )}
                  </button>
                  <span className="truncate text-xs font-semibold text-slate-900">
                    {peer.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onStartCallWithPeer(peer, 'audio')}
                    title={`Ligar para ${peer.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#0E7A34] border border-slate-200 hover:bg-emerald-50"
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCallWithPeer(peer, 'video')}
                    title={`Vídeo com ${peer.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#0D2B3E] border border-slate-200 hover:bg-slate-100"
                  >
                    <Video className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-slate-200/70 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-500">
            Adicione contatos na aba Contatos (por telefone ou Linha Virtual CFI-...) para ligar por voz ou vídeo rapidamente.
          </p>
        )}
      </section>

      {/* Call History */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Histórico de Chamadas ({calls.length})
          </h2>
        </div>

        {calls.length === 0 ? (
          <div className="p-8 text-center">
            <Phone className="mx-auto h-9 w-9 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-800">
              Nenhuma chamada registrada ainda
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Todas as ligações de voz e vídeo feitas ou recebidas ficarão registradas aqui automaticamente.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {calls.map((call) => {
              const isOutgoing = call.callerId === myUid;
              const peerUid = isOutgoing ? call.calleeId : call.callerId;
              const dir = directoryByUid.get(peerUid);
              const contactMatch = contactByUid.get(peerUid);
              const peerName = contactMatch?.name || (isOutgoing ? call.calleeName : call.callerName);
              const peerInitials = isOutgoing ? call.calleeInitials : call.callerInitials;
              const peerAvatarColor = isOutgoing
                ? call.calleeAvatarColor
                : call.callerAvatarColor;
              const peerAvatarUrl = dir?.avatarUrl;
              const isMissed =
                call.status === 'missed' || call.status === 'declined';
              const isConfirmingDelete = confirmDeleteId === call.id;
              const isDeleting = deletingId === call.id;

              return (
                <div
                  key={call.id}
                  className="flex flex-col gap-2.5 px-4 py-3 transition hover:bg-slate-50/70 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        onPreviewAvatar?.({
                          name: peerName,
                          initials: peerInitials,
                          avatarBg: peerAvatarColor || '#0D2B3E',
                          avatarUrl: peerAvatarUrl,
                          phone: contactMatch?.phone || dir?.virtualLine,
                          virtualLine: dir?.virtualLine,
                          subtitle: isOutgoing ? 'Chamada efetuada' : 'Chamada recebida',
                        })
                      }
                      title={`Ver foto de ${peerName}`}
                      aria-label={`Ampliar foto de ${peerName}`}
                      className="shrink-0 rounded-full cursor-pointer transition hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0E7A34]/40"
                    >
                      {peerAvatarUrl ? (
                        <img
                          src={peerAvatarUrl}
                          alt={peerName}
                          className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <div
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                          style={{ backgroundColor: peerAvatarColor || '#0D2B3E' }}
                        >
                          {peerInitials}
                        </div>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm font-bold ${
                          isMissed ? 'text-red-600' : 'text-slate-900'
                        }`}
                      >
                        {peerName}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        {isMissed ? (
                          <PhoneMissed className="h-3.5 w-3.5 text-red-500" />
                        ) : isOutgoing ? (
                          <PhoneOutgoing className="h-3.5 w-3.5 text-[#0E7A34]" />
                        ) : (
                          <PhoneIncoming className="h-3.5 w-3.5 text-[#0D2B3E]" />
                        )}
                        <span>
                          {isOutgoing ? 'Efetuada' : 'Recebida'} ·{' '}
                          {call.callType === 'video' ? 'Vídeo' : 'Voz'} ·{' '}
                          {call.status === 'declined'
                            ? 'Recusada'
                            : call.status === 'missed'
                              ? 'Não atendida'
                              : call.status === 'ringing'
                                ? 'Chamando'
                                : call.durationLabel || '00:00'}
                        </span>
                        <span>·</span>
                        <span className="font-mono tabular-nums">{call.timestamp}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-end gap-1.5">
                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/90 px-2.5 py-1">
                        <span className="text-[11px] font-semibold text-red-700">
                          Apagar registro?
                        </span>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => void handleConfirmDelete(call.id)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-red-600 px-2.5 text-[11px] font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Apagar
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => setConfirmDeleteId(null)}
                          aria-label="Cancelar exclusão"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-white text-slate-600 transition hover:bg-slate-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onStartCallWithPeer(
                              {
                                uid: peerUid,
                                name: peerName,
                                initials: peerInitials,
                                avatarBg: peerAvatarColor,
                                avatarUrl: peerAvatarUrl,
                              },
                              'audio'
                            )
                          }
                          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 transition hover:bg-emerald-50 hover:text-[#0E7A34]"
                          title="Retornar por voz"
                        >
                          <Phone className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onStartCallWithPeer(
                              {
                                uid: peerUid,
                                name: peerName,
                                initials: peerInitials,
                                avatarBg: peerAvatarColor,
                                avatarUrl: peerAvatarUrl,
                              },
                              'video'
                            )
                          }
                          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 transition hover:bg-slate-100 hover:text-[#0D2B3E]"
                          title="Retornar por vídeo"
                        >
                          <Video className="h-4 w-4" />
                        </button>
                        {onDeleteCall && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(call.id)}
                            aria-label={`Apagar chamada com ${peerName}`}
                            title="Apagar chamada do histórico"
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
