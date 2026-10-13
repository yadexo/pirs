/**
 * Pure checkout math — no Prisma, no session, no I/O.
 *
 * This is the clinic counter's arithmetic: promotion codes, account credit
 * and a loyalty reward on one basket. It has no caller in the app today; the
 * counter screen it was written for does not exist yet, and the client app
 * prices its own baskets in lib/actions/client-app.ts, from the catalogue and
 * lib/discounts.ts. Kept, with lib/promo-codes.ts beside it, because the rules
 * are worth more than the screen and both are tested on their own.
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

/**
 * The VAT already inside a price, not a tax to add to it.
 *
 * Consumer prices in the Netherlands are quoted including VAT: the number a
 * clinic types is the number the client pays, and the VAT is a share of it.
 * So this divides rather than multiplies — €121 at 21% contains €21, not
 * €25.41 — and nothing in checkout ever adds the result to a total. It exists
 * to answer "of which VAT" on a receipt.
 *
 * Items marked not taxable contain no VAT, which is why the taxable subtotal
 * is passed separately from the whole one.
 */
export function computeVatCents(taxableSubtotalCents: number, discountCents: number, vatRateBasisPoints: number): number {
  if (vatRateBasisPoints <= 0) return 0;
  const taxableAfterDiscount = Math.max(taxableSubtotalCents - Math.min(discountCents, taxableSubtotalCents), 0);
  return Math.round((taxableAfterDiscount * vatRateBasisPoints) / (10000 + vatRateBasisPoints));
}

export function computeCreditAppliedCents(requestedCents: number, availableCents: number, capCents: number): number {
  return Math.max(0, Math.min(requestedCents, availableCents, capCents));
}

export interface CheckoutTotals {
  subtotalCents: number;
  discountCents: number;
  loyaltyDiscountCents: number;
  /** The VAT contained in what is being charged — never added to it. */
  taxCents: number;
  creditAppliedCents: number;
  totalCents: number;
}

export function computeCheckoutTotals(params: {
  items: LineItem[];
  promo?: { discountType: "PERCENT" | "FIXED_AMOUNT"; discountValue: number; eligibility: EligibilityRule[] };
  reward?: { rewardType: string; discountAmountCents: number | null; discountPercent: number | null };
  vatRateBasisPoints: number;
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
  // Shown on the receipt, and that is all. The client pays the price.
  const taxCents = computeVatCents(taxableSubtotalCents, totalDiscountCents, params.vatRateBasisPoints);

  const preCreditTotal = Math.max(subtotalCents - totalDiscountCents, 0);
  const creditAppliedCents = computeCreditAppliedCents(params.requestedCreditCents, params.availableCreditCents, preCreditTotal);
  const totalCents = Math.max(preCreditTotal - creditAppliedCents, 0);

  return { subtotalCents, discountCents, loyaltyDiscountCents, taxCents, creditAppliedCents, totalCents };
}
