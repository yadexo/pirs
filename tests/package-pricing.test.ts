import { describe, it, expect } from "vitest";
import {
  packageSaving,
  savingLabel,
  packageExpiresAt,
  isExpired,
  sessionsLeftLabel,
  needsExpiryReminder,
  canGiveSessions,
  EXPIRY_REMINDER_DAYS,
} from "@/lib/package-pricing";

/**
 * A package's saving is a claim about money, so the tests are mostly about the
 * cases where it must not be made.
 */

const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

describe("what a package saves", () => {
  it("compares with the cheapest treatment it covers", () => {
    // Glow 5 from the handoff: €425, 5 sessions, cheapest covered €95.
    const saving = packageSaving({ packagePriceCents: 42_500, sessions: 5, coveredSinglePricesCents: [9_500, 12_000] });
    expect(saving.savingCents).toBe(5_000);
    expect(saving.atLeast).toBe(true);
    expect(savingLabel(saving, euro)).toBe("Save at least €50.00");
  });

  it("says plain “Save” when it covers only one treatment", () => {
    const saving = packageSaving({ packagePriceCents: 42_500, sessions: 5, coveredSinglePricesCents: [9_500] });
    expect(saving.atLeast).toBe(false);
    expect(savingLabel(saving, euro)).toBe("Save €50.00");
  });

  it("saves a member less, because they already pay less for one", () => {
    // The handoff's own example: members compare against €85.50.
    const member = packageSaving({ packagePriceCents: 42_500, sessions: 5, coveredSinglePricesCents: [8_550, 10_800] });
    expect(member.savingCents).toBe(250);
    expect(savingLabel(member, euro)).toBe("Save at least €2.50");
  });

  it("claims nothing at all when there is no saving", () => {
    const none = packageSaving({ packagePriceCents: 50_000, sessions: 5, coveredSinglePricesCents: [9_500] });
    expect(none.savingCents).toBeNull();
    expect(savingLabel(none, euro)).toBeNull();
  });

  it("claims nothing when the package exactly matches buying them one by one", () => {
    expect(packageSaving({ packagePriceCents: 47_500, sessions: 5, coveredSinglePricesCents: [9_500] }).savingCents).toBeNull();
  });

  it("claims nothing when it covers nothing", () => {
    expect(packageSaving({ packagePriceCents: 42_500, sessions: 5, coveredSinglePricesCents: [] }).savingCents).toBeNull();
  });

  it("still gives the price per session", () => {
    expect(packageSaving({ packagePriceCents: 48_000, sessions: 5, coveredSinglePricesCents: [] }).perSessionCents).toBe(9_600);
  });
});

describe("when a package runs out", () => {
  const bought = new Date("2026-10-02T10:00:00.000Z");

  it("counts from the day it was bought", () => {
    expect(packageExpiresAt(bought, 365)?.toISOString()).toBe("2027-10-02T10:00:00.000Z");
  });

  it("never expires when the clinic set no expiry", () => {
    expect(packageExpiresAt(bought, null)).toBeNull();
    expect(packageExpiresAt(bought, 0)).toBeNull();
    expect(isExpired(null)).toBe(false);
  });

  it("counts the sessions in the client's own words", () => {
    expect(sessionsLeftLabel(3, 5)).toBe("3 of 5 sessions left");
    expect(sessionsLeftLabel(1, 1)).toBe("1 of 1 session left");
  });
});

describe("the reminder before the end date", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");
  const pkg = (over: Partial<{ remainingUses: number; expiresAt: Date | null; status: string }> = {}) => ({
    remainingUses: 2,
    expiresAt: new Date("2026-10-20T12:00:00.000Z"),
    status: "ACTIVE",
    ...over,
  });

  it("goes out a fortnight before", () => {
    expect(EXPIRY_REMINDER_DAYS).toBe(14);
    expect(needsExpiryReminder(pkg(), now)).toBe(true);
  });

  it("does not go out while there is still plenty of time", () => {
    expect(needsExpiryReminder(pkg({ expiresAt: new Date("2026-12-01T12:00:00.000Z") }), now)).toBe(false);
  });

  it("does not chase somebody who has used them all", () => {
    expect(needsExpiryReminder(pkg({ remainingUses: 0 }), now)).toBe(false);
  });

  it("does not chase one that has already expired", () => {
    expect(needsExpiryReminder(pkg({ expiresAt: new Date("2026-10-01T12:00:00.000Z") }), now)).toBe(false);
  });

  it("says nothing about a package with no end date", () => {
    expect(needsExpiryReminder(pkg({ expiresAt: null }), now)).toBe(false);
  });
});

describe("giving sessions away", () => {
  const base = {
    transferable: true,
    remainingUses: 3,
    requested: 1,
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    giverProfileId: "giver",
    receiverProfileId: "receiver",
    now: new Date("2026-10-13T12:00:00.000Z"),
  };

  it("allows it when everything is in order", () => {
    expect(canGiveSessions(base)).toEqual({ ok: true });
  });

  it("refuses a package the clinic did not make transferable", () => {
    expect(canGiveSessions({ ...base, transferable: false })).toMatchObject({ ok: false, reason: "not-transferable" });
  });

  it("refuses expired sessions", () => {
    expect(canGiveSessions({ ...base, expiresAt: new Date("2026-01-01T00:00:00.000Z") })).toMatchObject({ ok: false, reason: "expired" });
  });

  it("refuses more than are left, and says how many there are", () => {
    const refusal = canGiveSessions({ ...base, requested: 4 });
    expect(refusal).toMatchObject({ ok: false, reason: "too-many" });
    expect((refusal as { message: string }).message).toMatch(/between 1 and 3/);
  });

  it("refuses none and refuses negative", () => {
    expect(canGiveSessions({ ...base, requested: 0 })).toMatchObject({ ok: false });
    expect(canGiveSessions({ ...base, requested: -1 })).toMatchObject({ ok: false });
  });

  it("refuses giving to yourself", () => {
    expect(canGiveSessions({ ...base, receiverProfileId: "giver" })).toMatchObject({ ok: false, reason: "self" });
  });

  it("every refusal says something the client can act on", () => {
    for (const over of [{ transferable: false }, { requested: 99 }, { expiresAt: new Date("2020-01-01T00:00:00.000Z") }]) {
      const refusal = canGiveSessions({ ...base, ...over }) as { ok: false; message: string };
      expect(refusal.message.length, JSON.stringify(over)).toBeGreaterThan(10);
    }
  });
});
