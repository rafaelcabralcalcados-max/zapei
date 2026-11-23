import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface AvatarPreviewTarget {
  name: string;
  initials: string;
  avatarBg?: string;
  avatarUrl?: string;
  subtitle?: string;
}

interface AvatarLightboxModalProps {
  target: AvatarPreviewTarget;
  onClose: () => void;
}

export const AvatarLightboxModal: React.FC<AvatarLightboxModalProps> = ({
  target,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Foto de perfil de ${target.name}`}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex flex-col bg-black/92 backdrop-blur-sm animate-in fade-in duration-150"
    >
      {/* WhatsApp-style top header bar */}
      <header
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-between gap-3 px-4 py-3.5 pt-safe text-white bg-gradient-to-b from-black/70 to-transparent"
      >
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-white">{target.name}</h2>
          {target.subtitle && (
            <p className="truncate text-xs text-white/70">{target.subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar foto"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Enlarged photo stage */}
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        {target.avatarUrl ? (
          <img
            src={target.avatarUrl}
            alt={target.name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[76dvh] max-w-[92vw] sm:max-w-[520px] w-auto rounded-2xl object-contain shadow-2xl ring-1 ring-white/15 select-none"
          />
        ) : (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-64 w-64 sm:h-80 sm:w-80 flex-col items-center justify-center rounded-3xl text-white shadow-2xl ring-1 ring-white/15 select-none"
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
      </div>
    </div>
  );
};
