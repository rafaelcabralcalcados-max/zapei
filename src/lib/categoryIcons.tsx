import React from 'react';
import {
  Car,
  Footprints,
  HeartPulse,
  Home,
  LayoutGrid,
  Shirt,
  Smartphone,
  Sofa,
  Sparkles,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react';
import type { MainCategoryId } from './categories';

export const CategoryIcon: React.FC<{
  categoryId: 'Todas' | MainCategoryId;
  className?: string;
}> = ({ categoryId, className = 'h-4 w-4' }) => {
  switch (categoryId) {
    case 'Todas':
      return <LayoutGrid className={className} />;
    case 'Calçados & Acessórios':
      return <Footprints className={className} />;
    case 'Moda Íntima & Lingerie':
      return <Sparkles className={className} />;
    case 'Vestuário & Confecção':
      return <Shirt className={className} />;
    case 'Automóveis & Veículos':
      return <Car className={className} />;
    case 'Imóveis & Casas':
      return <Home className={className} />;
    case 'Eletrônicos & Celulares':
      return <Smartphone className={className} />;
    case 'Casa, Móveis & Decoração':
      return <Sofa className={className} />;
    case 'Beleza, Perfumaria & Saúde':
      return <HeartPulse className={className} />;
    case 'Ferramentas, Construção & Agro':
      return <Wrench className={className} />;
    case 'Alimentos, Bebidas & Outros':
      return <UtensilsCrossed className={className} />;
  }
};
