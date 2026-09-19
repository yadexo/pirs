import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ rawDb: {} }));
const { deriveStripeStatus, countryCodeFrom, onboardingUrls } = await import("@/lib/stripe-connect");

describe("Stripe Connect status", () => {
  const flags = (o: Partial<{ charges_enabled: boolean; details_submitted: boolean; payouts_enabled: boolean; disabled_reason: string | null }>) => ({
    charges_enabled: o.charges_enabled ?? false,
    details_submitted: o.details_submitted ?? false,
    payouts_enabled: o.payouts_enabled ?? false,
    requirements: { disabled_reason: o.disabled_reason ?? null } as never,
  });

  it("is only ACTIVE once Stripe enables card payments", () => {
    expect(deriveStripeStatus(flags({ charges_enabled: true, details_submitted: true }))).toBe("ACTIVE");
  });

  it("returning from onboarding is not verification", () => {
    expect(deriveStripeStatus(flags({ details_submitted: true }))).toBe("PENDING_VERIFICATION");
    expect(deriveStripeStatus(flags({ details_submitted: true, disabled_reason: "requirements.pending_verification" }))).toBe("PENDING_VERIFICATION");
  });

  it("an unfinished form is ONBOARDING; payments paused by Stripe is RESTRICTED", () => {
    expect(deriveStripeStatus(flags({}))).toBe("ONBOARDING");
    expect(deriveStripeStatus(flags({ details_submitted: true, disabled_reason: "requirements.past_due" }))).toBe("RESTRICTED");
    expect(deriveStripeStatus(flags({ details_submitted: true, disabled_reason: "rejected.fraud" }))).toBe("RESTRICTED");
  });
});

describe("country from the clinic's address", () => {
  it("reads codes, English and local names, and common aliases", () => {
    expect(countryCodeFrom("NL")).toBe("NL");
    expect(countryCodeFrom("nl")).toBe("NL");
    expect(countryCodeFrom("Netherlands")).toBe("NL");
    expect(countryCodeFrom("The Netherlands")).toBe("NL");
    expect(countryCodeFrom("Nederland")).toBe("NL");
    expect(countryCodeFrom("Belgium")).toBe("BE");
    expect(countryCodeFrom("Deutschland")).toBe("DE");
    expect(countryCodeFrom("USA")).toBe("US");
    expect(countryCodeFrom("United Kingdom")).toBe("GB");
    expect(countryCodeFrom("UK")).toBe("GB");
  });

  it("refuses to guess", () => {
    for (const v of ["", null, undefined, "Nowhere", "Dutchland", "ZZ", "EU", "European Union", "Europe"]) expect(countryCodeFrom(v)).toBeNull();
  });
});

describe("onboarding URLs", () => {
  it("return to the host the clinic came from", () => {
    expect(onboardingUrls("https://clinic.pirs.io", "c123")).toEqual({
      refresh_url: "https://clinic.pirs.io/m/c123/stripe/refresh",
      return_url: "https://clinic.pirs.io/m/c123/stripe/return",
    });
  });
});
