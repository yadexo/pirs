import { describe, it, expect } from "vitest";
import { cartTotals } from "@/lib/cart-totals";

/**
 * What the cart tells a client they owe, and whether there is anything left
 * to pay. The second question decides whether a card is asked for at all, so
 * it has to be right: offering a card for a settled order, or claiming credit
 * paid for a free basket, are both lies about the client's own money.
 */
describe("the cart's totals", () => {
  const base = { subtotalCents: 5_000, rewardDiscountCents: 0, autoDiscountCents: 0, creditAvailableCents: 0, useCredit: false };

  it("bills the basket when nothing applies", () => {
    expect(cartTotals(base)).toMatchObject({ billCents: 5_000, creditUsedCents: 0, totalCents: 5_000, settledByCreditAlone: false });
  });

  it("takes the discounts off before the credit", () => {
    // €50 less a €25 member price, then €10 of credit.
    expect(cartTotals({ ...base, autoDiscountCents: 2_500, creditAvailableCents: 1_000, useCredit: true })).toMatchObject({
      billCents: 2_500,
      creditUsedCents: 1_000,
      totalCents: 1_500,
    });
  });

  it("counts a reward and an automatic discount together", () => {
    expect(cartTotals({ ...base, rewardDiscountCents: 500, autoDiscountCents: 1_000 }).billCents).toBe(3_500);
  });

  it("leaves the credit alone unless the client asked", () => {
    expect(cartTotals({ ...base, creditAvailableCents: 9_000 })).toMatchObject({ creditUsedCents: 0, totalCents: 5_000 });
  });

  it("takes no more credit than the bill", () => {
    expect(cartTotals({ ...base, creditAvailableCents: 9_000, useCredit: true })).toMatchObject({
      creditUsedCents: 5_000,
      totalCents: 0,
      settledByCreditAlone: true,
    });
  });

  it("says credit settled it only when credit actually did", () => {
    // A basket that is free on its own owes nothing, but no credit was spent,
    // so the client must not be told their credit paid for it.
    expect(cartTotals({ ...base, autoDiscountCents: 5_000 })).toMatchObject({ totalCents: 0, creditUsedCents: 0, settledByCreditAlone: false });
    // Nor when they declined to use the credit they have.
    expect(cartTotals({ ...base, autoDiscountCents: 5_000, creditAvailableCents: 9_000, useCredit: false })).toMatchObject({
      settledByCreditAlone: false,
    });
  });

  it("never goes negative, however large the discounts", () => {
    expect(cartTotals({ ...base, rewardDiscountCents: 9_000, autoDiscountCents: 9_000, creditAvailableCents: 9_000, useCredit: true })).toMatchObject({
      billCents: 0,
      creditUsedCents: 0,
      totalCents: 0,
      settledByCreditAlone: false,
    });
  });

  it("handles an empty cart without claiming anything", () => {
    expect(cartTotals({ ...base, subtotalCents: 0, creditAvailableCents: 5_000, useCredit: true })).toMatchObject({
      totalCents: 0,
      creditUsedCents: 0,
      settledByCreditAlone: false,
    });
  });
});

/**
 * The cart calls its figure "Total incl. VAT", and the price a clinic set is
 * the price the client pays. So the preview adds nothing — it only says how
 * much of that price is VAT, which is what a receipt has to show.
 */
describe("VAT in the preview", () => {
  const basket = { subtotalCents: 12_000, rewardDiscountCents: 0, autoDiscountCents: 1_200, creditAvailableCents: 0, useCredit: false };

  it("charges the price, and nothing on top of it", () => {
    expect(cartTotals({ ...basket, vatRateBasisPoints: 2100 })).toMatchObject({ totalCents: 10_800 });
  });

  it("says how much of that price is VAT", () => {
    // €108 at 21% contains 10800 * 21/121 = €18.74.
    expect(cartTotals({ ...basket, vatRateBasisPoints: 2100 })).toMatchObject({ vatCents: 1_874 });
  });

  it("finds the VAT in what is left after a discount, not in the list price", () => {
    const undiscounted = cartTotals({ ...basket, autoDiscountCents: 0, vatRateBasisPoints: 2100 });
    expect(undiscounted.vatCents).toBe(2_083);
    expect(cartTotals({ ...basket, vatRateBasisPoints: 2100 }).vatCents).toBeLessThan(undiscounted.vatCents);
  });

  it("finds none for a clinic that charges none", () => {
    expect(cartTotals({ ...basket, vatRateBasisPoints: 0 })).toMatchObject({ vatCents: 0, totalCents: 10_800 });
  });

  it("takes credit off the price, which already contains the VAT", () => {
    expect(cartTotals({ ...basket, vatRateBasisPoints: 2100, creditAvailableCents: 50_000, useCredit: true })).toMatchObject({
      creditUsedCents: 10_800,
      totalCents: 0,
      settledByCreditAlone: true,
    });
  });
});
