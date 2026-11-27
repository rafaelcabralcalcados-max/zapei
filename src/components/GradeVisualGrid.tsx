import React from 'react';
import { getTotalPairsFromGrade, parseGradeString } from '../lib/gradeParser';

interface GradeVisualGridProps {
  gradeRaw: string;
  compact?: boolean;
  unitLabel?: string;
  title?: string;
}

/**
 * Renders the size/number distribution as individual visual boxes.
 * Top: size label in bold dark petrol (#0D2B3E)
 * Bottom: quantity in orange (#F97316)
 * Never displays raw comma-separated syntax to public buyers.
 */
export const GradeVisualGrid: React.FC<GradeVisualGridProps> = ({
  gradeRaw,
  compact = false,
  unitLabel,
  title,
}) => {
  const items = parseGradeString(gradeRaw);
  const total = getTotalPairsFromGrade(gradeRaw);

  if (items.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        Selecione os tamanhos/numerações e informe a quantidade desejada.
      </p>
    );
  }

  const label = unitLabel ?? (items.length === 1 && items[0].size.toLowerCase() === 'único' ? 'un' : 'un');
  const resolvedTitle = title ?? (label === 'pares' ? 'Grade de numerações' : 'Grade de tamanhos');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-500">{resolvedTitle}</span>
        <span className="font-mono font-semibold text-[#0D2B3E] tabular-nums">
          Total: <span className="text-[#F97316]">{total}</span> {label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, idx) => (
          <div
            key={`${item.size}-${idx}`}
            className={`flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-[#F8FAFC] ${
              compact ? 'min-w-[42px] px-2 py-1' : 'min-w-[48px] px-2.5 py-1.5'
            }`}
          >
            <span
              className={`font-mono font-bold text-[#0D2B3E] leading-tight tabular-nums ${
                compact ? 'text-xs' : 'text-[13px]'
              }`}
            >
              {item.size}
            </span>
            <span
              className={`font-mono font-bold text-[#F97316] leading-tight mt-0.5 tabular-nums ${
                compact ? 'text-[11px]' : 'text-xs'
              }`}
            >
              {item.pairs}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
