import React, { useMemo } from 'react';
import {
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Video,
} from 'lucide-react';
import type { PublicDirectoryUser } from '../lib/firebase';
import type { CallSessionRecord, Contact } from '../types/zapei';

interface CallsViewProps {
  myUid: string;
  calls: CallSessionRecord[];
  zapeiContacts: Contact[];
  directoryUsers: PublicDirectoryUser[];
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
  onStartCallWithPeer,
}) => {
  const directoryByUid = useMemo(() => {
    const map = new Map<string, PublicDirectoryUser>();
    for (const u of directoryUsers) {
      map.set(u.uid, u);
    }
    return map;
  }, [directoryUsers]);

  const callablePeers = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{
      uid: string;
      name: string;
      initials: string;
      avatarBg: string;
      avatarUrl?: string;
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
      });
    }

    return list;
  }, [zapeiContacts, directoryByUid, myUid]);

  return (
    <div className="mx-auto w-full max-w-4xl overflow-x-hidden px-3.5 sm:px-4 py-4 sm:py-5 pb-safe-nav md:pb-8 space-y-5">
      {/* Quick Real Call Strip */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Ligações de Voz e Vídeo</h1>
            <p className="text-xs text-slate-500">
              Faça ligações de voz e vídeo gratuitas para seus contatos no ChatFi.
            </p>
          </div>
        </div>

        {callablePeers.length > 0 ? (
          <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
            {callablePeers.map((peer) => (
              <div
                key={peer.uid}
                className="flex min-w-[176px] shrink-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
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
                  <span className="truncate text-xs font-semibold text-slate-900">
                    {peer.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onStartCallWithPeer(peer, 'audio')}
                    title={`Ligar para ${peer.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#0E7A34] border border-slate-200 hover:bg-emerald-50"
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCallWithPeer(peer, 'video')}
                    title={`Vídeo com ${peer.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#0D2B3E] border border-slate-200 hover:bg-slate-100"
                  >
                    <Video className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
            Adicione contatos na aba Contatos (por telefone ou Linha Virtual CFI-...) para ligar por voz ou vídeo rapidamente.
          </p>
        )}
      </section>

      {/* Call History */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
              const peerName = isOutgoing ? call.calleeName : call.callerName;
              const peerInitials = isOutgoing ? call.calleeInitials : call.callerInitials;
              const peerAvatarColor = isOutgoing
                ? call.calleeAvatarColor
                : call.callerAvatarColor;
              const peerAvatarUrl = dir?.avatarUrl;
              const isMissed =
                call.status === 'missed' || call.status === 'declined';

              return (
                <div
                  key={call.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
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
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm font-bold ${
                          isMissed ? 'text-red-600' : 'text-slate-900'
                        }`}
                      >
                        {peerName}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                        {isMissed ? (
                          <PhoneMissed className="h-3.5 w-3.5 text-red-500" />
                        ) : isOutgoing ? (
                          <PhoneOutgoing className="h-3.5 w-3.5 text-[#0E7A34]" />
                        ) : (
                          <PhoneIncoming className="h-3.5 w-3.5 text-[#0D2B3E]" />
                        )}
                        <span>
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

                  <div className="flex shrink-0 items-center gap-1.5">
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
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-[#0E7A34]"
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
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-[#0D2B3E]"
                      title="Retornar por vídeo"
                    >
                      <Video className="h-4 w-4" />
                    </button>
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
