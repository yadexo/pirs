/**
 * Membership dates move by calendar months in the clinic's zone.
 *
 * They were moved with setMonth/setFullYear in the process's zone — UTC in
 * production — so a period starting at 10:00 in Amsterdam in March ended at
 * 11:00 in April, after the clocks changed. These are fixed instants, run
 * under three process zones by npm run test:tz.
 */
import { describe, it, expect } from "vitest";
import { addBillingPeriods } from "@/lib/memberships-billing";
import { planPriceChange } from "@/lib/membership-price-change";

const AMS = "Europe/Amsterdam";

describe("billing periods in the clinic's zone", () => {
  it("a month later keeps the clinic's time of day across the clock change", () => {
    // 10:00 Amsterdam on 15 March (UTC+1) → 10:00 on 15 April (UTC+2).
    expect(addBillingPeriods(new Date("2026-03-15T09:00:00Z"), 1, "MONTHLY", AMS).toISOString()).toBe("2026-04-15T08:00:00.000Z");
  });

  it("a year later is twelve calendar months, and the 31st becomes the month's last day", () => {
    expect(addBillingPeriods(new Date("2026-03-15T09:00:00Z"), 1, "ANNUAL", AMS).toISOString()).toBe("2027-03-15T09:00:00.000Z");
    expect(addBillingPeriods(new Date("2026-01-31T09:00:00Z"), 1, "MONTHLY", AMS).toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });

  it("a deferred price change starts a whole clinic month after the next payment", () => {
    const timing = planPriceChange({
      nextBillingAt: new Date("2026-03-20T09:00:00Z"),
      frequency: "MONTHLY",
      now: new Date("2026-03-15T09:00:00Z"),
      timeZone: AMS,
    });
    expect(timing.effectiveAt.toISOString()).toBe("2026-04-20T08:00:00.000Z");
  });
});
