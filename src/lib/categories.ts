import type {
  CategoryMargin,
  MinimumDeliveryPolicy,
  Product,
  ProductCategory,
  ProductUnitType,
} from '../types/zapei';

export type CategoryBehaviorMode =
  | 'footwear_box'
  | 'apparel_flexible'
  | 'single_asset'
  | 'general_flexible';

export interface CategorySpecField {
  key: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'select';
  options?: string[];
}

export interface CategoryDefinition {
  id: Exclude<
    ProductCategory,
    'Calçados' | 'Bolsas' | 'Sapatos' | 'Joias' | 'Acessórios'
  >;
  shortLabel: string;
  description: string;
  subcategories: string[];
  audienceOptions?: string[];
  nonSizedSubcategories?: string[];
  behavior: CategoryBehaviorMode;
  defaultUnitType: ProductUnitType;
  defaultQuantityPerPack: number;
  defaultMargin: CategoryMargin;
  defaultGradeRaw: string;
  namePlaceholder: string;
  specFields?: CategorySpecField[];
}

export const DELIVERY_METHOD_OPTIONS = [
  'A combinar',
  'Envio / Entrega',
  'Retirada no local',
  'Entrega ou Retirada',
];

export const PRODUCT_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'Calçados & Acessórios',
    shortLabel: 'Calçados',
    description: 'Tênis, sandálias, botas, chinelos, bolsas e cintos',
    subcategories: ['Tênis', 'Sandálias', 'Botas', 'Chinelos', 'Sapatos Sociais', 'Bolsas', 'Cintos'],
    audienceOptions: ['Adulto', 'Infantil', 'Juvenil', 'Unissex'],
    nonSizedSubcategories: ['Bolsas', 'Cintos'],
    behavior: 'footwear_box',
    defaultUnitType: 'par',
    defaultQuantityPerPack: 12,
    defaultMargin: { mode: 'fixed', value: 100 },
    defaultGradeRaw: '34:1, 35:2, 36:3, 37:3, 38:2, 39:1',
    namePlaceholder: 'Ex: Tênis Esportivo Couro ou Sandália Tratorada',
    specFields: [
      {
        key: 'condicao',
        label: 'Condição',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Novo', 'Seminovo', 'Usado'],
      },
      {
        key: 'entrega',
        label: 'Entrega / Retirada',
        placeholder: 'Selecione',
        type: 'select',
        options: DELIVERY_METHOD_OPTIONS,
      },
    ],
  },
  {
    id: 'Vestuário & Confecção',
    shortLabel: 'Roupas',
    description: 'Camisetas, calças, vestidos, conjuntos e moda infantil',
    subcategories: ['Camisetas', 'Calças', 'Vestidos', 'Conjuntos', 'Casacos', 'Moda Fitness', 'Infantil'],
    audienceOptions: ['Adulto', 'Infantil', 'Feminino', 'Masculino', 'Unissex'],
    behavior: 'apparel_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 6,
    defaultMargin: { mode: 'percent', value: 35 },
    defaultGradeRaw: 'P:1, M:2, G:2, GG:1',
    namePlaceholder: 'Ex: Camiseta Algodão Premium ou Vestido Midi',
    specFields: [
      {
        key: 'condicao',
        label: 'Condição',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Novo', 'Seminovo', 'Usado'],
      },
      {
        key: 'entrega',
        label: 'Entrega / Retirada',
        placeholder: 'Selecione',
        type: 'select',
        options: DELIVERY_METHOD_OPTIONS,
      },
    ],
  },
  {
    id: 'Moda Íntima & Lingerie',
    shortLabel: 'Moda Íntima',
    description: 'Conjuntos, pijamas, cuecas e moda praia',
    subcategories: ['Conjuntos', 'Sutiãs', 'Calcinhas', 'Cuecas', 'Pijamas', 'Moda Praia'],
    audienceOptions: ['Adulto', 'Infantil', 'Feminino', 'Masculino', 'Unissex'],
    behavior: 'apparel_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 6,
    defaultMargin: { mode: 'percent', value: 35 },
    defaultGradeRaw: 'P:1, M:2, G:2, GG:1',
    namePlaceholder: 'Ex: Conjunto Renda Premium ou Pijama Algodão',
    specFields: [
      {
        key: 'condicao',
        label: 'Condição',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Novo'],
      },
      {
        key: 'entrega',
        label: 'Entrega / Retirada',
        placeholder: 'Selecione',
        type: 'select',
        options: DELIVERY_METHOD_OPTIONS,
      },
    ],
  },
  {
    id: 'Automóveis & Veículos',
    shortLabel: 'Veículos & Motos',
    description: 'Motos, carros, utilitários, caminhões e peças',
    subcategories: ['Motos', 'Carros', 'Utilitários', 'Caminhões', 'Peças e Acessórios'],
    behavior: 'single_asset',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 5 },
    defaultGradeRaw: 'Único:1',
    namePlaceholder: 'Ex: Honda CG 160 Titan ou Fiat Strada Volcano',
    specFields: [
      { key: 'marca', label: 'Marca', placeholder: 'Ex: Honda, Yamaha, Fiat' },
      { key: 'modelo', label: 'Modelo', placeholder: 'Ex: CG 160 Titan, Onix LT' },
      { key: 'ano', label: 'Ano', placeholder: 'Ex: 2023/2024' },
      { key: 'cor', label: 'Cor', placeholder: 'Ex: Vermelha, Preta, Prata' },
      {
        key: 'condicao',
        label: 'Estado / Condição',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Novo (0 km)', 'Seminovo', 'Usado'],
      },
      {
        key: 'entrega',
        label: 'Entrega / Retirada',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Retirada no local', 'Entrega a combinar', 'Entrega ou Retirada', 'Transportadora / Guincho'],
      },
      { key: 'km', label: 'Quilometragem (opcional)', placeholder: 'Ex: 14.000 km' },
    ],
  },
  {
    id: 'Eletrônicos & Celulares',
    shortLabel: 'Eletrônicos',
    description: 'Smartphones, notebooks, TVs, áudio e games',
    subcategories: ['Smartphones', 'Notebooks', 'TVs & Vídeo', 'Áudio', 'Games', 'Acessórios Tech'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 20 },
    defaultGradeRaw: 'Único:1',
    namePlaceholder: 'Ex: Smartphone 256GB ou Notebook 16GB RAM',
    specFields: [
      {
        key: 'condicao',
        label: 'Estado / Condição',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Novo / Lacrado', 'Seminovo', 'Usado'],
      },
      { key: 'marca', label: 'Marca / Modelo', placeholder: 'Ex: Samsung, Apple, Dell' },
      {
        key: 'entrega',
        label: 'Entrega / Retirada',
        placeholder: 'Selecione',
        type: 'select',
        options: DELIVERY_METHOD_OPTIONS,
      },
    ],
  },
  {
    id: 'Casa, Móveis & Decoração',
    shortLabel: 'Casa & Móveis',
    description: 'Móveis, eletrodomésticos, utilidades e decoração',
    subcategories: ['Móveis', 'Eletrodomésticos', 'Utilidades Domésticas', 'Cama/Mesa/Banho', 'Decoração'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 25 },
    defaultGradeRaw: 'Único:1',
    namePlaceholder: 'Ex: Sofá Retrátil 3 Lugares ou Geladeira Frost Free',
    specFields: [
      {
        key: 'condicao',
        label: 'Estado / Condição',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Novo', 'Seminovo', 'Usado'],
      },
      { key: 'detalhe', label: 'Detalhes / Medidas', placeholder: 'Ex: Madeira maciça · 2,10m' },
      {
        key: 'entrega',
        label: 'Entrega / Retirada',
        placeholder: 'Selecione',
        type: 'select',
        options: DELIVERY_METHOD_OPTIONS,
      },
    ],
  },
  {
    id: 'Imóveis & Casas',
    shortLabel: 'Imóveis',
    description: 'Casas, apartamentos, terrenos e pontos comerciais',
    subcategories: ['Casas', 'Apartamentos', 'Lotes/Terrenos', 'Galpões', 'Pontos Comerciais'],
    behavior: 'single_asset',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 4 },
    defaultGradeRaw: 'Único:1',
    namePlaceholder: 'Ex: Casa 3 Quartos com Quintal no Centro',
    specFields: [
      { key: 'metragem', label: 'Metragem', placeholder: 'Ex: 140 m²' },
      { key: 'quartos', label: 'Quartos / Salas', placeholder: 'Ex: 3 quartos' },
      { key: 'bairro', label: 'Bairro / Cidade', placeholder: 'Ex: Centro' },
      {
        key: 'entrega',
        label: 'Visita / Entrega',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Visita agendada', 'A combinar', 'Chaves imediatas'],
      },
    ],
  },
  {
    id: 'Beleza, Perfumaria & Saúde',
    shortLabel: 'Beleza & Saúde',
    description: 'Cosméticos, perfumes, maquiagem e suplementos',
    subcategories: ['Cosméticos', 'Perfumes', 'Maquiagem', 'Suplementos', 'Cuidados Pessoais'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 30 },
    defaultGradeRaw: 'Único:1',
    namePlaceholder: 'Ex: Perfume Importado 100ml ou Kit Skincare',
    specFields: [
      {
        key: 'condicao',
        label: 'Estado / Condição',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Novo / Lacrado', 'Novo'],
      },
      {
        key: 'entrega',
        label: 'Entrega / Retirada',
        placeholder: 'Selecione',
        type: 'select',
        options: DELIVERY_METHOD_OPTIONS,
      },
    ],
  },
  {
    id: 'Ferramentas, Construção & Agro',
    shortLabel: 'Construção & Agro',
    description: 'Ferramentas, máquinas, materiais e insumos',
    subcategories: ['Ferramentas', 'Materiais', 'Máquinas', 'Insumos'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 22 },
    defaultGradeRaw: 'Único:1',
    namePlaceholder: 'Ex: Parafusadeira sem Fio 20V ou Betoneira 400L',
    specFields: [
      {
        key: 'condicao',
        label: 'Estado / Condição',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Novo', 'Seminovo', 'Usado'],
      },
      {
        key: 'entrega',
        label: 'Entrega / Retirada',
        placeholder: 'Selecione',
        type: 'select',
        options: DELIVERY_METHOD_OPTIONS,
      },
    ],
  },
  {
    id: 'Alimentos, Bebidas & Outros',
    shortLabel: 'Geral & Outros',
    description: 'Itens diversos, artesanais, alimentos e geral',
    subcategories: ['Itens Gerais', 'Produtos Artesanais', 'Alimentos & Bebidas', 'Serviços e Diversos'],
    behavior: 'general_flexible',
    defaultUnitType: 'unidade',
    defaultQuantityPerPack: 1,
    defaultMargin: { mode: 'percent', value: 25 },
    defaultGradeRaw: 'Único:1',
    namePlaceholder: 'Ex: Café Especial 1kg ou Produto Diverso',
    specFields: [
      {
        key: 'condicao',
        label: 'Estado / Condição',
        placeholder: 'Selecione',
        type: 'select',
        options: ['Novo', 'Seminovo', 'Usado', 'Sob encomenda'],
      },
      {
        key: 'entrega',
        label: 'Entrega / Retirada',
        placeholder: 'Selecione',
        type: 'select',
        options: DELIVERY_METHOD_OPTIONS,
      },
    ],
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
  if (!category) return 'Alimentos, Bebidas & Outros';
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
    PRODUCT_CATEGORIES.find((c) => c.id === mainId) ??
    PRODUCT_CATEGORIES[PRODUCT_CATEGORIES.length - 1]
  );
}

