import { describe, it, expect } from "vitest";
import { planPriceChange, PRICE_NOTICE_DAYS } from "@/lib/membership-price-change";

/**
 * When a price rise is allowed to reach a member.
 *
 * The rule is a promise to the client: nobody is charged more than they
 * agreed to without a month to decide whether to stay. That makes the
 * arithmetic here the whole feature, so it is tested on its own rather than
 * through a form and a Stripe call.
 */
describe("when a member's new price starts", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  it("uses the next billing date when it is far enough away", () => {
    const timing = planPriceChange({ nextBillingAt: days(45), frequency: "MONTHLY", now });
    expect(timing).toMatchObject({ immediate: true, periodsDeferred: 0 });
    expect(timing.effectiveAt).toEqual(days(45));
  });

  it("takes exactly 30 days' notice as enough", () => {
    const timing = planPriceChange({ nextBillingAt: days(PRICE_NOTICE_DAYS), frequency: "MONTHLY", now });
    expect(timing.immediate).toBe(true);
    expect(timing.effectiveAt).toEqual(days(PRICE_NOTICE_DAYS));
  });

  it("skips a payment that comes too soon, and starts the period after", () => {
    // Billed in five days: that one goes out at the old price.
    const timing = planPriceChange({ nextBillingAt: days(5), frequency: "MONTHLY", now });

    expect(timing).toMatchObject({ immediate: false, periodsDeferred: 1 });
    // A month after the payment they were not warned about.
    const expected = new Date(days(5));
    expected.setMonth(expected.getMonth() + 1);
    expect(timing.effectiveAt).toEqual(expected);
  });

  it("waits for the un-warned invoice before Stripe is told", () => {
    // Switching a price makes the next invoice use it, so telling Stripe now
    // would charge the member the new price in five days — the exact thing
    // the notice period forbids.
    const timing = planPriceChange({ nextBillingAt: days(5), frequency: "MONTHLY", now });
    expect(timing.applyAfter).toEqual(days(5));
  });

  it("tells Stripe straight away when the next invoice is the right one", () => {
    const timing = planPriceChange({ nextBillingAt: days(40), frequency: "MONTHLY", now });
    expect(timing.applyAfter).toEqual(now);
  });

  it("handles a yearly plan billed next week", () => {
    const timing = planPriceChange({ nextBillingAt: days(7), frequency: "ANNUAL", now });
    // A year after the payment they were not warned about — not a month.
    const expected = new Date(days(7));
    expected.setFullYear(expected.getFullYear() + 1);
    expect(timing.effectiveAt).toEqual(expected);
    expect(timing.periodsDeferred).toBe(1);
  });

  it("keeps moving out if even the period after is too soon", () => {
    // Nothing is billed this often today, but a plan that was would still
    // owe its members a month's warning.
    const timing = planPriceChange({ nextBillingAt: days(1), frequency: "MONTHLY", now, noticeDays: 60 });
    expect(timing.periodsDeferred).toBe(2);
    expect(timing.effectiveAt.getTime()).toBeGreaterThanOrEqual(days(60).getTime());
  });

  it("gives at least the notice period, whatever the dates", () => {
    for (const d of [0, 1, 5, 15, 29, 30, 31, 60, 400]) {
      const timing = planPriceChange({ nextBillingAt: days(d), frequency: "MONTHLY", now });
      expect(timing.effectiveAt.getTime(), `next billing in ${d} days`).toBeGreaterThanOrEqual(days(PRICE_NOTICE_DAYS).getTime());
    }
  });
});
