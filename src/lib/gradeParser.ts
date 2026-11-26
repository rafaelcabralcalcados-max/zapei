import type { CategoryMargin, FavoriteGrade, GradeItem } from '../types/zapei';

/**
 * Parses a comma-separated size grade string such as:
 * "34:1, 35:2, 36:3, 37:3, 38:2, 39:1"
 * or "26/27:3, 28/29:3, 30/31:3, 32/33:3"
 * into structured visual grid items. Never shown raw to public buyers.
 */
export function parseGradeString(raw: string): GradeItem[] {
  if (!raw || !raw.trim()) return [];
  const segments = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const items: GradeItem[] = [];
  for (const segment of segments) {
    const [sizeRaw, pairsRaw] = segment.split(':').map((s) => s.trim());
    if (!sizeRaw) continue;
    const pairs = Number.parseInt(pairsRaw ?? '1', 10);
    if (!Number.isNaN(pairs) && pairs > 0) {
      items.push({ size: sizeRaw, pairs });
    }
  }
  return items;
}

export function getTotalPairsFromGrade(raw: string): number {
  return parseGradeString(raw).reduce((sum, item) => sum + item.pairs, 0);
}

export const ANCHOR_DISCOUNT_PRESETS = [0, 10, 15, 20, 30] as const;

export function computeResellerPrice(factoryPrice: number, margin?: CategoryMargin): number {
  const safeFactoryPrice = Number.isFinite(factoryPrice) ? Math.max(0, factoryPrice) : 0;
  if (!margin) return Number(safeFactoryPrice.toFixed(2));
  const safeMarginValue = Number.isFinite(margin.value) ? Math.max(0, margin.value) : 0;
  if (margin.mode === 'fixed') {
    return Number(Math.max(safeFactoryPrice, safeFactoryPrice + safeMarginValue).toFixed(2));
  }
  return Number(
    Math.max(safeFactoryPrice, safeFactoryPrice * (1 + safeMarginValue / 100)).toFixed(2)
  );
}

/**
 * Computes the strikethrough "De" price backward from the final selling "Por" price
 * and a visual discount percentage (0..80), keeping the net selling price and Split untouched.
 */
export function computeAnchoredOriginalPrice(
  sellingPrice: number,
  discountPercent?: number
): number | null {
  const pct = Number(discountPercent ?? 0);
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) return null;
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 90) return null;
  return Number((sellingPrice / (1 - pct / 100)).toFixed(2));
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function getInitials(name: string): string {
  const parts = name
    .replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'ZP';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const DEFAULT_FAVORITE_GRADES: FavoriteGrade[] = [
  {
    id: 'fav-fem-12',
    label: 'Feminino 34–39 (12 pares)',
    raw: '34:1, 35:2, 36:3, 37:3, 38:2, 39:1',
  },
  {
    id: 'fav-inf-12',
    label: 'Infantil Duplo 26/27–32/33 (12 pares)',
    raw: '26/27:3, 28/29:3, 30/31:3, 32/33:3',
  },
  {
    id: 'fav-masc-12',
    label: 'Masculino 38–43 (12 pares)',
    raw: '38:1, 39:2, 40:3, 41:3, 42:2, 43:1',
  },
  {
    id: 'fav-bolsa-4',
    label: 'Kit Bolsas / Acessórios (4 un)',
    raw: 'Único:4',
  },
];

const BLOCKED_MODERATION_TERMS = [
  'nudez',
  'inapropriado',
  'ofensivo',
  'violencia',
  'proibido',
  'spam',
  'nsfw',
];

export function runImageModerationFilter(fileNameOrTitle: string): {
  approved: boolean;
  reason?: string;
} {
  const normalized = fileNameOrTitle
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const hit = BLOCKED_MODERATION_TERMS.find((term) => normalized.includes(term));
  if (hit) {
    return {
      approved: false,
      reason: `Conteúdo retido pelo filtro automático de moderação de imagem (termo sinalizado: "${hit}").`,
    };
  }
  return { approved: true };
}