export function isSingleAssetCategory(category?: string): boolean {
  return getCategoryDefinition(category).behavior === 'single_asset';
}

export function categoryUsesFootwearSizes(
  category?: string,
  subcategory?: string
): boolean {
  const def = getCategoryDefinition(category);
  if (def.behavior !== 'footwear_box') return false;
  if (subcategory && def.nonSizedSubcategories?.includes(subcategory)) return false;
  return true;
}

export function categoryUsesApparelSizes(category?: string): boolean {
  return getCategoryDefinition(category).behavior === 'apparel_flexible';
}

export function getGradeDisplayTitle(category?: string): string {
  const def = getCategoryDefinition(category);
  if (def.behavior === 'footwear_box') return 'Grade de numerações';
  if (def.behavior === 'apparel_flexible') return 'Grade de tamanhos';
  return 'Composição do pacote';
}

export function hasStructuredGrade(gradeRaw?: string): boolean {
  if (!gradeRaw || !gradeRaw.trim()) return false;
  const segments = gradeRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.length === 1) {
    const [size] = segments[0].split(':').map((s) => s.trim().toLowerCase());
    if (size === 'único' || size === 'unico') return false;
  }
  return true;
}

const LEGACY_DEFAULT_POLICY_RE = /^mínimo\s+1\s+caixa(\s*·\s*retirada no balcão)?$/i;

