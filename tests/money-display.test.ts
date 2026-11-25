/**
 * Money a client or clinic reads must add up and say what it means.
 *
 * Found in the QA pass (docs/qa/bug-hunt-2026-11.md, M1, K3, M2, P3, SH6):
 * - the cart step's total silently subtracted the member's credit, so the
 *   lines did not add up to it, and the floating cart bar showed yet another
 *   figure;
 * - a line of 2 × Foam Roller showed "€ 35", the unit price, as if it were
 *   the line;
 * - "Leden besparen 10% op alles" for a plan that only discounts treatments;
 * - a refunded order still said "Betaald" to the client, and the portal row
 *   kept showing the full amount.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cartLineAmounts, memberSavingCopy, orderRefundState } from "@/lib/money-display";
import nl from "@/messages/nl.json";
import en from "@/messages/en.json";

describe("a cart line", () => {
  it("shows what the line costs, with the unit price only when there is more than one", () => {
    expect(cartLineAmounts(3500, 2)).toEqual({ lineCents: 7000, unitCents: 3500, showUnit: true });
    expect(cartLineAmounts(6000, 1)).toEqual({ lineCents: 6000, unitCents: 6000, showUnit: false });
  });
});

describe("the members-save banner", () => {
  it("says what the plan actually discounts", () => {
    expect(memberSavingCopy(10, 0)).toEqual({ key: "membersSaveTreatments", rate: 10 });
    expect(memberSavingCopy(10, null)).toEqual({ key: "membersSaveTreatments", rate: 10 });
    expect(memberSavingCopy(0, 15)).toEqual({ key: "membersSaveProducts", rate: 15 });
    expect(memberSavingCopy(10, 10)).toEqual({ key: "membersSaveAll", rate: 10 });
    expect(memberSavingCopy(10, 5)).toEqual({ key: "membersSaveSplit", rate: 10, productRate: 5 });
    expect(memberSavingCopy(0, 0)).toBeNull();
  });

  it("has every wording in both languages, and only the all-wording claims everything", () => {
    for (const messages of [nl, en]) {
      const shop = messages.clientApp.shop as unknown as Record<string, string>;
      for (const key of ["membersSaveAll", "membersSaveTreatments", "membersSaveProducts", "membersSaveSplit"]) expect(shop[key], key).toBeTruthy();
      expect(shop.membersSaveTreatments).not.toMatch(/alles|everything/);
      expect(shop.membersSaveProducts).not.toMatch(/alles|everything/);
    }
  });
});

describe("an order that was refunded", () => {
  it("is paid, partly refunded or refunded according to the refunds", () => {
    expect(orderRefundState(9500, 0)).toBe("paid");
    expect(orderRefundState(9500, 1050)).toBe("partlyRefunded");
    expect(orderRefundState(9500, 9500)).toBe("refunded");
  });

  it("the client's order list uses it instead of a fixed 'paid'", () => {
    const view = readFileSync("app/app/[merchantSlug]/profile/profile-view.tsx", "utf8");
    expect(view).toMatch(/orderRefundState\(/);
    expect(view).not.toMatch(/<span className="status-pill">\{tp\("paid"\)\}<\/span>/);
  });

  it("the portal row shows what was refunded", () => {
    const page = readFileSync("app/m/[merchantId]/shop/page.tsx", "utf8");
    expect(page).toMatch(/refundedCents/);
  });
});

describe("the cart total", () => {
  it("leaves credit to the checkout step, where its line and switch are shown", () => {
    const sheet = readFileSync("app/app/[merchantSlug]/cart-sheet.tsx", "utf8");
    expect(sheet).toMatch(/useCredit:\s*useCredit && stage !== "cart"/);
  });

  it("the floating cart bar takes off the same automatic discount the cart shows", () => {
    const shell = readFileSync("app/app/[merchantSlug]/shell.tsx", "utf8");
    expect(shell).toMatch(/clientCartExtrasAction/);
    expect(shell).toMatch(/money\(\s*subtotal - autoDiscountCents/);
  });
});
