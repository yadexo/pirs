import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ rawDb: {} }));
vi.mock("../lib/db", () => ({ rawDb: {} }));
const { buildReport, verdict } = await import("../prisma/stripe-account-status");

describe("stripe-account-status diagnosis", () => {
  const stored = (o: Partial<{ status: string; charges: boolean; submitted: boolean; checkedAt: Date | null }> = {}) => ({
    stripeAccountId: "acct_1",
    stripeStatus: o.status ?? "PENDING_VERIFICATION",
    stripeChargesEnabled: o.charges ?? false,
    stripePayoutsEnabled: false,
    stripeDetailsSubmitted: o.submitted ?? true,
    stripeStatusCheckedAt: o.checkedAt === undefined ? new Date("2026-09-20T10:00:00Z") : o.checkedAt,
  });
  const account = (o: Partial<{ charges: boolean; submitted: boolean; disabled: string | null; due: string[]; past: string[]; pending: string[] }> = {}) =>
    ({
      id: "acct_1",
      charges_enabled: o.charges ?? false,
      payouts_enabled: false,
      details_submitted: o.submitted ?? true,
      requirements: {
        disabled_reason: o.disabled ?? null,
        currently_due: o.due ?? [],
        past_due: o.past ?? [],
        pending_verification: o.pending ?? [],
      },
    }) as unknown as Stripe.Account;

  it("names a stale database when Stripe has already enabled charges", () => {
    const report = buildReport("Test Clinic", stored(), account({ charges: true }));
    expect(report.stale).toBe(true);
    expect(verdict(report)).toMatch(/webhook never reached us/);
  });

  it("says nothing is wrong when both agree that charges are on", () => {
    const report = buildReport("Test Clinic", stored({ status: "ACTIVE", charges: true }), account({ charges: true }));
    expect(report.stale).toBe(false);
    expect(verdict(report)).toMatch(/Checkout should work/);
  });

  it("names the information Stripe is waiting for, past due first", () => {
    const report = buildReport("Test Clinic", stored(), account({ due: ["individual.id_number"], past: ["external_account"] }));
    expect(verdict(report)).toMatch(/blocking charges until these are provided: external_account/);
    expect(verdict(buildReport("Test Clinic", stored(), account({ due: ["individual.id_number"] })))).toMatch(/waiting on information.*individual\.id_number/);
  });

  it("separates an unfinished form from a submitted one under review", () => {
    expect(verdict(buildReport("c", stored({ status: "ONBOARDING", submitted: false }), account({ submitted: false })))).toMatch(/never finished/);
    expect(verdict(buildReport("c", stored(), account({ pending: ["individual.verification.document"] })))).toMatch(/still verifying.*Nothing to do but wait/);
    expect(verdict(buildReport("c", stored(), account()))).toMatch(/still reviewing the account/);
  });

  it("reports a disabled account with Stripe's own reason", () => {
    expect(verdict(buildReport("c", stored({ status: "RESTRICTED" }), account({ disabled: "rejected.fraud" })))).toMatch(/reason "rejected\.fraud"/);
  });
});
