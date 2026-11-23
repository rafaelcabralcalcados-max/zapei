export type ProductCategory = 'Calçados' | 'Bolsas' | 'Sapatos' | 'Joias' | 'Acessórios';

export type CommercialMode = 'buyer' | 'manufacturer' | 'reseller';

export type SubscriptionStatus = 'free' | 'trial' | 'active' | 'expired';

export type PaymentMethod = 'À vista' | 'Cartão' | 'Cheque' | 'Notinha';

export type PaymentStatus = 'Aguardando' | 'Parcial' | 'Quitado' | 'Em Atraso';

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
  factoryPrice: number;
  stockBoxes: number;
  gradeRaw: string;
  imageUrl: string;
  isSoldOutToday: boolean;
  moderationStatus: 'approved' | 'flagged';
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
  margins: Record<ProductCategory, CategoryMargin>;
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
  method: PaymentMethod;
  status: PaymentStatus;
  dueDate: string;
  lastReminderSent?: string;
}

export interface UserProfile {
  uid: string;
  name: string;
  initials: string;
  phone: string;
  phoneHash: string;
  virtualLine?: string;
  authMethod?: 'phone' | 'cpf';
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
  factoryPolicy: MinimumDeliveryPolicy;
  favoriteGrades: FavoriteGrade[];
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

