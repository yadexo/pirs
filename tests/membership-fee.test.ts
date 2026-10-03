import { describe, it, expect } from "vitest";
import { membershipFeePercentFor } from "@/lib/memberships-billing";

/**
 * What the platform takes from a clinic's memberships. Set per clinic by the
 * agency, because a recurring plan is a different deal from a one-off sale —
 * and 0 has to mean nothing, not "unset".
 */
describe("the membership fee for a clinic", () => {
  const env = (percent?: string): NodeJS.ProcessEnv => ({ NODE_ENV: "test", PLATFORM_FEE_PERCENT: percent });

  it("falls back to what the clinic's other sales pay", () => {
    expect(membershipFeePercentFor({ membershipFeePercent: null }, env("10"))).toBe(10);
  });

  it("uses the clinic's own setting when there is one", () => {
    expect(membershipFeePercentFor({ membershipFeePercent: 4.5 }, env("10"))).toBe(4.5);
  });

  it("treats 0 as a real answer, not as unset", () => {
    // An agency giving a clinic memberships for nothing is the whole reason
    // this is per-clinic; it must not silently become the 10% default.
    expect(membershipFeePercentFor({ membershipFeePercent: 0 }, env("10"))).toBe(0);
  });

  it("takes nothing when neither is set", () => {
    expect(membershipFeePercentFor({ membershipFeePercent: null }, env(undefined))).toBe(0);
  });

  it("rounds to the two decimals Stripe accepts", () => {
    expect(membershipFeePercentFor({ membershipFeePercent: 3.456 }, env("10"))).toBe(3.46);
  });

  it("never exceeds 100%", () => {
    expect(membershipFeePercentFor({ membershipFeePercent: 150 }, env("10"))).toBe(100);
  });
});
