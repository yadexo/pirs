import { describe, it, expect } from "vitest";
import {
  computeSubtotalCents,
  computeTaxableSubtotalCents,
  computeEligibleSubtotalCents,
  computePromoDiscountCents,
  computeRewardDiscountCents,
  computeTaxCents,
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

describe("computeTaxCents", () => {
  it("applies the tax rate only to the taxable amount remaining after discount", () => {
    // $100 taxable subtotal, $20 discount -> $80 taxed at 8% (800 bps) = $6.40
    expect(computeTaxCents(10000, 2000, 800)).toBe(640);
  });

  it("never taxes more than the taxable subtotal even if discount exceeds it", () => {
    expect(computeTaxCents(1000, 5000, 1000)).toBe(0);
  });

  it("returns 0 when the tax rate is 0", () => {
    expect(computeTaxCents(10000, 0, 0)).toBe(0);
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
  it("combines promo discount, tax, and account credit correctly", () => {
    const items: LineItem[] = [{ serviceId: "svc_1", productId: null, packageId: null, unitPriceCents: 10000, quantity: 1, taxable: true }];
    const totals = computeCheckoutTotals({
      items,
      promo: { discountType: "PERCENT", discountValue: 10, eligibility: [] },
      taxRateBasisPoints: 800, // 8%
      requestedCreditCents: 500,
      availableCreditCents: 2000,
    });

    // subtotal 10000, discount 1000 -> taxable 9000 * 8% = 720 tax
    expect(totals.subtotalCents).toBe(10000);
    expect(totals.discountCents).toBe(1000);
    expect(totals.taxCents).toBe(720);
    // pre-credit total = 10000 - 1000 + 720 = 9720; credit applied = min(500, 2000, 9720) = 500
    expect(totals.creditAppliedCents).toBe(500);
    expect(totals.totalCents).toBe(9720 - 500);
  });

  it("stacks a promo and a loyalty reward discount, and never produces a negative total", () => {
    const items: LineItem[] = [{ serviceId: "svc_1", productId: null, packageId: null, unitPriceCents: 1000, quantity: 1, taxable: true }];
    const totals = computeCheckoutTotals({
      items,
      promo: { discountType: "FIXED_AMOUNT", discountValue: 800, eligibility: [] },
      reward: { rewardType: "DISCOUNT_AMOUNT", discountAmountCents: 500, discountPercent: null },
      taxRateBasisPoints: 0,
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
