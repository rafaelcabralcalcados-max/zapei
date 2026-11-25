import type {
  AsaasSplitEntry,
  OrderSplitBreakdown,
  SplitPaymentMethod,
  SubOrderSplitItem,
} from '../types/zapei';

/**
 * ChatFi Payment Split & Asaas Fee Constants
 *
 * 1) Platform commission: 8.5% over total order value.
 *    Minimum guaranteed net return for ChatFi: R$ 5.00.
 *    On Pix: automatically adds Asaas gateway fee (R$ 1.99),
 *    resulting in a gross floor of R$ 6.99 for orders below R$ 82.25.
 * 2) Credit Card (1x..12x): passes all card processing MDR + fixed fee + installment
 *    interest 100% through to the final buyer via gross-up, preserving the net
 *    amounts for Manufacturer, Reseller, and ChatFi's 8.5% (min R$ 5.00).
 */
export const CHATFI_COMMISSION_RATE = 0.085;
export const CHATFI_MIN_NET_BRL = 5.0;
export const PIX_GATEWAY_FEE_BRL = 1.99;
export const PIX_MIN_GROSS_BRL = 6.99;
export const MINIMUM_FEE_THRESHOLD_BRL = 82.25;
export const CARD_MIN_THRESHOLD_BRL = 58.83;

export const CARD_FIXED_FEE_BRL = 0.49;
export const CARD_INSTALLMENT_MONTHLY_RATE = 0.0149;

