import { describe, it, expect } from "vitest";
import { lowestInWindow, referencePrice, groupHistory, OMNIBUS_WINDOW_DAYS } from "@/lib/price-history";

/**
 * The struck-through price is a legal claim, not a decoration: under the EU's
 * Omnibus rule it has to be the lowest price the clinic applied in the 30 days
 * before the reduction. Most of these tests are about refusing to show one.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-10-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("the 30-day low", () => {
  it("is the lowest price that was actually in force", () => {
    const history = [
      { priceCents: 12000, recordedAt: daysAgo(40) },
      { priceCents: 9600, recordedAt: daysAgo(20) },
      { priceCents: 15000, recordedAt: daysAgo(5) },
    ];
    expect(lowestInWindow(history, NOW)).toBe(9600);
  });

  it("counts the price the window opened on, which was set before it", () => {
    // Nothing changed inside the window at all. The price is still the price
    // that applied throughout it, so it is the low — not "no history".
    const history = [{ priceCents: 8000, recordedAt: daysAgo(400) }];
    expect(lowestInWindow(history, NOW)).toBe(8000);
  });

  it("ignores what happened before the window, if something cheaper came after", () => {
    const history = [
      { priceCents: 5000, recordedAt: daysAgo(90) },
      { priceCents: 12000, recordedAt: daysAgo(31) },
    ];
    // The €50 was over a month ago and €120 has applied ever since.
    expect(lowestInWindow(history, NOW)).toBe(12000);
  });

  it("has no answer for an item with no recorded price", () => {
    expect(lowestInWindow([], NOW)).toBeNull();
  });

  it("looks back exactly thirty days", () => {
    expect(OMNIBUS_WINDOW_DAYS).toBe(30);
  });
});

describe("the price to strike through", () => {
  it("is the 30-day low when the client is paying less than it", () => {
    const history = [
      { priceCents: 12000, recordedAt: daysAgo(60) },
      { priceCents: 11000, recordedAt: daysAgo(10) },
    ];
    expect(referencePrice(history, 9600, NOW)).toBe(11000);
  });

  it("is never the list price when a lower one applied in the window", () => {
    // The trick the rule exists to stop: put the price up, then "discount" it
    // back to where it was and strike through the inflated one.
    const history = [
      { priceCents: 9600, recordedAt: daysAgo(25) },
      { priceCents: 15000, recordedAt: daysAgo(3) },
    ];
    // Paying €96 again is not a reduction on the €96 of three weeks ago.
    expect(referencePrice(history, 9600, NOW)).toBeNull();
  });

  it("shows nothing when the client is paying the usual price", () => {
    const history = [{ priceCents: 9600, recordedAt: daysAgo(90) }];
    expect(referencePrice(history, 9600, NOW)).toBeNull();
  });

  it("shows nothing when the price went up", () => {
    const history = [
      { priceCents: 9600, recordedAt: daysAgo(40) },
      { priceCents: 12000, recordedAt: daysAgo(2) },
    ];
    expect(referencePrice(history, 12000, NOW)).toBeNull();
  });

  it("shows nothing for an item with no history at all", () => {
    expect(referencePrice([], 9600, NOW)).toBeNull();
  });

  it("does show one for a genuine cut from a long-standing price", () => {
    const history = [{ priceCents: 12000, recordedAt: daysAgo(200) }];
    expect(referencePrice(history, 9600, NOW)).toBe(12000);
  });
});

describe("grouping the rows", () => {
  it("keeps each item's prices apart, by kind as well as id", () => {
    const grouped = groupHistory([
      { itemType: "SERVICE", serviceId: "a", productId: null, priceCents: 100, recordedAt: daysAgo(2) },
      { itemType: "PRODUCT", serviceId: null, productId: "b", priceCents: 200, recordedAt: daysAgo(2) },
      { itemType: "SERVICE", serviceId: "a", productId: null, priceCents: 150, recordedAt: daysAgo(1) },
    ]);
    expect(grouped.get("SERVICE:a")).toHaveLength(2);
    expect(grouped.get("PRODUCT:b")).toHaveLength(1);
  });

  it("drops a row that points at nothing rather than inventing a key", () => {
    const grouped = groupHistory([{ itemType: "SERVICE", serviceId: null, productId: null, priceCents: 100, recordedAt: NOW }]);
    expect(grouped.size).toBe(0);
  });
});
