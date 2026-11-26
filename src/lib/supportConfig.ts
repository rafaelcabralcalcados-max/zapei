import type { CommercialMode, SupportTicketReason } from '../types/zapei';

export const OFFICIAL_SUPPORT_UID = 'chatfi_suporte_oficial';
export const OFFICIAL_SUPPORT_VIRTUAL_LINE = 'CFI-0800-0001';
export const OFFICIAL_SUPPORT_NAME = 'Suporte Oficial ChatFi';
export const OFFICIAL_SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() ||
  'contato@chatfi.app';
export const OFFICIAL_SUPPORT_WHATSAPP =
  (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined)?.replace(/\D/g, '') ||
  '5537999990000';

export const SUPPORT_TICKET_REASONS: SupportTicketReason[] = [
  'Problema com Pagamento / Pix',
  'Dúvida sobre Pedido',
  'Configuração de Wallet ID Asaas',
  'Denúncia / Segurança',
  'Outros',
];

export interface SupportFaqItem {
  id: string;
  question: string;
  answer: string;
  steps?: string[];
}

export type FaqProfileTab = 'buyer' | 'reseller' | 'manufacturer';

export const FAQ_PROFILE_TABS: Array<{
  id: FaqProfileTab;
  label: string;
  subtitle: string;
}> = [
  {
    id: 'buyer',
    label: 'Compradores',
    subtitle: 'Pagamentos, acompanhamento e proteção do pedido',
  },
  {
    id: 'reseller',
    label: 'Revendedores',
    subtitle: 'Margem de lucro, preço De / Por e Split Asaas',
  },
  {
    id: 'manufacturer',
    label: 'Fabricantes',
    subtitle: 'Grades, conferência de estoque e cota de produção',
  },
];

export const FAQ_BY_PROFILE: Record<FaqProfileTab, SupportFaqItem[]> = {
  buyer: [
    {
      id: 'buyer-payment',
      question: 'Como funciona o pagamento seguro (Pix / Cartão)?',
      answer:
        'Todo pagamento no ChatFi é processado via Asaas com ambiente criptografado. Você pode pagar via Pix à vista (QR Code gerado na hora com confirmação automática) ou no Cartão de Crédito em até 12x diretamente na fatura segura.',
      steps: [
        'Escolha Pix à vista ou Cartão (1x a 12x) nos detalhes do seu pedido.',
        'Clique em "Gerar Cobrança Asaas" para visualizar o QR Code Pix ou abrir o link seguro do cartão.',
        'Após pagar, toque em "Já paguei / Verificar Status" para atualizar a confirmação instantaneamente.',
      ],
    },
    {
      id: 'buyer-tracking',
      question: 'Como acompanhar meu pedido até a entrega?',
      answer:
        'Abra a vitrine da loja onde você comprou e acesse a aba "Meus Pedidos", ou toque no botão "Abrir detalhes do pedido" direto no cartão enviado dentro da sua conversa.',
      steps: [
        'Em conferência de estoque: o vendedor e a fábrica estão validando a disponibilidade.',
        'Estoque confirmado / Preparando despacho: sua mercadoria já foi reservada para envio.',
        'Despachado: o comprovante ou número do conhecimento/canhoto fica disponível nos detalhes do pedido.',
      ],
    },
    {
      id: 'buyer-delay',
      question: 'O que fazer em caso de atraso ou divergência no pedido?',
      answer:
        'Primeiro, envie uma mensagem direta ao vendedor no chat do pedido informando o número do pedido. Caso não receba retorno em até 24 horas úteis ou identifique divergência de pagamento/entrega, abra um chamado aqui na Central vinculando o pedido.',
      steps: [
        'Toque em "Precisa de ajuda?" dentro do pedido com problema.',
        'Escolha o motivo ("Dúvida sobre Pedido" ou "Problema com Pagamento / Pix").',
        'Descreva o ocorrido — nossa equipe analisa pelo código do pedido e pela sua Linha Virtual.',
      ],
    },
  ],
  reseller: [
    {
      id: 'reseller-margin',
      question: 'Como configurar minha margem de lucro por categoria?',
      answer:
        'No Painel do Revendedor, acesse suas conexões com fábricas e ajuste a margem fixa (R$) ou percentual (%) para cada categoria de produto. O preço exibido na sua vitrine já embute sua margem e taxas, sem expor o custo de fábrica ao consumidor.',
      steps: [
        'Acesse Painel do Revendedor → Conexões / Fábricas.',
        'Escolha entre margem fixa (R$) ou percentual (%) em cada categoria.',
        'O valor final ao cliente e sua comissão líquida são atualizados automaticamente.',
      ],
    },
    {
      id: 'reseller-anchor',
      question: "Como ativar o preço promocional ('De / Por') na vitrine?",
      answer:
        'Nas configurações da sua vitrine dentro do Painel do Revendedor, você pode ativar o desconto visual ("De / Por"). O ChatFi calcula um preço anterior riscado proporcional tanto no valor por par/unidade quanto no valor da caixa fechada.',
      steps: [
        'Entre no Painel do Revendedor e abra a configuração de Vitrine & Desconto Visual.',
        'Selecione o percentual de destaque (ex.: 10%, 15%, 20% OFF) ou deixe em 0% para desativar.',
        'Salve para exibir imediatamente o preço "De / Por" com selo de economia nos cards da sua loja.',
      ],
    },
    {
      id: 'reseller-wallet',
      question: 'Como cadastrar meu Wallet ID Asaas para receber as comissões?',
      answer:
        'Com o Wallet ID Asaas cadastrado, cada venda paga via Pix ou Cartão faz o Split automático: sua comissão líquida vai direto para sua conta Asaas, separada da cota do fabricante e da taxa da plataforma.',
      steps: [
        'Crie ou acesse sua conta gratuita no site/app asaas.com (CPF ou CNPJ).',
        'No Asaas, vá em Configurações da Conta → Integrações (ou Minha Conta → Dados da Conta).',
        'Copie o código Wallet ID, cole no campo "Wallet ID Asaas (Recebimento Split)" no Painel do Revendedor ou em Ajustes e salve.',
      ],
    },
  ],
  manufacturer: [
    {
      id: 'mfg-catalog',
      question: 'Como cadastrar produtos por grade, caixa ou unidade avulsa?',
      answer:
        'No Painel do Fabricante → Catálogo → Cadastrar Novo Produto, você escolhe a categoria do produto, a unidade de venda (Par, Unidade ou Kit) e a quantidade por grade/caixa (1 unidade avulsa, 6, 12, 15 pares ou valor personalizado).',
      steps: [
        'Selecione a categoria e preencha nome, SKU/referência e foto do produto.',
        'Defina a Quantidade por Grade / Caixa e informe a numeração ou variação (ex.: 34/1, 35/2...).',
        'Ao digitar o preço da caixa ou grade, o ChatFi calcula automaticamente o valor unitário por par/peça.',
      ],
    },
    {
      id: 'mfg-stock',
      question: 'Como confirmar estoque e enviar o comprovante de despacho?',
      answer:
        'Todos os pedidos recebidos aparecem na aba Conferência do Painel do Fabricante. Após confirmar os itens disponíveis, o revendedor envia os dados da transportadora/distribuidora para você despachar e anexar o canhoto.',
      steps: [
        'Abra a aba Conferência e marque cada item como "Disponível" ou "Esgotado".',
        'Clique em "Confirmar Conferência e Baixar Estoque" para atualizar o estoque em tempo real.',
        'Na aba Despacho, confira a transportadora informada, anexe a foto/observação do canhoto e confirme o envio.',
      ],
    },
    {
      id: 'mfg-split',
      question: 'Como receber minha cota de produção via Split Asaas?',
      answer:
        'Cadastre o Wallet ID Asaas da fábrica no topo da aba Financeiro do Painel do Fabricante (ou em Ajustes). Assim que o comprador finaliza o pagamento da cobrança Asaas, sua cota líquida de produção é creditada automaticamente via Split.',
      steps: [
        'Acesse asaas.com → Configurações da Conta → Integrações e copie seu Wallet ID.',
        'Cole no campo "Wallet ID Asaas (Recebimento Split)" no Painel do Fabricante e salve.',
        'Acompanhe o extrato líquido de cada subpedido e o status da cobrança na aba Financeiro.',
      ],
    },
  ],
};

