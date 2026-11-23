import React from 'react';
import {
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Video,
} from 'lucide-react';
import type { BackgroundPushStatus } from '../lib/pushService';
import type { CallSessionRecord, Contact } from '../types/zapei';
import { BackgroundCallPushCard } from './BackgroundCallPushCard';

interface CallsViewProps {
  myUid: string;
  calls: CallSessionRecord[];
  zapeiContacts: Contact[];
  pushStatus: BackgroundPushStatus;
  pushBusy: boolean;
  pushFeedback: string;
  onEnableBackgroundPush: () => Promise<void>;
  onStartCallWithContact: (contact: Contact, type: 'audio' | 'video') => void;
  onCallBackPeer: (
    peer: { uid: string; name: string; initials: string; avatarBg: string },
    type: 'audio' | 'video'
  ) => void;
}

export const CallsView: React.FC<CallsViewProps> = ({
  myUid,
  calls,
  zapeiContacts,
  pushStatus,
  pushBusy,
  pushFeedback,
  onEnableBackgroundPush,
  onStartCallWithContact,
  onCallBackPeer,
}) => {
  return (
    <div className="mx-auto w-full max-w-4xl overflow-x-hidden px-3.5 sm:px-4 py-4 sm:py-5 pb-safe-nav md:pb-8 space-y-5">
      {/* Real Closed-App / Locked-Screen Web Push Activation */}
      <BackgroundCallPushCard
        status={pushStatus}
        busy={pushBusy}
        feedback={pushFeedback}
        onEnable={onEnableBackgroundPush}
      />

      {/* Quick Real Call Strip */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Ligações de Voz e Vídeo</h1>
            <p className="text-xs text-slate-500">
              Faça ligações de voz e vídeo gratuitas para qualquer contato no Zapei.
            </p>
          </div>
        </div>

        {zapeiContacts.length > 0 ? (
          <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
            {zapeiContacts.map((contact) => (
              <div
                key={contact.id}
                className="flex min-w-[168px] shrink-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: contact.avatarBg || '#0F5132' }}
                  >
                    {contact.initials}
                  </div>
                  <span className="truncate text-xs font-semibold text-slate-900">
                    {contact.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onStartCallWithContact(contact, 'audio')}
                    title={`Ligar para ${contact.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#0F5132] border border-slate-200 hover:bg-emerald-50"
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCallWithContact(contact, 'video')}
                    title={`Vídeo com ${contact.name}`}
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
            Adicione contatos na aba <strong>Contatos</strong> para iniciar ligações de voz ou vídeo em tempo real.
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
              const peerName = isOutgoing ? call.calleeName : call.callerName;
              const peerInitials = isOutgoing ? call.calleeInitials : call.callerInitials;
              const peerAvatarColor = isOutgoing
                ? call.calleeAvatarColor
                : call.callerAvatarColor;
              const isMissed =
                call.status === 'missed' || call.status === 'declined';

              return (
                <div
                  key={call.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{ backgroundColor: peerAvatarColor || '#0D2B3E' }}
                    >
                      {peerInitials}
                    </div>
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
                          <PhoneOutgoing className="h-3.5 w-3.5 text-[#0F5132]" />
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
                        onCallBackPeer(
                          {
                            uid: peerUid,
                            name: peerName,
                            initials: peerInitials,
                            avatarBg: peerAvatarColor,
                          },
                          'audio'
                        )
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-[#0F5132]"
                      title="Retornar por voz"
                    >
                      <Phone className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onCallBackPeer(
                          {
                            uid: peerUid,
                            name: peerName,
                            initials: peerInitials,
                            avatarBg: peerAvatarColor,
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
