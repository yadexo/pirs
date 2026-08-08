/**
 * Pure checkout math — no Prisma, no session, no I/O. Kept separate from
 * lib/actions/checkout.ts so it can be unit tested directly and reused
 * anywhere totals need recomputing (e.g. webhooks, admin tools).
 */

export interface LineItem {
  serviceId: string | null;
  productId: string | null;
  packageId: string | null;
  unitPriceCents: number;
  quantity: number;
  taxable: boolean;
}

export interface EligibilityRule {
  serviceId: string | null;
  productId: string | null;
  packageId: string | null;
}

export function computeSubtotalCents(items: Pick<LineItem, "unitPriceCents" | "quantity">[]): number {
  return items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

export function computeTaxableSubtotalCents(items: LineItem[]): number {
  return items.filter((i) => i.taxable).reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

export function computeEligibleSubtotalCents(items: LineItem[], eligibility: EligibilityRule[]): number {
  const scoped =
    eligibility.length === 0
      ? items
      : items.filter((i) =>
          eligibility.some(
            (e) =>
              (e.serviceId && e.serviceId === i.serviceId) ||
              (e.productId && e.productId === i.productId) ||
              (e.packageId && e.packageId === i.packageId),
          ),
        );
  return computeSubtotalCents(scoped);
}

export function computePromoDiscountCents(
  promo: { discountType: "PERCENT" | "FIXED_AMOUNT"; discountValue: number },
  eligibleSubtotalCents: number,
): number {
  if (eligibleSubtotalCents <= 0) return 0;
  if (promo.discountType === "PERCENT") return Math.round((eligibleSubtotalCents * promo.discountValue) / 100);
  return Math.min(promo.discountValue, eligibleSubtotalCents);
}

export function computeRewardDiscountCents(
  reward: { rewardType: string; discountAmountCents: number | null; discountPercent: number | null },
  eligibleSubtotalCents: number,
): number {
  if (eligibleSubtotalCents <= 0) return 0;
  if (reward.rewardType === "DISCOUNT_AMOUNT") return Math.min(reward.discountAmountCents ?? 0, eligibleSubtotalCents);
  if (reward.rewardType === "DISCOUNT_PERCENT") return Math.round((eligibleSubtotalCents * (reward.discountPercent ?? 0)) / 100);
  return 0; // FREE_SERVICE / FREE_PRODUCT are redeemed as a distinct line item, not a discount
}

export function computeTaxCents(taxableSubtotalCents: number, discountCents: number, taxRateBasisPoints: number): number {
  const taxableAfterDiscount = Math.max(taxableSubtotalCents - Math.min(discountCents, taxableSubtotalCents), 0);
  return Math.round((taxableAfterDiscount * taxRateBasisPoints) / 10000);
}

export function computeCreditAppliedCents(requestedCents: number, availableCents: number, capCents: number): number {
  return Math.max(0, Math.min(requestedCents, availableCents, capCents));
}

export interface CheckoutTotals {
  subtotalCents: number;
  discountCents: number;
  loyaltyDiscountCents: number;
  taxCents: number;
  creditAppliedCents: number;
  totalCents: number;
}

export function computeCheckoutTotals(params: {
  items: LineItem[];
  promo?: { discountType: "PERCENT" | "FIXED_AMOUNT"; discountValue: number; eligibility: EligibilityRule[] };
  reward?: { rewardType: string; discountAmountCents: number | null; discountPercent: number | null };
  taxRateBasisPoints: number;
  requestedCreditCents: number;
  availableCreditCents: number;
}): CheckoutTotals {
  const subtotalCents = computeSubtotalCents(params.items);
  const taxableSubtotalCents = computeTaxableSubtotalCents(params.items);

  const discountCents = params.promo
    ? computePromoDiscountCents(params.promo, computeEligibleSubtotalCents(params.items, params.promo.eligibility))
    : 0;
  const loyaltyDiscountCents = params.reward
    ? computeRewardDiscountCents(params.reward, subtotalCents - discountCents)
    : 0;

  const totalDiscountCents = discountCents + loyaltyDiscountCents;
  const taxCents = computeTaxCents(taxableSubtotalCents, totalDiscountCents, params.taxRateBasisPoints);

  const preCreditTotal = Math.max(subtotalCents - totalDiscountCents + taxCents, 0);
  const creditAppliedCents = computeCreditAppliedCents(params.requestedCreditCents, params.availableCreditCents, preCreditTotal);
  const totalCents = Math.max(preCreditTotal - creditAppliedCents, 0);

  return { subtotalCents, discountCents, loyaltyDiscountCents, taxCents, creditAppliedCents, totalCents };
}