export function roundBRL(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getAsaasCreditCardRates(rawInstallments: number): {
  installments: number;
  baseMdrRate: number;
  installmentInterestRate: number;
  totalPercentRate: number;
  fixedFee: number;
} {
  const installments = Math.min(12, Math.max(1, Math.round(rawInstallments || 1)));
  const baseMdrRate =
    installments === 1 ? 0.0299 : installments <= 6 ? 0.0349 : 0.0399;
  const installmentInterestRate =
    installments === 1 ? 0 : Number(((installments - 1) * CARD_INSTALLMENT_MONTHLY_RATE).toFixed(4));
  const totalPercentRate = Number((baseMdrRate + installmentInterestRate).toFixed(4));
  return {
    installments,
    baseMdrRate,
    installmentInterestRate,
    totalPercentRate,
    fixedFee: CARD_FIXED_FEE_BRL,
  };
}

export interface CalculateSplitInput {
  orderTotal: number;
  factoryCostTotal: number;
  paymentMethod: SplitPaymentMethod;
  installments?: number;
  isDirectManufacturerSale?: boolean;
  subOrders?: Array<{
    id: string;
    subOrderCode: string;
    factoryId: string;
    factoryName: string;
    factoryCost: number;
  }>;
}

export function calculateOrderSplit(input: CalculateSplitInput): OrderSplitBreakdown {
  const orderTotal = roundBRL(Math.max(0, input.orderTotal));
  const factoryCostTotal = roundBRL(Math.max(0, Math.min(orderTotal, input.factoryCostTotal)));
  const paymentMethod: SplitPaymentMethod =
    input.paymentMethod === 'credit_card' ? 'credit_card' : 'pix';
  const cardRates = getAsaasCreditCardRates(
    paymentMethod === 'credit_card' ? input.installments ?? 1 : 1
  );
  const installments = paymentMethod === 'credit_card' ? cardRates.installments : 1;

  const isDirectManufacturerSale =
    Boolean(input.isDirectManufacturerSale) ||
    (orderTotal > 0 && Math.abs(orderTotal - factoryCostTotal) < 0.01);

  const rawCommission85 = roundBRL(orderTotal * CHATFI_COMMISSION_RATE);
  const belowPixMinThreshold = orderTotal > 0 && orderTotal < MINIMUM_FEE_THRESHOLD_BRL;

  let gatewayFee = 0;
  let platformGrossFee = 0;
  let platformNetFee = 0;
  let minimumRuleApplied = false;
  let buyerChargedTotal = orderTotal;
  let cardFeePassedToBuyer = 0;

  if (orderTotal > 0) {
    if (paymentMethod === 'pix') {
      gatewayFee = PIX_GATEWAY_FEE_BRL;
      minimumRuleApplied = belowPixMinThreshold;
      const targetGross = minimumRuleApplied
        ? PIX_MIN_GROSS_BRL
        : Math.max(PIX_MIN_GROSS_BRL, rawCommission85);
      platformGrossFee = roundBRL(Math.min(orderTotal, targetGross));
      platformNetFee = roundBRL(Math.max(0, platformGrossFee - gatewayFee));
      buyerChargedTotal = orderTotal;
      cardFeePassedToBuyer = 0;
    } else {
      minimumRuleApplied = rawCommission85 < CHATFI_MIN_NET_BRL;
      platformNetFee = roundBRL(Math.min(orderTotal, Math.max(CHATFI_MIN_NET_BRL, rawCommission85)));
      platformGrossFee = platformNetFee;
      // Gross-up so that after Asaas deducts MDR + installment anticipation + fixed R$ 0.49,
      // the remaining net equals exact orderTotal (preserving Manufacturer, Reseller, and ChatFi).
      buyerChargedTotal = roundBRL(
        (orderTotal + cardRates.fixedFee) / (1 - cardRates.totalPercentRate)
      );
      cardFeePassedToBuyer = roundBRL(Math.max(0, buyerChargedTotal - orderTotal));
      gatewayFee = cardFeePassedToBuyer;
    }
  }

  const installmentValue =
    installments > 0 ? roundBRL(buyerChargedTotal / installments) : buyerChargedTotal;

  const distributableToSellers = roundBRL(Math.max(0, orderTotal - platformGrossFee));

  let factoryNetTotal = 0;
  let resellerNetTotal = 0;

  if (orderTotal > 0) {
    if (isDirectManufacturerSale) {
      factoryNetTotal = distributableToSellers;
      resellerNetTotal = 0;
    } else {
      const factoryRatio = factoryCostTotal / orderTotal;
      factoryNetTotal = roundBRL(distributableToSellers * factoryRatio);
      resellerNetTotal = roundBRL(Math.max(0, distributableToSellers - factoryNetTotal));
    }
  }

  const subOrdersInput = input.subOrders && input.subOrders.length > 0 ? input.subOrders : [];
  const subOrderSplits: SubOrderSplitItem[] = [];

  if (subOrdersInput.length > 0) {
    const sumSubCost = subOrdersInput.reduce((acc, s) => acc + Math.max(0, s.factoryCost), 0);
    let allocatedFactoryNet = 0;

    subOrdersInput.forEach((sub, idx) => {
      const isLast = idx === subOrdersInput.length - 1;
      let netAmount = 0;
      if (isLast) {
        netAmount = roundBRL(Math.max(0, factoryNetTotal - allocatedFactoryNet));
      } else if (sumSubCost > 0) {
        netAmount = roundBRL((Math.max(0, sub.factoryCost) / sumSubCost) * factoryNetTotal);
      } else {
        netAmount = roundBRL(factoryNetTotal / subOrdersInput.length);
      }
      allocatedFactoryNet = roundBRL(allocatedFactoryNet + netAmount);
      subOrderSplits.push({
        subOrderId: sub.id,
        subOrderCode: sub.subOrderCode,
        factoryId: sub.factoryId,
        factoryName: sub.factoryName,
        grossFactoryCost: roundBRL(sub.factoryCost),
        factoryNetAmount: netAmount,
      });
    });
  }

  const effectivePlatformRatePct =
    orderTotal > 0 ? roundBRL((platformGrossFee / orderTotal) * 100) : 0;

  return {
    orderTotal,
    factoryCostTotal,
    paymentMethod,
    installments,
    isDirectManufacturerSale,
    rawCommission85,
    minimumRuleApplied,
    belowPixMinThreshold,
    gatewayFee,
    platformGrossFee,
    platformNetFee,
    buyerChargedTotal,
    cardFeePassedToBuyer,
    cardBaseMdrRate: paymentMethod === 'credit_card' ? cardRates.baseMdrRate : 0,
    cardInstallmentInterestRate:
      paymentMethod === 'credit_card' ? cardRates.installmentInterestRate : 0,
    cardFixedFee: paymentMethod === 'credit_card' ? cardRates.fixedFee : 0,
    installmentValue,
    distributableToSellers,
    factoryNetTotal,
    resellerNetTotal,
    effectivePlatformRatePct,
    subOrderSplits,
  };
}

export function buildAsaasSplitEntries(params: {
  breakdown: OrderSplitBreakdown;
  resellerId: string;
  resellerName: string;
  resellerWalletId?: string;
  factoryWalletMap: Record<string, string | undefined>;
  platformWalletId?: string;
  includePlatformWalletInSplitArray?: boolean;
}): {
  asaasApiSplits: Array<{ walletId: string; fixedValue: number }>;
  detailedSplits: AsaasSplitEntry[];
  missingWallets: Array<{ role: 'manufacturer' | 'reseller'; uid: string; label: string }>;
} {
  const { breakdown, resellerId, resellerName, resellerWalletId, factoryWalletMap } = params;
  const asaasApiSplits: Array<{ walletId: string; fixedValue: number }> = [];
  const detailedSplits: AsaasSplitEntry[] = [];
  const missingWallets: Array<{ role: 'manufacturer' | 'reseller'; uid: string; label: string }> = [];

  // Aggregate by factoryId in case multiple sub-orders belong to the same manufacturer
  const byFactory = new Map<
    string,
    { factoryId: string; factoryName: string; netAmount: number }
  >();
  for (const sub of breakdown.subOrderSplits) {
    const existing = byFactory.get(sub.factoryId);
    if (existing) {
      existing.netAmount = roundBRL(existing.netAmount + sub.factoryNetAmount);
    } else {
      byFactory.set(sub.factoryId, {
        factoryId: sub.factoryId,
        factoryName: sub.factoryName,
        netAmount: sub.factoryNetAmount,
      });
    }
  }

  byFactory.forEach((entry) => {
    if (entry.netAmount <= 0) return;
    const walletId = (factoryWalletMap[entry.factoryId] || '').trim();
    if (!walletId) {
      missingWallets.push({
        role: 'manufacturer',
        uid: entry.factoryId,
        label: entry.factoryName || 'Fabricante',
      });
    }
    const resolvedWallet = walletId || `PENDING_FACTORY_WALLET_${entry.factoryId.slice(0, 8)}`;
    asaasApiSplits.push({
      walletId: resolvedWallet,
      fixedValue: entry.netAmount,
    });
    detailedSplits.push({
      walletId: resolvedWallet,
      fixedValue: entry.netAmount,
      role: 'manufacturer',
      recipientUid: entry.factoryId,
      recipientLabel: entry.factoryName,
    });
  });

  if (breakdown.resellerNetTotal > 0 && !breakdown.isDirectManufacturerSale) {
    const walletId = (resellerWalletId || '').trim();
    if (!walletId) {
      missingWallets.push({
        role: 'reseller',
        uid: resellerId,
        label: resellerName || 'Revendedor',
      });
    }
    const resolvedWallet = walletId || `PENDING_RESELLER_WALLET_${resellerId.slice(0, 8)}`;
    asaasApiSplits.push({
      walletId: resolvedWallet,
      fixedValue: breakdown.resellerNetTotal,
    });
    detailedSplits.push({
      walletId: resolvedWallet,
      fixedValue: breakdown.resellerNetTotal,
      role: 'reseller',
      recipientUid: resellerId,
      recipientLabel: resellerName,
    });
  }

  const platformWallet = (params.platformWalletId || '').trim() || 'CHATFI_MAIN_ACCOUNT';
  detailedSplits.push({
    walletId: platformWallet,
    fixedValue: breakdown.platformGrossFee,
    role: 'platform',
    recipientLabel: 'Plataforma ChatFi',
  });

  if (params.includePlatformWalletInSplitArray && params.platformWalletId?.trim()) {
    asaasApiSplits.push({
      walletId: params.platformWalletId.trim(),
      fixedValue: breakdown.platformGrossFee,
    });
  }

  return {
    asaasApiSplits,
    detailedSplits,
    missingWallets,
  };
}
