import React, { useEffect, useState } from 'react';
import { Check, Copy, Phone, X } from 'lucide-react';
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
      {/* Clean top bar without blurry glow beam */}
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar foto"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Enlarged photo + phone info card */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 sm:p-8">
        {target.avatarUrl ? (
          <img
            src={target.avatarUrl}
            alt={target.name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[66dvh] max-w-[92vw] sm:max-w-[500px] w-auto rounded-2xl object-contain shadow-xl ring-1 ring-white/15 select-none"
          />
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
