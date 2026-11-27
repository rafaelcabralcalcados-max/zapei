import type { CommercialMode, SupportTicketReason } from '../types/zapei';

export const OFFICIAL_SUPPORT_UID = 'chatfi_suporte_oficial';
export const OFFICIAL_SUPPORT_VIRTUAL_LINE = 'CFI-6178-2601';
export const OFFICIAL_SUPPORT_NAME = 'Suporte Oficial ChatFi';
export const OFFICIAL_SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() ||
  'suporte.chatfi@gmail.com';

export const SUPPORT_ADMIN_EMAILS = [
  'suporte.chatfi@gmail.com',
  'rafaelcabralrobo@gmail.com',
];

export function isSupportAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return SUPPORT_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export const SUPPORT_TICKET_REASONS: SupportTicketReason[] = [
  'Problema com Pagamento / Pix',
  'Dúvida sobre Pedido',
  'Configuração de Wallet ID Asaas',
  'Ocorrência de Entrega / Má-fé',
  'Recurso / Liberação Comercial',
  'Denúncia / Segurança',
  'Outros',
];

export const DELIVERY_REPORT_REASONS: string[] = [
  'Pedido não despachado após confirmação',
  'Comprovante ou rastreio divergente',
  'Mercadoria não entregue / descumprimento de envio',
  'Recusa injustificada após pagamento confirmado',
  'Outro descumprimento na entrega',
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
    label: 'Anunciantes / Fabricantes',
    subtitle: 'Anúncios por categoria, estoque, entregas e recebimento',
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
    {
      id: 'buyer-rating-report',
      question: 'Como avaliar uma loja ou registrar ocorrência na entrega?',
      answer:
        'Assim que um pedido é despachado ou concluído, você pode dar de 1 a 5 estrelas e comentar sua experiência. Se houver descumprimento no envio ou má-fé na entrega, use "Registrar ocorrência na entrega" vinculado ao pedido para análise do suporte.',
      steps: [
        'Abra Meus Pedidos dentro da vitrine da loja e localize o pedido.',
        'Toque em "Avaliar Loja (Estrelas)" após o despacho ou confirmação de recebimento.',
        'Em caso de não entrega, toque em "Registrar ocorrência na entrega" para acionar a análise vinculada ao pedido.',
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
    {
      id: 'reseller-cpf-compliance',
      question: 'Por que o CPF é obrigatório para revender e como funciona a análise comercial?',
      answer:
        'Para manter a segurança das transações e a reputação das vitrines, o modo Revendedor exige validação única de CPF. Caso haja restrição comercial por ocorrência na entrega, apenas os modos comerciais ficam suspensos — suas conversas, chamadas e compras pessoais seguem funcionando normalmente, e você pode solicitar revisão pelo suporte.',
    },
  ],
  manufacturer: [
    {
      id: 'mfg-catalog',
      question: 'Como criar anúncios de diferentes categorias no ChatFi?',
      answer:
        'No Painel do Anunciante → Meus Anúncios → Criar Novo Anúncio, você escolhe primeiro a categoria (Calçados, Roupas, Veículos/Motos, Eletrônicos, Casa ou Geral) e o formulário exibe apenas os campos relevantes para o seu item.',
      steps: [
        'Escolha a categoria principal e, quando aplicável, a subcategoria e o público (ex.: Infantil ou Adulto).',
        'Preencha os atributos exibidos para aquela categoria (grade de numerações em calçados, tamanhos em roupas, marca/modelo/ano/cor em veículos ou condição e entrega nas demais categorias).',
        'Envie uma foto real, informe preço e quantidade disponível e publique — você também pode editar qualquer anúncio quando precisar.',
      ],
    },
    {
      id: 'mfg-stock',
      question: 'Como confirmar estoque e enviar o comprovante de despacho?',
      answer:
        'Todos os pedidos recebidos aparecem na aba Conferência do Painel do Anunciante. Após confirmar os itens disponíveis, acompanhe os dados de entrega/retirada ou transportadora para despachar e anexar o comprovante.',
      steps: [
        'Abra a aba Conferência e marque cada item como "Disponível" ou "Esgotado".',
        'Clique em "Confirmar Conferência e Baixar Estoque" para atualizar o estoque em tempo real.',
        'Na aba Despacho, confira os dados informados, anexe a foto/observação do comprovante e confirme o envio.',
      ],
    },
    {
      id: 'mfg-split',
      question: 'Como receber o valor das minhas vendas via Split Asaas?',
      answer:
        'Cadastre seu Wallet ID Asaas no topo do Painel do Anunciante (ou em Ajustes). Assim que o comprador finaliza o pagamento da cobrança Asaas, seu valor líquido é creditado automaticamente via Split.',
      steps: [
        'Acesse asaas.com → Configurações da Conta → Integrações e copie seu Wallet ID.',
        'Cole no campo "Wallet ID Asaas (Recebimento Split)" no Painel do Anunciante e salve.',
        'Acompanhe o extrato líquido de cada pedido e o status da cobrança na aba Financeiro.',
      ],
    },
    {
      id: 'mfg-cpf-compliance',
      question: 'Como funcionam o CPF obrigatório, as estrelas e a revisão comercial?',
      answer:
        'Para atuar como Anunciante / Fabricante no ChatFi, é necessário validar seu CPF uma única vez. Compradores e revendedores avaliam sua entrega (1 a 5 estrelas), exibindo sua média no perfil. Em eventual suspensão comercial por má-fé na entrega, seu uso pessoal do mensageiro não é afetado e o suporte realiza a apuração para reativação.',
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
