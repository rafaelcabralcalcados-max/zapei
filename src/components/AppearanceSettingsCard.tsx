import React, { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, Moon, Palette, RotateCcw, Sun } from 'lucide-react';
import {
  APPEARANCE_EVENT,
  compressWallpaperImageFile,
  readAppearancePrefs,
  saveAppearancePrefs,
  type AppearancePrefs,
  type ThemeMode,
} from '../lib/appearancePrefs';

interface AppearanceSettingsCardProps {
  onNotify?: (message: string) => void;
}

export const AppearanceSettingsCard: React.FC<AppearanceSettingsCardProps> = ({ onNotify }) => {
  const [prefs, setPrefs] = useState<AppearancePrefs>(() => readAppearancePrefs());
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const sync = (ev: Event) => {
      const customEv = ev as CustomEvent<AppearancePrefs>;
      if (customEv.detail) {
        setPrefs(customEv.detail);
      } else {
        setPrefs(readAppearancePrefs());
      }
    };
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);

  const handleSetTheme = (theme: ThemeMode) => {
    setErrorMsg('');
    try {
      const updated = saveAppearancePrefs({ ...prefs, theme });
      setPrefs(updated);
      onNotify?.(theme === 'dark' ? 'Modo escuro ativado.' : 'Modo claro ativado.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível salvar o tema.');
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg('');
    setUploading(true);
    try {
      const compressedDataUrl = await compressWallpaperImageFile(file);
      const updated = saveAppearancePrefs({
        ...prefs,
        customWallpaper: compressedDataUrl,
      });
      setPrefs(updated);
      onNotify?.('Papel de parede das conversas atualizado!');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Não foi possível aplicar a imagem escolhida.'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDimChange = (dimValue: number) => {
    try {
      const updated = saveAppearancePrefs({ ...prefs, wallpaperDim: dimValue });
      setPrefs(updated);
    } catch {
      // Non-fatal
    }
  };

  const handleResetWallpaper = () => {
    setErrorMsg('');
    const updated = saveAppearancePrefs({
      ...prefs,
      customWallpaper: null,
      wallpaperDim: 22,
    });
    setPrefs(updated);
    onNotify?.('Fundo padrão do ChatFi restaurado.');
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
      <div className="flex items-start gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#0E7A34]">
          <Palette className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Aparência e Papel de Parede
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Ative o modo escuro em todo o ChatFi ou escolha qualquer imagem da sua galeria como fundo das conversas.
          </p>
        </div>
      </div>

      {/* Theme Mode Selector */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          Tema do aplicativo
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleSetTheme('light')}
            className={`flex items-center justify-between gap-2 rounded-xl border p-3.5 text-left transition ${
              prefs.theme === 'light'
                ? 'border-[#0E7A34] bg-emerald-50/70 ring-1 ring-[#0E7A34]/30'
                : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                <Sun className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Claro</p>
                <p className="text-[11px] text-slate-500">Visual iluminado</p>
              </div>
            </div>
            {prefs.theme === 'light' && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0E7A34] text-white">
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleSetTheme('dark')}
            className={`flex items-center justify-between gap-2 rounded-xl border p-3.5 text-left transition ${
              prefs.theme === 'dark'
                ? 'border-[#16A34A] bg-emerald-50/70 ring-1 ring-[#16A34A]/30'
                : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-emerald-300">
                <Moon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Escuro</p>
                <p className="text-[11px] text-slate-500">Conforto noturno</p>
              </div>
            </div>
            {prefs.theme === 'dark' && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#16A34A] text-white">
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Custom Chat Wallpaper Picker + Live Preview */}
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Papel de parede das conversas
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {prefs.customWallpaper
                ? 'Imagem personalizada aplicada nas conversas.'
                : 'Usando o fundo vetorial padrão do ChatFi.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => void handleFilePicked(e)}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#0E7A34] px-3.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#0B5D27] disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {prefs.customWallpaper ? 'Trocar imagem' : 'Escolher imagem da galeria'}
            </button>
            {prefs.customWallpaper && (
              <button
                type="button"
                onClick={handleResetWallpaper}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restaurar padrão
              </button>
            )}
          </div>
        </div>

        {/* Live Mini Chat Preview */}
        <div className="chatfi-chat-wallpaper relative overflow-hidden rounded-2xl border border-slate-200 p-4">
          <div className="space-y-2">
            <div className="flex justify-start">
              <div className="chatfi-bubble-in max-w-[78%] rounded-2xl rounded-bl-sm border border-slate-200/80 bg-white px-3 py-2 text-xs text-slate-800 shadow-xs">
                <p>Oi! Olha como ficou o fundo da conversa.</p>
                <span className="mt-0.5 block text-right font-mono text-[9px] text-slate-400">
                  08:15
                </span>
              </div>
            </div>
            <div className="flex justify-end">
              <div className="max-w-[78%] rounded-2xl rounded-br-sm bg-gradient-to-br from-[#0F8238] to-[#0B632A] px-3 py-2 text-xs text-white shadow-xs">
                <p>Ficou muito bonito e fácil de ler!</p>
                <span className="mt-0.5 block text-right font-mono text-[9px] text-emerald-100/80">
                  08:16
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Readability Overlay Slider (when a custom wallpaper is active) */}
        {prefs.customWallpaper && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700">
                Escurecer imagem para melhorar a leitura
              </span>
              <span className="font-mono font-bold text-[#0E7A34] tabular-nums">
                {prefs.wallpaperDim}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={70}
              step={2}
              value={prefs.wallpaperDim}
              onChange={(e) => handleDimChange(Number(e.target.value))}
              className="mt-2 h-2 w-full cursor-pointer accent-[#0E7A34]"
              aria-label="Intensidade de escurecimento do papel de parede"
            />
          </div>
        )}

        {errorMsg && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {errorMsg}
          </p>
        )}
      </div>
    </section>
  );
};
