import React from 'react';
import { Star } from 'lucide-react';

interface StarRatingBadgeProps {
  average?: number;
  count?: number;
  variant?: 'inline' | 'card';
  showEmpty?: boolean;
  label?: string;
  tone?: 'light' | 'dark';
}

export const StarRatingBadge: React.FC<StarRatingBadgeProps> = ({
  average = 0,
  count = 0,
  variant = 'inline',
  showEmpty = false,
  label,
  tone = 'light',
}) => {
  const safeCount = Math.max(0, Math.round(Number(count) || 0));
  const safeAvg = Math.min(5, Math.max(0, Number(average) || 0));

  if (safeCount === 0 && !showEmpty) {
    return null;
  }

  if (variant === 'card') {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-0.5 text-amber-500">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={`h-3.5 w-3.5 ${
                safeCount > 0 && star <= Math.round(safeAvg)
                  ? 'fill-amber-400 text-amber-500'
                  : 'text-slate-300'
              }`}
            />
          ))}
        </div>
        {safeCount > 0 ? (
          <span className="font-semibold text-slate-800">
            <span className="font-mono tabular-nums">{safeAvg.toFixed(1)}</span>{' '}
            <span className="font-normal text-slate-500">
              ({safeCount} {safeCount === 1 ? 'avaliação' : 'avaliações'})
            </span>
          </span>
        ) : (
          <span className="text-slate-500">{label || 'Sem avaliações ainda'}</span>
        )}
      </div>
    );
  }

  const isDark = tone === 'dark';

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
        isDark ? 'text-white/90' : 'text-slate-700'
      }`}
      title={
        safeCount > 0
          ? `Avaliação média: ${safeAvg.toFixed(1)} de 5 (${safeCount} ${
              safeCount === 1 ? 'avaliação' : 'avaliações'
            })`
          : 'Sem avaliações ainda'
      }
    >
      <Star
        className={`h-3.5 w-3.5 shrink-0 ${
          safeCount > 0
            ? 'fill-amber-400 text-amber-500'
            : isDark
              ? 'text-white/40'
              : 'text-slate-300'
        }`}
      />
      {safeCount > 0 ? (
        <>
          <span
            className={`font-mono tabular-nums ${
              isDark ? 'text-white' : 'text-slate-800'
            }`}
          >
            {safeAvg.toFixed(1)}
          </span>
          <span
            className={`font-normal ${
              isDark ? 'text-white/60' : 'text-slate-400'
            }`}
          >
            ({safeCount})
          </span>
        </>
      ) : (
        <span
          className={`font-normal ${
            isDark ? 'text-white/60' : 'text-slate-400'
          }`}
        >
          Novo
        </span>
      )}
    </span>
  );
};
