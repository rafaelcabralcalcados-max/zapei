import React, { useEffect, useState } from 'react';
import { Check, Copy, Phone, X, ZoomIn, ZoomOut } from 'lucide-react';
import { StarRatingBadge } from './StarRatingBadge';

export interface AvatarPreviewTarget {
  name: string;
  initials: string;
  avatarBg?: string;
  avatarUrl?: string;
  phone?: string;
  virtualLine?: string;
  subtitle?: string;
  ratingAverage?: number;
  ratingCount?: number;
}

interface AvatarLightboxModalProps {
  target: AvatarPreviewTarget;
  onClose: () => void;
}

export const AvatarLightboxModal: React.FC<AvatarLightboxModalProps> = ({
  target,
  onClose,
}) => {
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [naturalDim, setNaturalDim] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setZoomed(false);
    setNaturalDim(null);
  }, [target.avatarUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const primaryNumber = (
    target.phone?.trim() ||
    target.virtualLine?.trim() ||
    ''
  ).trim();
  const secondaryLabel =
    target.subtitle && target.subtitle.trim() !== primaryNumber
      ? target.subtitle.trim()
      : '';

  // Legacy avatars saved before the HD upgrade were stored at 180-256px.
  // Prevent browser over-stretching so older avatars stay clean instead of turning pixelated,
  // while Full HD avatars (600-1080px) render large and razor sharp with zoom support.
  const maxNaturalSide = naturalDim ? Math.max(naturalDim.w, naturalDim.h) : 1080;
  const isLegacyLowRes = Boolean(naturalDim && maxNaturalSide > 0 && maxNaturalSide <= 320);

  const handleCopyNumber = async () => {
    if (!primaryNumber) return;
    try {
      await navigator.clipboard.writeText(primaryNumber);
      setCopiedPhone(true);
      window.setTimeout(() => setCopiedPhone(false), 1800);
    } catch {
      // Ignore clipboard permissions
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Foto de perfil de ${target.name}`}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex flex-col bg-slate-950/95"
    >
      {/* Clean top bar */}
      <header
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950 px-4 py-3.5 pt-safe text-white"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-bold text-white">{target.name}</h2>
            <StarRatingBadge
              average={target.ratingAverage}
              count={target.ratingCount}
              variant="inline"
              tone="dark"
            />
          </div>
          {primaryNumber ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-emerald-300 tabular-nums">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                {primaryNumber}
              </span>
              {secondaryLabel && (
                <span className="truncate text-xs text-white/60">· {secondaryLabel}</span>
              )}
            </div>
          ) : secondaryLabel ? (
            <p className="truncate text-xs text-white/70">{secondaryLabel}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {target.avatarUrl && !isLegacyLowRes && (
            <button
              type="button"
              onClick={() => setZoomed((z) => !z)}
              aria-label={zoomed ? 'Reduzir zoom' : 'Ampliar foto'}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
            >
              {zoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar foto"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Enlarged HD photo + phone info card */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-auto p-4 sm:p-8">
        {target.avatarUrl ? (
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (!isLegacyLowRes) setZoomed((z) => !z);
            }}
            className={`relative overflow-hidden rounded-2xl bg-slate-900 shadow-2xl ring-1 ring-white/15 select-none transition-transform duration-200 ${
              !isLegacyLowRes ? 'cursor-zoom-in' : ''
            } ${zoomed ? 'cursor-zoom-out scale-125 sm:scale-150' : ''}`}
            style={
              isLegacyLowRes
                ? {
                    maxWidth: `${Math.min(340, Math.max(240, Math.round(maxNaturalSide * 1.25)))}px`,
                  }
                : undefined
            }
          >
            <img
              src={target.avatarUrl}
              alt={target.name}
              decoding="sync"
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setNaturalDim({ w: img.naturalWidth, h: img.naturalHeight });
                }
              }}
              className="block max-h-[70dvh] max-w-[92vw] sm:max-w-[560px] w-auto object-contain"
            />
          </div>
        ) : (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-60 w-60 sm:h-76 sm:w-76 flex-col items-center justify-center rounded-3xl text-white shadow-xl ring-1 ring-white/15 select-none"
            style={{ backgroundColor: target.avatarBg || '#0E7A34' }}
          >
            <span className="text-7xl sm:text-8xl font-extrabold tracking-tight">
              {target.initials}
            </span>
            <span className="mt-3 text-xs font-medium text-white/80">
              Sem foto de perfil
            </span>
          </div>
        )}

        <div
          onClick={(e) => e.stopPropagation()}
          className="flex w-full max-w-sm items-center justify-between gap-3 rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-white"
        >
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/55">
              {target.virtualLine && !target.phone ? 'Linha Virtual ChatFi' : 'Telefone'}
            </p>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-white tabular-nums">
              {primaryNumber || 'Número não visível neste contato'}
            </p>
          </div>
          {primaryNumber && (
            <button
              type="button"
              onClick={() => void handleCopyNumber()}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              {copiedPhone ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
