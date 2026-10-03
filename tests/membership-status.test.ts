import { describe, it, expect } from "vitest";
import {
  MEMBERSHIP_HOLDS_SLOT,
  PAST_DUE_GRACE_MS,
  graceEndsAt,
  membershipGivesBenefits,
  pastDueGraceExpired,
} from "@/lib/membership-status";

/**
 * Two questions get asked of a membership — does it occupy the client's one
 * slot, and does it give benefits right now — and they have different answers.
 * A membership waiting for its first payment is the case that matters: it is
 * real enough to stop a second signup, and worth nothing until it is paid.
 */
describe("what a membership status means", () => {
  const since = (ms: number) => new Date(Date.now() - ms);

  it("gives nothing while the first payment is unconfirmed", () => {
    expect(membershipGivesBenefits({ status: "PENDING" })).toBe(false);
    // But it still counts as having one, so nobody signs up twice over.
    expect(MEMBERSHIP_HOLDS_SLOT).toContain("PENDING");
  });

  it("gives benefits when active or trialling", () => {
    expect(membershipGivesBenefits({ status: "ACTIVE" })).toBe(true);
    expect(membershipGivesBenefits({ status: "TRIAL" })).toBe(true);
  });

  it("keeps benefits through the grace period after a failed payment", () => {
    expect(membershipGivesBenefits({ status: "PAST_DUE", pastDueSince: since(0) })).toBe(true);
    expect(membershipGivesBenefits({ status: "PAST_DUE", pastDueSince: since(PAST_DUE_GRACE_MS - 60_000) })).toBe(true);
  });

  it("stops benefits once the grace period is over", () => {
    const overdue = { status: "PAST_DUE", pastDueSince: since(PAST_DUE_GRACE_MS + 60_000) };
    expect(membershipGivesBenefits(overdue)).toBe(false);
    expect(pastDueGraceExpired(overdue)).toBe(true);
  });

  it("does not suspend a membership that is only just behind", () => {
    expect(pastDueGraceExpired({ status: "PAST_DUE", pastDueSince: since(PAST_DUE_GRACE_MS - 1000) })).toBe(false);
    expect(pastDueGraceExpired({ status: "ACTIVE" })).toBe(false);
  });

  it("treats a past-due membership with no start date as still in grace", () => {
    // The clock has to start somewhere, and a missing timestamp is our fault,
    // not the client's — so they keep what they have until it is set.
    expect(membershipGivesBenefits({ status: "PAST_DUE", pastDueSince: null })).toBe(true);
    expect(pastDueGraceExpired({ status: "PAST_DUE", pastDueSince: null })).toBe(false);
  });

  it("gives nothing once suspended, cancelled or expired", () => {
    for (const status of ["SUSPENDED", "CANCELLED", "EXPIRED", "PAUSED"]) {
      expect(membershipGivesBenefits({ status })).toBe(false);
    }
  });

  it("still counts a suspended membership as the client's one membership", () => {
    // The subscription exists at Stripe and a payment revives it; offering a
    // second plan on top would make a mess of both.
    expect(MEMBERSHIP_HOLDS_SLOT).toContain("SUSPENDED");
    expect(MEMBERSHIP_HOLDS_SLOT).not.toContain("CANCELLED");
  });

  it("can say when benefits run out, for telling the client", () => {
    const start = since(0);
    expect(graceEndsAt({ status: "PAST_DUE", pastDueSince: start })?.getTime()).toBe(start.getTime() + PAST_DUE_GRACE_MS);
    expect(graceEndsAt({ status: "ACTIVE" })).toBeNull();
  });
});
