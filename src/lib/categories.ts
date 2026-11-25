import type { CategoryMargin, Product, ProductCategory, ProductUnitType } from '../types/zapei';

export type CategoryBehaviorMode =
  | 'footwear_box'
  | 'apparel_flexible'
  | 'single_asset'
  | 'general_flexible';

export interface CategoryDefinition {
  id: Exclude<
    ProductCategory,
    'Calçados' | 'Bolsas' | 'Sapatos' | 'Joias' | 'Acessórios'
  >;
  shortLabel: string;
  subcategories: string[];
  behavior: CategoryBehaviorMode;
  defaultUnitType: ProductUnitType;
  defaultQuantityPerPack: number;
  defaultMargin: CategoryMargin;
  defaultGradeRaw: string;
  specFields?: Array<{
    key: string;
    label: string;
    placeholder: string;
  }>;
}

export const PRODUCT_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'Calçados & Acessórios',
    shortLabel: 'Calçados',
    subcategories: ['Tênis', 'Sandálias', 'Botas', 'Chinelos', 'Bolsas', 'Cintos'],
    behavior: 'footwear_box',
    defaultUnitType: 'par',
    defaultQuantityPerPack: 12,
    defaultMargin: { mode: 'fixed', value: 100 },
    defaultGradeRaw: '34:1, 35:2, 36:3, 37:3, 38:2, 39:1',
  },
  {
    id: 'Moda Íntima & Lingerie',
    shortLabel: 'Moda Íntima',
    subcategories: ['Conjuntos', 'Sutiãs', 'Calcinhas', 'Cuecas', 'Pijamas', 'Moda Praia'],
    behavior: 'apparel_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 6,
    defaultMargin: { mode: 'percent', value: 35 },
    defaultGradeRaw: 'P:1, M:2, G:2, GG:1',
  },
  {
    id: 'Vestuário & Confecção',
    shortLabel: 'Vestuário',
    subcategories: ['Camisetas', 'Calças', 'Vestidos', 'Moda Fitness', 'Infantil'],
    behavior: 'apparel_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 6,
    defaultMargin: { mode: 'percent', value: 35 },
    defaultGradeRaw: 'P:1, M:2, G:2, GG:1',
  },
  {
    id: 'Automóveis & Veículos',
    shortLabel: 'Veículos',
    subcategories: ['Carros', 'Motos', 'Utilitários', 'Caminhões', 'Peças e Acessórios'],
    behavior: 'single_asset',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 5 },
    defaultGradeRaw: 'Único:1',
    specFields: [
      { key: 'ano', label: 'Ano', placeholder: 'Ex: 2022/2023' },
      { key: 'km', label: 'Quilometragem', placeholder: 'Ex: 42.000 km' },
      { key: 'detalhe', label: 'Câmbio / Combustível', placeholder: 'Ex: Automático · Flex' },
    ],
  },
  {
    id: 'Imóveis & Casas',
    shortLabel: 'Imóveis',
    subcategories: ['Casas', 'Apartamentos', 'Lotes/Terrenos', 'Galpões', 'Pontos Comerciais'],
    behavior: 'single_asset',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 4 },
    defaultGradeRaw: 'Único:1',
    specFields: [
      { key: 'metragem', label: 'Metragem', placeholder: 'Ex: 140 m²' },
      { key: 'quartos', label: 'Quartos / Salas', placeholder: 'Ex: 3 quartos' },
      { key: 'bairro', label: 'Bairro / Cidade', placeholder: 'Ex: Centro' },
    ],
  },
  {
    id: 'Eletrônicos & Celulares',
    shortLabel: 'Eletrônicos',
    subcategories: ['Smartphones', 'Notebooks', 'Áudio', 'Acessórios Tech'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 20 },
    defaultGradeRaw: 'Único:1',
  },
  {
    id: 'Casa, Móveis & Decoração',
    shortLabel: 'Casa & Móveis',
    subcategories: ['Móveis', 'Eletrodomésticos', 'Utilidades Domésticas', 'Cama/Mesa/Banho'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 25 },
    defaultGradeRaw: 'Único:1',
  },
  {
    id: 'Beleza, Perfumaria & Saúde',
    shortLabel: 'Beleza & Saúde',
    subcategories: ['Cosméticos', 'Perfumes', 'Maquiagem', 'Suplementos'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 30 },
    defaultGradeRaw: 'Único:1',
  },
  {
    id: 'Ferramentas, Construção & Agro',
    shortLabel: 'Construção & Agro',
    subcategories: ['Ferramentas', 'Materiais', 'Insumos'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 22 },
    defaultGradeRaw: 'Único:1',
  },
  {
    id: 'Alimentos, Bebidas & Outros',
    shortLabel: 'Alimentos & Outros',
    subcategories: ['Produtos Artesanais', 'Atacado Geral', 'Serviços e Diversos'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 25 },
    defaultGradeRaw: 'Único:1',
  },
];

export type MainCategoryId = CategoryDefinition['id'];

const LEGACY_TO_MAIN: Record<string, MainCategoryId> = {
  Calçados: 'Calçados & Acessórios',
  Sapatos: 'Calçados & Acessórios',
  Bolsas: 'Calçados & Acessórios',
  Acessórios: 'Calçados & Acessórios',
  Joias: 'Calçados & Acessórios',
};

const LEGACY_TO_SUBCATEGORY: Record<string, string> = {
  Calçados: 'Tênis',
  Sapatos: 'Sandálias',
  Bolsas: 'Bolsas',
  Acessórios: 'Cintos',
  Joias: 'Cintos',
};

export function normalizeProductCategory(category?: string): MainCategoryId {
  if (!category) return 'Calçados & Acessórios';
  const found = PRODUCT_CATEGORIES.find((c) => c.id === category);
  if (found) return found.id;
  return LEGACY_TO_MAIN[category] ?? 'Alimentos, Bebidas & Outros';
}

