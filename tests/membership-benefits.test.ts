import { describe, it, expect } from "vitest";
import { bestDiscount, discountFor, lineQualifies, membershipCandidates, type BasketLine, type DiscountCandidate } from "@/lib/discounts";
import { creditToApply } from "@/lib/account-credit";

/**
 * What a membership is worth on a basket, and what happens when a promotion
 * wants the same basket.
 *
 * They never add up. A client gets the single best discount available to
 * them — the member price or the promotion, whichever leaves them paying
 * less — so a clinic can run a sale without accidentally giving members the
 * sale price on top of their own.
 */
describe("a plan's discounts on a basket", () => {
  const plan = (service: number | null, product: number | null) => ({
    membershipPlan: { id: "plan_1", name: "Glow Monthly", serviceDiscountPercent: service, productDiscountPercent: product },
  });

  const facial: BasketLine = { kind: "SERVICE", id: "svc_1", categoryId: "cat_s", unitPriceCents: 10_000, quantity: 1 };
  const cream: BasketLine = { kind: "PRODUCT", id: "prd_1", categoryId: "cat_p", unitPriceCents: 2_000, quantity: 1 };

  const promotion = (percent: number, over?: { minOrderCents: number }): DiscountCandidate => ({
    id: "promo_1",
    title: "Spring sale",
    discountType: "PERCENT",
    discountValue: percent,
    minOrderCents: over?.minOrderCents ?? null,
    perCustomerLimit: null,
    usageLimit: null,
    eligibility: [],
  });

  it("makes one candidate per rate the plan sets", () => {
    expect(membershipCandidates(plan(10, 5))).toHaveLength(2);
    expect(membershipCandidates(plan(10, null))).toHaveLength(1);
    expect(membershipCandidates(plan(null, null))).toHaveLength(0);
    // Zero is not a discount, so it is not offered as one.
    expect(membershipCandidates(plan(0, 0))).toHaveLength(0);
  });

  it("keeps the treatment rate off the shelf, and the shelf rate off treatments", () => {
    const [services] = membershipCandidates(plan(10, null));
    expect(lineQualifies(facial, services!)).toBe(true);
    expect(lineQualifies(cream, services!)).toBe(false);

    const [products] = membershipCandidates(plan(null, 5));
    expect(lineQualifies(cream, products!)).toBe(true);
    expect(lineQualifies(facial, products!)).toBe(false);
  });

  it("takes its percentage off the lines it covers and no others", () => {
    const [services] = membershipCandidates(plan(10, null));
    // 10% of the €100 treatment; the €20 cream is untouched.
    expect(discountFor([facial, cream], services!)).toMatchObject({ discountCents: 1_000, source: "MEMBERSHIP" });
  });

  it("has no promotion behind it, so nothing is marked as redeemed", () => {
    const [services] = membershipCandidates(plan(10, null));
    const applied = discountFor([facial], services!);
    // A membership benefit is not a coupon: there is no PromotionRedemption to
    // write, and no limit to count against.
    expect(applied?.promotionId).toBeNull();
    expect(services!.usageLimit).toBeNull();
    expect(services!.perCustomerLimit).toBeNull();
  });

  it("gives the member their plan's price when it beats the promotion", () => {
    const member = membershipCandidates(plan(20, null));
    const best = bestDiscount([facial], [promotion(5), ...member]);
    expect(best).toMatchObject({ source: "MEMBERSHIP", discountCents: 2_000 });
  });

  it("gives the promotion when that beats the plan", () => {
    const member = membershipCandidates(plan(10, null));
    const best = bestDiscount([facial], [promotion(30), ...member]);
    expect(best).toMatchObject({ source: "PROMOTION", promotionId: "promo_1", discountCents: 3_000 });
  });

  it("never adds the two together", () => {
    const member = membershipCandidates(plan(10, 10));
    const best = bestDiscount([facial, cream], [promotion(10), ...member]);
    // 10% of the whole €120 basket from the promotion beats 10% of either
    // part — and the answer is one discount, not the sum of several.
    expect(best!.discountCents).toBe(1_200);
  });

  it("still applies the member price when a promotion needs a bigger basket", () => {
    const member = membershipCandidates(plan(10, null));
    const best = bestDiscount([facial], [promotion(50, { minOrderCents: 50_000 }), ...member]);
    expect(best).toMatchObject({ source: "MEMBERSHIP", discountCents: 1_000 });
  });
});

describe("how much credit an order takes", () => {
  it("takes nothing when the client didn't ask", () => {
    expect(creditToApply({ requestedUse: false, availableCents: 5_000, totalCents: 3_000 })).toBe(0);
  });

  it("takes what the client has when the bill is larger", () => {
    expect(creditToApply({ requestedUse: true, availableCents: 2_000, totalCents: 5_000 })).toBe(2_000);
  });

  it("takes only the bill when the client has more than enough", () => {
    expect(creditToApply({ requestedUse: true, availableCents: 9_000, totalCents: 4_000 })).toBe(4_000);
  });

  it("never goes negative on an empty balance or a free order", () => {
    expect(creditToApply({ requestedUse: true, availableCents: 0, totalCents: 5_000 })).toBe(0);
    expect(creditToApply({ requestedUse: true, availableCents: 5_000, totalCents: 0 })).toBe(0);
  });
});
