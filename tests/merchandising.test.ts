import { describe, it, expect } from "vitest";
import { cardTag, isNew, offerLabel, popularIds, priceItem, POPULAR_MIN_SOLD } from "@/lib/merchandising";
import { homeOrder } from "@/lib/home-layout";
import type { DiscountCandidate } from "@/lib/discounts";

/**
 * The two claims a shop card makes about the world: that other clients bought
 * this, and that a member would pay less. Both have to be true.
 */

const NOW = new Date("2026-10-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("calling something popular", () => {
  it("needs more than one or two sales", () => {
    const popular = popularIds([
      { kind: "SERVICE", id: "quiet", quantity: POPULAR_MIN_SOLD - 1 },
      { kind: "SERVICE", id: "busy", quantity: POPULAR_MIN_SOLD },
    ]);
    expect(popular.has("SERVICE:busy")).toBe(true);
    expect(popular.has("SERVICE:quiet")).toBe(false);
  });

  it("is a handful at most, so the word keeps meaning something", () => {
    const sold = Array.from({ length: 30 }, (_, i) => ({ kind: "PRODUCT" as const, id: `p${i}`, quantity: 10 + i }));
    expect(popularIds(sold).size).toBe(5);
  });

  it("picks the best sellers, not the first ones", () => {
    const popular = popularIds(
      [
        { kind: "SERVICE", id: "a", quantity: 4 },
        { kind: "SERVICE", id: "b", quantity: 90 },
      ],
      1,
    );
    expect([...popular]).toEqual(["SERVICE:b"]);
  });

  it("says nothing when nothing sold", () => {
    expect(popularIds([]).size).toBe(0);
  });
});

describe("calling something new", () => {
  it("means added in the last thirty days", () => {
    expect(isNew(daysAgo(29), NOW)).toBe(true);
    expect(isNew(daysAgo(31), NOW)).toBe(false);
  });
});

describe("the one tag a card carries", () => {
  it("gives the discount the slot, because it is the one that changes the price", () => {
    expect(cardTag({ offerLabel: "20% off", popular: true, isNew: true })).toEqual({ kind: "brand", label: "20% off" });
  });

  it("prefers what others bought over what just arrived", () => {
    expect(cardTag({ popular: true, isNew: true })).toEqual({ kind: "photo", label: "Popular" });
  });

  it("falls back to New, and then to nothing", () => {
    expect(cardTag({ isNew: true })).toEqual({ kind: "photo", label: "New" });
    expect(cardTag({})).toBeNull();
  });
});

describe("the discount label", () => {
  it("says the percentage when it is a round one", () => {
    expect(offerLabel(12000, 9600, "Autumn skin reset")).toBe("20% off");
  });

  it("falls back to the clinic's own words rather than a crooked number", () => {
    expect(offerLabel(10000, 9300, "Autumn skin reset")).toBe("Autumn skin reset");
  });

  it("says nothing when nothing comes off", () => {
    expect(offerLabel(10000, 10000, "Autumn skin reset")).toBeNull();
    expect(offerLabel(10000, 9000, null)).toBeNull();
  });
});

/* ------------------------------------------------------------- two prices */

const plan = { id: "plan1", name: "Glow", serviceDiscountPercent: 10, productDiscountPercent: 10 };
const bigOffer: DiscountCandidate = {
  id: "promo1",
  title: "Autumn skin reset",
  discountType: "PERCENT",
  discountValue: 20,
  minOrderCents: null,
  perCustomerLimit: null,
  usageLimit: null,
  eligibility: [],
};

const item = { kind: "SERVICE" as const, id: "s1", categoryId: null, priceCents: 12000 };

describe("the price a card shows", () => {
  it("is the list price when nothing applies", () => {
    const priced = priceItem(item, { viewerCandidates: [], now: NOW });
    expect(priced.viewerPriceCents).toBe(12000);
    expect(priced.offerLabel).toBeNull();
    expect(priced.memberPriceCents).toBeNull();
  });

  it("is the discounted price, and says so, when a promotion applies", () => {
    const priced = priceItem(item, { viewerCandidates: [bigOffer], now: NOW });
    expect(priced.viewerPriceCents).toBe(9600);
    expect(priced.offerLabel).toBe("20% off");
  });

  it("offers a non-member the member price below their own", () => {
    const priced = priceItem(item, { viewerCandidates: [], pitchPlan: plan, now: NOW });
    expect(priced.viewerPriceCents).toBe(12000);
    expect(priced.memberPriceCents).toBe(10800);
  });

  it("drops the member line when the plan would not actually beat the offer", () => {
    // A 20% promotion already beats the plan's 10%, and the two never stack —
    // so "Members pay" would be quoting a worse price as a saving.
    const priced = priceItem(item, { viewerCandidates: [bigOffer], pitchPlan: plan, now: NOW });
    expect(priced.viewerPriceCents).toBe(9600);
    expect(priced.memberPriceCents).toBeNull();
  });

  it("shows a member their own price and no pitch", () => {
    // A member is passed no plan to pitch; their plan is already in their
    // own candidates, so the member price is simply the price.
    const asMember = priceItem(item, { viewerCandidates: [{ ...bigOffer, id: "m", title: "Glow member price", discountValue: 10, source: "MEMBERSHIP" }], now: NOW });
    expect(asMember.viewerPriceCents).toBe(10800);
    expect(asMember.memberPriceCents).toBeNull();
  });

  it("strikes a price through only when the 30-day rule allows it", () => {
    const history = [{ priceCents: 12000, recordedAt: daysAgo(90) }];
    expect(priceItem(item, { viewerCandidates: [bigOffer], history, now: NOW }).wasCents).toBe(12000);
    // Same discount, but the item was already down to €96 three weeks ago.
    const recent = [...history, { priceCents: 9600, recordedAt: daysAgo(20) }];
    expect(priceItem(item, { viewerCandidates: [bigOffer], history: recent, now: NOW }).wasCents).toBeNull();
  });
});

describe("the order of the Home sections", () => {
  it("puts a returning client's own things first", () => {
    expect(homeOrder(true).slice(0, 3)).toEqual(["itemsToRedeem", "personalOffer", "buyAgain"]);
  });

  it("leaves those out entirely for someone who has never bought anything", () => {
    const order = homeOrder(false);
    expect(order).toEqual(["offers", "popularTreatments", "membershipPitch", "products", "nextReward"]);
    for (const mine of ["itemsToRedeem", "personalOffer", "buyAgain"]) {
      expect(order).not.toContain(mine);
    }
  });
});