export function inferProductSubcategory(
  category?: string,
  explicitSubcategory?: string
): string | undefined {
  if (explicitSubcategory && explicitSubcategory.trim()) {
    return explicitSubcategory.trim();
  }
  if (category && LEGACY_TO_SUBCATEGORY[category]) {
    return LEGACY_TO_SUBCATEGORY[category];
  }
  return undefined;
}

export function getCategoryDefinition(category?: string): CategoryDefinition {
  const mainId = normalizeProductCategory(category);
  return (
    PRODUCT_CATEGORIES.find((c) => c.id === mainId) ?? PRODUCT_CATEGORIES[0]
  );
}

export function isSingleAssetCategory(category?: string): boolean {
  return getCategoryDefinition(category).behavior === 'single_asset';
}

export function buildDefaultMarginsMap(): Record<string, CategoryMargin> {
  const map: Record<string, CategoryMargin> = {
    Calçados: { mode: 'fixed', value: 100 },
    Bolsas: { mode: 'percent', value: 25 },
    Sapatos: { mode: 'fixed', value: 120 },
    Joias: { mode: 'percent', value: 35 },
    Acessórios: { mode: 'percent', value: 30 },
  };
  for (const cat of PRODUCT_CATEGORIES) {
    map[cat.id] = { ...cat.defaultMargin };
  }
  return map;
}

export function resolveMarginForProduct(
  margins: Record<string, CategoryMargin> | undefined,
  category: string
): CategoryMargin | undefined {
  if (!margins) return undefined;
  if (margins[category]) return margins[category];
  const main = normalizeProductCategory(category);
  if (margins[main]) return margins[main];
  // Fallback to legacy Calçados key if existing connection only has legacy keys
  if (main === 'Calçados & Acessórios' && margins['Calçados']) {
    return margins['Calçados'];
  }
  return undefined;
}

function parseGradeTotalSimple(raw?: string): number {
  if (!raw || !raw.trim()) return 0;
  let total = 0;
  for (const segment of raw.split(',')) {
    const [, qtyRaw] = segment.split(':').map((s) => s.trim());
    const qty = Number.parseInt(qtyRaw ?? '1', 10);
    if (!Number.isNaN(qty) && qty > 0) total += qty;
  }
  return total;
}

export function resolveProductQuantityPerPack(
  product: Pick<Product, 'quantityPerPack' | 'gradeRaw' | 'unitType' | 'category'>
): number {
  if (isSingleAssetCategory(product.category)) return 1;
  if (
    typeof product.quantityPerPack === 'number' &&
    Number.isFinite(product.quantityPerPack) &&
    product.quantityPerPack >= 1
  ) {
    return Math.round(product.quantityPerPack);
  }
  const gradeSum = parseGradeTotalSimple(product.gradeRaw);
  return gradeSum >= 1 ? gradeSum : 1;
}

export function resolveProductUnitType(
  product: Pick<Product, 'unitType' | 'category' | 'quantityPerPack' | 'gradeRaw'>
): ProductUnitType {
  if (isSingleAssetCategory(product.category)) return 'unidade';
  if (
    product.unitType === 'par' ||
    product.unitType === 'unidade' ||
    product.unitType === 'kit'
  ) {
    return product.unitType;
  }
  const main = normalizeProductCategory(product.category);
  if (main === 'Calçados & Acessórios') {
    const sub = inferProductSubcategory(product.category);
    if (sub === 'Bolsas' || sub === 'Cintos') return 'unidade';
    return 'par';
  }
  return 'unidade';
}

export function resolveProductPackLabel(
  product: Pick<Product, 'packLabel' | 'unitType' | 'quantityPerPack' | 'category' | 'gradeRaw'>
): string {
  const qty = resolveProductQuantityPerPack(product);
  if (qty <= 1) return 'Unidade';
  if (product.packLabel && product.packLabel.trim()) {
    return product.packLabel.trim();
  }
  const unit = resolveProductUnitType(product);
  if (unit === 'par') return qty >= 10 ? 'Caixa' : 'Grade';
  if (unit === 'kit') return 'Kit';
  return 'Grade';
}

export function computeUnitPriceFromTotal(
  totalPrice: number,
  quantityPerPack: number
): number {
  const qty = Math.max(1, Math.round(quantityPerPack || 1));
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return 0;
  return Number((totalPrice / qty).toFixed(2));
}

export function formatUnitSuffix(unitType: ProductUnitType): string {
  if (unitType === 'par') return 'par';
  if (unitType === 'kit') return 'unid.';
  return 'unid.';
}

export function formatPackSummaryLabel(params: {
  quantityPerPack: number;
  unitType: ProductUnitType;
  packLabel?: string;
}): string {
  const qty = Math.max(1, Math.round(params.quantityPerPack || 1));
  if (qty === 1) return '1 unidade';
  const unitPlural = params.unitType === 'par' ? 'pares' : 'unid.';
  const label =
    params.packLabel?.trim() ||
    (params.unitType === 'par' ? (qty >= 10 ? 'Caixa' : 'Grade') : 'Kit');
  return `${label} com ${qty} ${unitPlural}`;
}

export function searchMatchesCategoryOrProduct(
  query: string,
  category: string,
  subcategory?: string
): boolean {
  const norm = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  const q = norm(query);
  if (!q) return true;
  const main = normalizeProductCategory(category);
  const def = getCategoryDefinition(main);
  if (norm(main).includes(q) || norm(category).includes(q)) return true;
  if (subcategory && norm(subcategory).includes(q)) return true;
  return def.subcategories.some((s) => norm(s).includes(q));
}
