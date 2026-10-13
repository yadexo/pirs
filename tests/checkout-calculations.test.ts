import { describe, it, expect } from "vitest";
import {
  computeSubtotalCents,
  computeTaxableSubtotalCents,
  computeEligibleSubtotalCents,
  computePromoDiscountCents,
  computeRewardDiscountCents,
  computeVatCents,
  computeCreditAppliedCents,
  computeCheckoutTotals,
  type LineItem,
} from "@/lib/checkout-calculations";

const service: LineItem = { serviceId: "svc_1", productId: null, packageId: null, unitPriceCents: 10000, quantity: 1, taxable: true };
const nonTaxableProduct: LineItem = { serviceId: null, productId: "prod_1", packageId: null, unitPriceCents: 5000, quantity: 2, taxable: false };

describe("computeSubtotalCents", () => {
  it("sums unit price times quantity across items", () => {
    expect(computeSubtotalCents([service, nonTaxableProduct])).toBe(10000 + 5000 * 2);
  });

  it("returns 0 for an empty basket", () => {
    expect(computeSubtotalCents([])).toBe(0);
  });
});

describe("computeTaxableSubtotalCents", () => {
  it("excludes non-taxable items", () => {
    expect(computeTaxableSubtotalCents([service, nonTaxableProduct])).toBe(10000);
  });
});

describe("computeEligibleSubtotalCents", () => {
  it("includes every item when there is no eligibility restriction", () => {
    expect(computeEligibleSubtotalCents([service, nonTaxableProduct], [])).toBe(10000 + 10000);
  });

  it("restricts to matching service/product/package ids", () => {
    const result = computeEligibleSubtotalCents([service, nonTaxableProduct], [{ serviceId: "svc_1", productId: null, packageId: null }]);
    expect(result).toBe(10000);
  });

  it("is 0 when nothing matches the eligibility rules", () => {
    const result = computeEligibleSubtotalCents([service], [{ serviceId: "svc_other", productId: null, packageId: null }]);
    expect(result).toBe(0);
  });
});

describe("computePromoDiscountCents", () => {
  it("computes a percentage discount, rounded", () => {
    expect(computePromoDiscountCents({ discountType: "PERCENT", discountValue: 10 }, 9999)).toBe(1000); // round(999.9)
  });

  it("caps a fixed-amount discount at the eligible subtotal", () => {
    expect(computePromoDiscountCents({ discountType: "FIXED_AMOUNT", discountValue: 5000 }, 3000)).toBe(3000);
  });

  it("returns 0 when the eligible subtotal is 0", () => {
    expect(computePromoDiscountCents({ discountType: "PERCENT", discountValue: 50 }, 0)).toBe(0);
  });
});

describe("computeRewardDiscountCents", () => {
  it("applies a fixed reward amount capped at the subtotal", () => {
    expect(computeRewardDiscountCents({ rewardType: "DISCOUNT_AMOUNT", discountAmountCents: 1500, discountPercent: null }, 1000)).toBe(1000);
  });

  it("applies a percentage reward", () => {
    expect(computeRewardDiscountCents({ rewardType: "DISCOUNT_PERCENT", discountAmountCents: null, discountPercent: 20 }, 5000)).toBe(1000);
  });

  it("does not discount for free-item rewards (handled as a distinct line item)", () => {
    expect(computeRewardDiscountCents({ rewardType: "FREE_SERVICE", discountAmountCents: null, discountPercent: null }, 5000)).toBe(0);
  });
});

/**
 * Prices include VAT, so this divides the VAT out of a price rather than
 * adding it on. The number it returns is never added to any total.
 */
describe("computeVatCents", () => {
  it("takes the VAT out of the price, not on top of it", () => {
    // €121 at 21% contains €21. Adding would have given €25.41.
    expect(computeVatCents(12100, 0, 2100)).toBe(2100);
  });

  it("works on what is left after a discount", () => {
    // €100 taxable, €20 off -> €80 contains 80 * 21/121 = €13.88.
    expect(computeVatCents(10000, 2000, 2100)).toBe(1388);
  });

  it("finds no VAT in a basket a discount wiped out", () => {
    expect(computeVatCents(1000, 5000, 2100)).toBe(0);
  });

  it("finds none when the clinic's rate is zero", () => {
    expect(computeVatCents(10000, 0, 0)).toBe(0);
  });
});

describe("computeCreditAppliedCents", () => {
  it("applies the smallest of requested, available, and the order cap", () => {
    expect(computeCreditAppliedCents(5000, 3000, 10000)).toBe(3000);
    expect(computeCreditAppliedCents(5000, 10000, 2000)).toBe(2000);
    expect(computeCreditAppliedCents(1000, 10000, 10000)).toBe(1000);
  });

  it("never goes negative", () => {
    expect(computeCreditAppliedCents(-500, 1000, 1000)).toBe(0);
  });
});

describe("computeCheckoutTotals (end-to-end)", () => {
  it("combines a promo discount and account credit, and adds no tax to either", () => {
    const items: LineItem[] = [{ serviceId: "svc_1", productId: null, packageId: null, unitPriceCents: 10000, quantity: 1, taxable: true }];
    const totals = computeCheckoutTotals({
      items,
      promo: { discountType: "PERCENT", discountValue: 10, eligibility: [] },
      vatRateBasisPoints: 2100,
      requestedCreditCents: 500,
      availableCreditCents: 2000,
    });

    expect(totals.subtotalCents).toBe(10000);
    expect(totals.discountCents).toBe(1000);
    // The client pays €90, which already contains 9000 * 21/121 = €15.62 VAT.
    expect(totals.taxCents).toBe(1562);
    // Nothing is added: the bill is 10000 - 1000, less the credit.
    expect(totals.creditAppliedCents).toBe(500);
    expect(totals.totalCents).toBe(9000 - 500);
  });

  it("stacks a promo and a loyalty reward discount, and never produces a negative total", () => {
    const items: LineItem[] = [{ serviceId: "svc_1", productId: null, packageId: null, unitPriceCents: 1000, quantity: 1, taxable: true }];
    const totals = computeCheckoutTotals({
      items,
      promo: { discountType: "FIXED_AMOUNT", discountValue: 800, eligibility: [] },
      reward: { rewardType: "DISCOUNT_AMOUNT", discountAmountCents: 500, discountPercent: null },
      vatRateBasisPoints: 0,
      requestedCreditCents: 10000,
      availableCreditCents: 10000,
    });

    expect(totals.discountCents).toBe(800);
    // reward is evaluated against (subtotal - promo discount) = 200, capped there
    expect(totals.loyaltyDiscountCents).toBe(200);
    expect(totals.totalCents).toBe(0);
    expect(totals.creditAppliedCents).toBe(0); // nothing left to apply credit to
  });
});
