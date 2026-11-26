export type MainProductCategory =
  | 'Calçados & Acessórios'
  | 'Moda Íntima & Lingerie'
  | 'Vestuário & Confecção'
  | 'Automóveis & Veículos'
  | 'Imóveis & Casas'
  | 'Eletrônicos & Celulares'
  | 'Casa, Móveis & Decoração'
  | 'Beleza, Perfumaria & Saúde'
  | 'Ferramentas, Construção & Agro'
  | 'Alimentos, Bebidas & Outros';

export type LegacyProductCategory =
  | 'Calçados'
  | 'Bolsas'
  | 'Sapatos'
  | 'Joias'
  | 'Acessórios';

export type ProductCategory = MainProductCategory | LegacyProductCategory;

export type ProductUnitType = 'par' | 'unidade' | 'kit';

export type CommercialMode = 'buyer' | 'manufacturer' | 'reseller';

export type SubscriptionStatus = 'free' | 'trial' | 'active' | 'expired';

export type PaymentMethod = 'À vista' | 'Cartão' | 'Cheque' | 'Notinha';

export type PaymentStatus = 'Aguardando' | 'Parcial' | 'Quitado' | 'Em Atraso' | 'Cancelado';

export type LogisticsType = 'none' | 'transportadora' | 'distribuidora';

export type OrderStatus =
  | 'pending_inquiry'
  | 'checking_stock'
  | 'partial_confirmed'
  | 'confirmed'
  | 'logistics_sent'
  | 'dispatched'
  | 'completed'
  | 'cancelled';

export interface GradeItem {
  size: string;
  pairs: number;
}

export interface FavoriteGrade {
  id: string;
  label: string;
  raw: string;
}

export interface MinimumDeliveryPolicy {
  type: 'boxes' | 'pieces' | 'amount';
  value: number;
  allowCounterPickup: boolean;
  label: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  phoneHash: string;
  initials: string;
  avatarBg: string;
  onZapei: boolean;
  matchedUid?: string;
  role: 'normal' | 'reseller' | 'manufacturer';
  hasStorefront: boolean;
  storefrontName?: string;
  deliveryPolicyLabel?: string;
  invited: boolean;
}

export interface ChatThreadSummary {
  id: string;
  userA: string;
  userB: string;
  userAName: string;
  userBName: string;
  otherUid: string;
  otherName: string;
  lastMessage: string;
  lastSenderId?: string;
  updatedAtLabel: string;
  updatedAtMs: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  type: 'text' | 'audio' | 'image' | 'video' | 'order_card' | 'billing_reminder';
  text: string;
  timestamp: string;
  mediaUrl?: string;
  audioDuration?: string;
  videoDuration?: string;
  mediaTransitPath?: string;
  mediaDelivered?: boolean;
  mediaSizeBytes?: number;
  mediaMimeType?: string;
  mediaExpiresAtMs?: number;
  orderId?: string;
  orderCode?: string;
  orderSummary?: string;
  orderTotal?: number;
  orderStatusLabel?: string;
  deliveryStatus?: 'pending' | 'sending' | 'sent' | 'delivered';
  viaMesh?: boolean;
  hops?: number;
}

export interface CallSessionRecord {
  id: string;
  callerId: string;
  callerName: string;
  callerInitials: string;
  callerAvatarColor: string;
  calleeId: string;
  calleeName: string;
  calleeInitials: string;
  calleeAvatarColor: string;
  callType: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'declined' | 'missed';
  offerSdp?: string;
  answerSdp?: string;
  durationLabel?: string;
  timestamp: string;
  createdAtMs: number;
}

export interface Product {
  id: string;
  factoryId: string;
  factoryName: string;
  name: string;
  sku: string;
  category: ProductCategory;
  subcategory?: string;
  unitType?: ProductUnitType;
  quantityPerPack?: number;
  packLabel?: string;
  specsSummary?: string;
  factoryPrice: number;
  stockBoxes: number;
  gradeRaw: string;
  imageUrl: string;
  isSoldOutToday: boolean;
  moderationStatus: 'approved' | 'flagged';
  lastStockOrderId?: string;
  createdAt: string;
}

export interface CategoryMargin {
  mode: 'fixed' | 'percent';
  value: number;
}

