import React, { useEffect, useRef, useState } from 'react';
import {
  FolderOpen,
  MessageSquare,
  Mic,
  Music,
  PhoneIncoming,
  Play,
  RotateCcw,
  Square,
  Volume2,
} from 'lucide-react';
import {
  getAllCustomSoundMeta,
  hydrateCustomSounds,
  removeCustomSound,
  saveCustomSoundFromFile,
  subscribeCustomSounds,
  type CustomSoundMetaMap,
  type CustomSoundSlot,
} from '../lib/customSounds';
import { formatBytesPtBr } from '../lib/localMediaCache';
import {
  previewCustomSoundSlot,
  stopCustomSoundPreview,
} from '../lib/webrtcService';

interface CustomSoundsCardProps {
  onNotify?: (message: string) => void;
}

const SOUND_SLOTS: Array<{
  slot: CustomSoundSlot;
  title: string;
  subtitle: string;
  defaultLabel: string;
  icon: React.FC<{ className?: string }>;
  accentBg: string;
}> = [
  {
    slot: 'call',
    title: 'Toque de Chamadas (Voz e Vídeo)',
    subtitle: 'Toca em loop enquanto o telefone chama',
    defaultLabel: 'Toque padrão do ChatFi',
    icon: PhoneIncoming,
    accentBg: 'bg-[#0E7A34] text-white',
  },
  {
    slot: 'text_message',
    title: 'Mensagens de Texto (e Fotos/Vídeos)',
    subtitle: 'Alerta ao receber nova mensagem escrita ou mídia',
    defaultLabel: 'Som padrão de mensagem',
    icon: MessageSquare,
    accentBg: 'bg-[#0D2B3E] text-white',
  },
  {
    slot: 'audio_message',
    title: 'Mensagens de Áudio (Voz)',
    subtitle: 'Alerta exclusivo ao receber mensagem de voz',
    defaultLabel: 'Som padrão de áudio',
    icon: Mic,
    accentBg: 'bg-emerald-700 text-white',
  },
];

export const CustomSoundsCard: React.FC<CustomSoundsCardProps> = ({ onNotify }) => {
  const [metaMap, setMetaMap] = useState<CustomSoundMetaMap>(() => getAllCustomSoundMeta());
  const [playingSlot, setPlayingSlot] = useState<CustomSoundSlot | null>(null);
  const [savingSlot, setSavingSlot] = useState<CustomSoundSlot | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const inputRefs = useRef<Record<CustomSoundSlot, HTMLInputElement | null>>({
    call: null,
    text_message: null,
    audio_message: null,
  });

  useEffect(() => {
    void hydrateCustomSounds();
    const unsub = subscribeCustomSounds(setMetaMap);
    return () => {
      unsub();
      stopCustomSoundPreview();
    };
  }, []);

  const handlePickFile = async (
    slot: CustomSoundSlot,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setErrorMsg('');
    setSavingSlot(slot);
    try {
      const saved = await saveCustomSoundFromFile(slot, file);
      onNotify?.(`Som salvo neste aparelho: ${saved.fileName}`);
      setPlayingSlot(slot);
      previewCustomSoundSlot(slot, () => {
        setPlayingSlot((curr) => (curr === slot ? null : curr));
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Não foi possível salvar o som escolhido.'
      );
    } finally {
      setSavingSlot(null);
    }
  };

  const handleTogglePreview = (slot: CustomSoundSlot) => {
    if (playingSlot === slot) {
      stopCustomSoundPreview();
      setPlayingSlot(null);
      return;
    }
    setPlayingSlot(slot);
    previewCustomSoundSlot(slot, () => {
      setPlayingSlot((curr) => (curr === slot ? null : curr));
    });
  };

  const handleResetDefault = async (slot: CustomSoundSlot) => {
    if (playingSlot === slot) {
      stopCustomSoundPreview();
      setPlayingSlot(null);
    }
    setErrorMsg('');
    await removeCustomSound(slot);
    onNotify?.('Som restaurado para o padrão do ChatFi.');
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0E7A34] text-white">
          <Music className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900 sm:text-base">
            Sons e Toques do Seu Celular
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
            Escolha qualquer música, toque ou som de notificação salvo no seu aparelho (MP3, M4A, OGG, OPUS ou WAV) para tocar nas chamadas, mensagens de texto e mensagens de áudio.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="space-y-2.5">
        {SOUND_SLOTS.map(({ slot, title, subtitle, defaultLabel, icon: Icon, accentBg }) => {
          const customMeta = metaMap[slot];
          const isPlaying = playingSlot === slot;
          const isSaving = savingSlot === slot;

          return (
            <div
              key={slot}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <input
                ref={(el) => {
                  inputRefs.current[slot] = el;
                }}
                type="file"
                accept="audio/*,.mp3,.m4a,.ogg,.opus,.wav,.aac,.flac,.amr,.3gp"
                onChange={(e) => void handlePickFile(slot, e)}
                className="hidden"
              />

              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accentBg}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 sm:text-sm">{title}</p>
                  <p className="text-[11px] text-slate-500">{subtitle}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex max-w-full items-center gap-1 truncate rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        customMeta
                          ? 'bg-emerald-100 text-[#0E7A34]'
                          : 'bg-slate-200/80 text-slate-600'
                      }`}
                    >
                      <Volume2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {customMeta ? customMeta.fileName : defaultLabel}
                      </span>
                    </span>
                    {customMeta && (
                      <span className="text-[10px] font-medium text-slate-400">
                        {formatBytesPtBr(customMeta.sizeBytes)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleTogglePreview(slot)}
                  className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition ${
                    isPlaying
                      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {isPlaying ? (
                    <>
                      <Square className="h-3.5 w-3.5 fill-current" />
                      Parar
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current text-[#0E7A34]" />
                      Ouvir
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => inputRefs.current[slot]?.click()}
                  className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-[#0E7A34] px-3 text-xs font-semibold text-white transition hover:bg-[#0B5D27] disabled:opacity-60"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {isSaving ? 'Salvando...' : 'Escolher do celular'}
                </button>

                {customMeta && (
                  <button
                    type="button"
                    onClick={() => void handleResetDefault(slot)}
                    title="Restaurar som padrão do ChatFi"
                    className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-red-50 hover:text-red-700"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Padrão</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
        Os toques selecionados ficam salvos localmente neste aparelho e funcionam mesmo sem conexão. Em segundo plano, as notificações utilizam o som padrão configurado no sistema do seu celular.
      </p>
    </section>
  );
};