export function hasExplicitWholesalePolicy(
  policy?: Partial<MinimumDeliveryPolicy> | null
): boolean {
  if (!policy) return false;
  const label = (policy.label || '').trim();
  if (!label) return false;
  if (LEGACY_DEFAULT_POLICY_RE.test(label)) return false;
  if (policy.type === 'pieces' && (policy.value ?? 1) <= 1 && !policy.allowCounterPickup) {
    return false;
  }
  if (policy.type === 'boxes' && (policy.value ?? 1) <= 1 && !policy.allowCounterPickup) {
    return false;
  }
  return true;
}

export function parseSpecsSummaryEntries(
  specsSummary?: string
): Array<{ label: string; value: string }> {
  if (!specsSummary || !specsSummary.trim()) return [];
  return specsSummary
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf(':');
      if (idx === -1) return { label: '', value: part };
      return {
        label: part.slice(0, idx).trim(),
        value: part.slice(idx + 1).trim(),
      };
    })
    .filter((entry) => entry.value.length > 0);
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
  if (qty <= 1) {
    const unit = resolveProductUnitType(product);
    return unit === 'par' ? 'Par' : 'Unidade';
  }
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
  if (qty === 1) return params.unitType === 'par' ? '1 par' : '1 unidade';
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
  if (norm(main).includes(q) || norm(category).includes(q) || norm(def.shortLabel).includes(q)) {
    return true;
  }
  if (subcategory && norm(subcategory).includes(q)) return true;
  return def.subcategories.some((s) => norm(s).includes(q));
}