export interface FactoryConnection {
  id: string;
  resellerId: string;
  factoryId: string;
  factoryName: string;
  deliveryPolicy: MinimumDeliveryPolicy;
  reviewPhotos: boolean;
  paused: boolean;
  margins: Record<string, CategoryMargin>;
  approvedProductIds: string[];
  rejectedProductIds: string[];
}

export interface CartItem {
  productId: string;
  factoryId: string;
  boxes: number;
}

export interface SubOrderLineItem {
  id: string;
  productId: string;
  productName: string;
  category: ProductCategory;
  imageUrl: string;
  gradeRaw: string;
  boxesRequested: number;
  unitFactoryPrice: number;
  unitBuyerPrice: number;
  availability: 'pending' | 'available' | 'unavailable';
}

export interface SubOrder {
  id: string;
  parentOrderId: string;
  subOrderCode: string;
  factoryId: string;
  factoryName: string;
  resellerId: string;
  buyerId: string;
  anonymousGroupLabel: string;
  deliveryPolicyLabel: string;
  items: SubOrderLineItem[];
  status: OrderStatus;
  factoryCost: number;
  buyerSubtotal: number;
  logisticsType: LogisticsType;
  logisticsCompany: string;
  logisticsAddress: string;
  receiptNote?: string;
  receiptUrl?: string;
  receiptAttached?: boolean;
  updatedAt: string;
}

export type SplitPaymentMethod = 'pix' | 'credit_card';

export interface AsaasSplitEntry {
  walletId: string;
  fixedValue: number;
  role?: 'manufacturer' | 'reseller' | 'platform';
  recipientUid?: string;
  recipientLabel?: string;
}

export interface SubOrderSplitItem {
  subOrderId: string;
  subOrderCode: string;
  factoryId: string;
  factoryName: string;
  grossFactoryCost: number;
  factoryNetAmount: number;
}

export interface OrderSplitBreakdown {
  orderTotal: number;
  factoryCostTotal: number;
  paymentMethod: SplitPaymentMethod;
  installments: number;
  isDirectManufacturerSale: boolean;
  rawCommission85: number;
  minimumRuleApplied: boolean;
  belowPixMinThreshold: boolean;
  gatewayFee: number;
  platformGrossFee: number;
  platformNetFee: number;
  buyerChargedTotal: number;
  cardFeePassedToBuyer: number;
  cardBaseMdrRate: number;
  cardInstallmentInterestRate: number;
  cardFixedFee: number;
  installmentValue: number;
  distributableToSellers: number;
  factoryNetTotal: number;
  resellerNetTotal: number;
  effectivePlatformRatePct: number;
  subOrderSplits: SubOrderSplitItem[];
}

export interface MixedOrder {
  id: string;
  orderCode: string;
  buyerId: string;
  buyerName: string;
  resellerId: string;
  storefrontName: string;
  factoryIds: string[];
  createdAt: string;
  status: OrderStatus;
  subOrders: SubOrder[];
  discountMode: 'fixed' | 'percent';
  discountValue: number;
  discountAmount: number;
  buyerSubtotal: number;
  buyerFinalTotal: number;
  factoryCostTotal: number;
  paymentMethod?: SplitPaymentMethod;
  installments?: number;
  buyerChargedTotal?: number;
  gatewayFee?: number;
  platformFeeGross?: number;
  platformFeeNet?: number;
  minimumFeeApplied?: boolean;
  splitFactoryNet?: number;
  splitResellerNet?: number;
  asaasChargeId?: string;
  asaasChargeStatus?: string;
  asaasInvoiceUrl?: string;
  asaasPixPayload?: string;
  createdAtMs?: number;
  stockReserved?: boolean;
  stockRestored?: boolean;
  reservationExpiresAtMs?: number;
  cancelledAtMs?: number;
  cancelReason?: string;
  cancelledByUid?: string;
}

export interface DualPaymentRecord {
  id: string;
  orderId: string;
  orderCode: string;
  subOrderCode?: string;
  layer: 'factory_reseller' | 'reseller_buyer';
  ownerId: string;
  counterpartyId: string;
  buyerId?: string;
  counterpartyName: string;
  amount: number;
  costReference?: number;
  gatewayFee?: number;
  platformFeeGross?: number;
  platformFeeNet?: number;
  netAmount?: number;
  asaasChargeId?: string;
  asaasChargeStatus?: string;
  method: PaymentMethod;
  status: PaymentStatus;
  dueDate: string;
  lastReminderSent?: string;
}

