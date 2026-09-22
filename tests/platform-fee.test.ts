import { describe, it, expect } from "vitest";
import { applicationFeeCents, platformFeePercent } from "@/lib/platform-fee";

const env = (v?: string) => ({ PLATFORM_FEE_PERCENT: v }) as unknown as NodeJS.ProcessEnv;

describe("platform fee", () => {
  it("takes nothing unless a percentage is set", () => {
    for (const v of [undefined, "", "   ", "0", "abc", "-5"]) expect(platformFeePercent(env(v))).toBe(0);
    expect(applicationFeeCents({ subtotalCents: 10_000, chargedCents: 12_100 }, env(undefined))).toBe(0);
  });

  it("is a percentage of the subtotal before tax", () => {
    // €100 subtotal + €21 tax: 2.5% of the subtotal, not of the €121 charged.
    expect(applicationFeeCents({ subtotalCents: 10_000, chargedCents: 12_100 }, env("2.5"))).toBe(250);
    expect(applicationFeeCents({ subtotalCents: 10_000, chargedCents: 12_100 }, env("2,5"))).toBe(250);
  });

  it("rounds to whole cents", () => {
    expect(applicationFeeCents({ subtotalCents: 999, chargedCents: 999 }, env("3"))).toBe(30);
    expect(applicationFeeCents({ subtotalCents: 1_233, chargedCents: 1_233 }, env("1.5"))).toBe(18);
  });

  it("never exceeds what is actually charged", () => {
    // Credit or a discount can leave less to charge than the subtotal.
    expect(applicationFeeCents({ subtotalCents: 10_000, chargedCents: 100 }, env("50"))).toBe(100);
    expect(applicationFeeCents({ subtotalCents: 10_000, chargedCents: 0 }, env("10"))).toBe(0);
    expect(platformFeePercent(env("250"))).toBe(100);
  });
});
