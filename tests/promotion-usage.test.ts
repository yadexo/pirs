import { describe, it, expect } from "vitest";
import { isPromotionUsed, warnBeforeDelete, whyHidden, NO_USAGE } from "@/lib/promotion-usage";

/**
 * What a clinic is told when deleting an offer doesn't delete it.
 *
 * The wording is tested because it is the whole point: "Hidden" appearing
 * where a clinic expected the row to vanish looks like a bug until somebody
 * explains that their order history depends on it.
 */
describe("explaining a hidden offer", () => {
  it("says nothing about an offer nobody has used", () => {
    expect(isPromotionUsed(NO_USAGE)).toBe(false);
    expect(whyHidden(NO_USAGE)).toBeNull();
    expect(warnBeforeDelete(NO_USAGE)).toBeNull();
  });

  it("leads with the orders, which is the reason that matters", () => {
    expect(whyHidden({ orders: 3, redemptions: 3, campaigns: 1 })).toBe(
      "This offer was used in 3 orders, so it's hidden instead of deleted to keep your order history correct.",
    );
  });

  it("counts one order as one order", () => {
    expect(whyHidden({ orders: 1, redemptions: 0, campaigns: 0 })).toContain("used in 1 order,");
  });

  it("falls back to redemptions when no order still points at it", () => {
    expect(whyHidden({ orders: 0, redemptions: 2, campaigns: 0 })).toBe(
      "This offer was used 2 times, so it's hidden instead of deleted to keep your records correct.",
    );
  });

  it("explains a campaign-only offer in its own terms", () => {
    // Nobody spent it, but a notification announced it, and a notification
    // whose offer vanished explains nothing.
    expect(whyHidden({ orders: 0, redemptions: 0, campaigns: 1 })).toBe(
      "This offer was announced in 1 notification, so it's hidden instead of deleted to keep that message history correct.",
    );
  });

  it("adds what happens in the app when warning beforehand", () => {
    expect(warnBeforeDelete({ orders: 2, redemptions: 0, campaigns: 0 })).toBe(
      "This offer was used in 2 orders, so it's hidden instead of deleted to keep your order history correct. It stops showing in the client app either way.",
    );
  });

  it("treats any single reference as used", () => {
    expect(isPromotionUsed({ orders: 1, redemptions: 0, campaigns: 0 })).toBe(true);
    expect(isPromotionUsed({ orders: 0, redemptions: 1, campaigns: 0 })).toBe(true);
    expect(isPromotionUsed({ orders: 0, redemptions: 0, campaigns: 1 })).toBe(true);
  });
});