export function commercialModeToFaqTab(mode: CommercialMode): FaqProfileTab {
  if (mode === 'manufacturer') return 'manufacturer';
  if (mode === 'reseller') return 'reseller';
  return 'buyer';
}

export function buildSupportContactMessage(params: {
  userName: string;
  userVirtualLine?: string;
  userPhone?: string;
  orderCode?: string;
  orderId?: string;
  reason?: string;
  customNote?: string;
}): string {
  const identityLine = params.userVirtualLine || params.userPhone || 'Não informada';
  const lines = [
    'Olá, Suporte Oficial ChatFi! Preciso de atendimento.',
    `• Usuário: ${params.userName}`,
    `• Linha Virtual ChatFi: ${identityLine}`,
  ];
  if (params.orderCode || params.orderId) {
    const orderDisplay = params.orderCode
      ? `${params.orderCode}${params.orderId ? ` (ID: ${params.orderId})` : ''}`
      : params.orderId;
    lines.push(`• Pedido vinculado: ${orderDisplay}`);
  }
  if (params.reason) {
    lines.push(`• Motivo: ${params.reason}`);
  }
  if (params.customNote && params.customNote.trim()) {
    lines.push(`• Detalhes: ${params.customNote.trim()}`);
  }
  return lines.join('\n');
}

export function buildWhatsAppSupportUrl(params: {
  userName: string;
  userVirtualLine?: string;
  userPhone?: string;
  orderCode?: string;
  orderId?: string;
  reason?: string;
  customNote?: string;
}): string {
  const message = buildSupportContactMessage(params);
  return `https://wa.me/${OFFICIAL_SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`;
}

export function buildEmailSupportUrl(params: {
  userName: string;
  userVirtualLine?: string;
  userPhone?: string;
  orderCode?: string;
  orderId?: string;
  reason?: string;
  customNote?: string;
}): string {
  const identityLine = params.userVirtualLine || params.userPhone || 'Sem Linha Virtual';
  const subjectParts = ['[Suporte ChatFi]', identityLine];
  if (params.orderCode) subjectParts.push(`Pedido ${params.orderCode}`);
  if (params.reason) subjectParts.push(params.reason);
  const subject = subjectParts.join(' · ');
  const body = buildSupportContactMessage(params);
  return `mailto:${OFFICIAL_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