export type TargetCommercialRole = 'manufacturer' | 'reseller';

export interface CommercialReview {
  id: string;
  orderId: string;
  orderCode: string;
  subOrderId?: string;
  reviewerId: string;
  reviewerName: string;
  reviewerRole: 'buyer' | 'reseller';
  targetUid: string;
  targetName: string;
  targetRole: TargetCommercialRole;
  stars: 1 | 2 | 3 | 4 | 5;
  comment: string;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
}

export type DeliveryReportStatus =
  | 'Aberto'
  | 'Em análise'
  | 'Banido'
  | 'Improcedente'
  | 'Resolvido';

export interface DeliveryReport {
  id: string;
  reportCode: string;
  orderId: string;
  orderCode: string;
  subOrderId?: string;
  subOrderCode?: string;
  ticketId?: string;
  ticketCode?: string;
  reporterId: string;
  reporterName: string;
  reporterRole: 'buyer' | 'reseller';
  reportedUid: string;
  reportedName: string;
  reportedRole: TargetCommercialRole;
  reason: string;
  description: string;
  status: DeliveryReportStatus;
  resolvedByUid?: string;
  resolutionNote?: string;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
}

export interface CommercialBanRecord {
  banKey: string;
  identifierType: 'uid' | 'cpf' | 'phone' | 'virtualLine';
  targetUid: string;
  targetName: string;
  cpfHash?: string;
  phoneHash?: string;
  virtualLineHash?: string;
  status: 'active' | 'lifted';
  reason: string;
  reportId?: string;
  ticketId?: string;
  orderCode?: string;
  bannedByUid: string;
  bannedAtMs: number;
  liftedAtMs?: number;
  liftedByUid?: string;
  liftNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  name: string;
  initials: string;
  phone: string;
  phoneHash: string;
  virtualLine?: string;
  authMethod?: 'phone' | 'cpf';
  cpfVerified?: boolean;
  email: string;
  statusMessage: string;
  isOnline?: boolean;
  lastSeenAt?: number;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  avatarBg: string;
  avatarUrl?: string;
  commercialMode: CommercialMode;
  manufacturerActivated: boolean;
  resellerActivated: boolean;
  hasStorefront: boolean;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: number;
  trialDaysLeft: number;
  storefrontName: string;
  storefrontPrivacy: 'open' | 'approved';
  factoryName: string;
  asaasWalletId?: string;
  anchorDiscountPercent?: number;
  factoryPolicy: MinimumDeliveryPolicy;
  favoriteGrades: FavoriteGrade[];
  ratingAverage?: number;
  ratingCount?: number;
  commercialBanned?: boolean;
  commercialBanReason?: string;
  commercialBanAtMs?: number;
}

export interface ConnectedDevice {
  deviceId: string;
  ownerId: string;
  deviceName: string;
  platform: string;
  primary: boolean;
  authorizedByDeviceId?: string;
  createdAtLabel: string;
  lastActiveAtLabel: string;
  createdAtMs: number;
  lastActiveAtMs: number;
}

export interface DeviceAuthRequest {
  id: string;
  uid: string;
  requestToken: string;
  code6: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedByDeviceId?: string;
  expiresAtMs: number;
  createdAtMs: number;
}

export type SupportTicketReason =
  | 'Problema com Pagamento / Pix'
  | 'Dúvida sobre Pedido'
  | 'Configuração de Wallet ID Asaas'
  | 'Ocorrência de Entrega / Má-fé'
  | 'Recurso / Liberação Comercial'
  | 'Denúncia / Segurança'
  | 'Outros';

export type SupportTicketStatus = 'Aberto' | 'Em análise' | 'Resolvido';

export interface SupportTicket {
  id: string;
  ticketCode: string;
  userId: string;
  userName: string;
  userVirtualLine?: string;
  userRole: CommercialMode;
  reason: SupportTicketReason;
  orderId?: string;
  orderCode?: string;
  description: string;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
}

