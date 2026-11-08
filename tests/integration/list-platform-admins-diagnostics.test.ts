/**
 * The extra things prod:admins reports for an account that is ACTIVE, has 2FA
 * and is not locked out, but still cannot sign in: a session cut-off still in
 * the future, a computer clock that disagrees with the database, and the same
 * address on another account.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { adminNotes, describeSkew, listPlatformAdmins, type AdminRow, type Clocks } from "../../prisma/list-platform-admins";

const MIN = 60_000;

describe("prod:admins diagnostics", () => {
  const stamp = Date.now();
  const db = rawDb as unknown as PrismaClient;
  const tag = (name: string) => `lpd-${name}-${stamp}@example.com`;
  const emails = {
    plain: tag("plain"),
    future: tag("future"),
    past: tag("past"),
    sharedStaff: tag("shared-staff"),
    sharedClient: tag("shared-client"),
    sharedAdmin: tag("shared-admin"),
    mixed: `lpd-Mixed-${stamp}@Example.com`,
  };
  let clinicId: string;

  const byEmail = async (now?: Date) => Object.fromEntries((await listPlatformAdmins(db, now)).admins.filter((a) => a.email.includes(`-${stamp}@`)).map((a) => [a.email, a]));

  beforeAll(async () => {
    const passwordHash = await hashPassword("a-password-for-the-diagnostics-test");
    clinicId = (await rawDb.tenant.create({ data: { slug: `lpd-${stamp}`, name: "Diagnostics Clinic" } })).id;
    const admin = (email: string, extra: Record<string, unknown> = {}) => rawDb.user.create({ data: { email, passwordHash, role: "PLATFORM_ADMIN", ...extra } });

    await admin(emails.plain);
    await admin(emails.future, { sessionsValidAfter: new Date(Date.now() + 5 * MIN) });
    await admin(emails.past, { sessionsValidAfter: new Date(Date.now() - 5 * MIN) });
    await admin(emails.mixed);

    await admin(emails.sharedStaff);
    await rawDb.user.create({ data: { tenantId: clinicId, email: emails.sharedStaff, passwordHash, role: "TENANT_ADMIN" } });

    await admin(emails.sharedClient);
    await rawDb.user.create({ data: { tenantId: clinicId, email: emails.sharedClient, passwordHash, role: "CUSTOMER" } });

    // Two platform admins on one address. A platform admin has no clinic, and
    // the unique index is on (tenantId, email), so Postgres allows it — and it
    // is the one sharing that still stops the admin sign-in.
    await admin(emails.sharedAdmin);
    await admin(emails.sharedAdmin);
  });

  afterAll(async () => {
    await rawDb.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await rawDb.tenant.delete({ where: { id: clinicId } });
  });

  describe("sessions refused until a moment that has not come yet", () => {
    it("reports how long is left, by the database's clock", async () => {
      const row = (await byEmail())[emails.future]!;
      expect(row.sessionsValidAfter).not.toBeNull();
      expect(row.sessionsRefusedForMs).toBeGreaterThan(4.5 * MIN);
      expect(row.sessionsRefusedForMs).toBeLessThanOrEqual(5 * MIN);
    });

    it("says nothing is wrong once that moment has passed, but still shows it", async () => {
      const row = (await byEmail())[emails.past]!;
      expect(row.sessionsValidAfter).not.toBeNull();
      expect(row.sessionsRefusedForMs).toBe(0);
      expect(adminNotes(row).join(" ")).toContain("has passed");
      expect(adminNotes(row).join(" ")).not.toContain("!!");
    });

    it("has nothing to report for an account that was never reset", async () => {
      const row = (await byEmail())[emails.plain]!;
      expect(row).toMatchObject({ sessionsValidAfter: null, sessionsRefusedForMs: 0 });
      expect(adminNotes(row)).toEqual([]);
    });

    it("flags a cut-off in the future, and what it looks like to the person", async () => {
      const notes = adminNotes((await byEmail())[emails.future]!).join(" ");
      expect(notes).toContain("!!");
      expect(notes).toMatch(/refused until/i);
      expect(notes).toMatch(/access changed/);
    });
  });

  describe("the two clocks", () => {
    it("reports how far this computer is from the database", async () => {
      const ahead = new Date(Date.now() + 2 * MIN);
      const { clocks } = await listPlatformAdmins(db, ahead);
      expect(clocks.localNow).toBe(ahead.toISOString());
      expect(Math.abs(clocks.skewMs - 2 * MIN)).toBeLessThan(5000);
      expect(describeSkew(clocks)).toMatch(/AHEAD of the database/);
      expect(describeSkew(clocks)).toMatch(/enough to matter/);
    });

    it("says a computer that is behind is behind, and one that is close is in step", () => {
      const clocks = (skewMs: number): Clocks => ({ databaseNow: "2026-11-08T12:00:00.000Z", localNow: "x", skewMs });
      expect(describeSkew(clocks(-90_000))).toMatch(/90|1m 30s/);
      expect(describeSkew(clocks(-90_000))).toMatch(/behind the database/);
      expect(describeSkew(clocks(2_000))).toMatch(/in step/);
      expect(describeSkew(clocks(-2_000))).toMatch(/in step/);
      // A few seconds is ordinary and not worth alarming anyone with.
      expect(describeSkew(clocks(20_000))).not.toMatch(/enough to matter/);
    });
  });

  describe("the same address on another account", () => {
    it("flags a second platform admin, which is what still makes the admin sign-in refuse both", async () => {
      const row = (await byEmail())[emails.sharedAdmin]!;
      expect(row.otherAccountsWithEmail).toEqual([{ role: "PLATFORM_ADMIN", count: 1 }]);
      expect(row.emailBlocksSignIn).toBe(true);
      const notes = adminNotes(row).join(" ");
      expect(notes).toMatch(/refuses both/);
      expect(notes).toContain("!!");
    });

    it("reports a clinic account on the same address as information, not a problem", async () => {
      // Each door signs in only its own kind now, so this no longer blocks
      // anything: the admin door never looks at the clinic account.
      const row = (await byEmail())[emails.sharedStaff]!;
      expect(row.otherAccountsWithEmail).toEqual([{ role: "TENANT_ADMIN", count: 1 }]);
      expect(row.emailBlocksSignIn).toBe(false);
      const notes = adminNotes(row).join(" ");
      expect(notes).toMatch(/TENANT_ADMIN/);
      expect(notes).not.toContain("!!");
    });

    it("reports a client account on the same address the same way", async () => {
      const row = (await byEmail())[emails.sharedClient]!;
      expect(row.otherAccountsWithEmail).toEqual([{ role: "CUSTOMER", count: 1 }]);
      expect(row.emailBlocksSignIn).toBe(false);
      const notes = adminNotes(row).join(" ");
      expect(notes).toMatch(/CUSTOMER/);
      expect(notes).not.toContain("!!");
    });

    it("reports roles and counts only — nothing that identifies the other account", async () => {
      const row = (await byEmail())[emails.sharedStaff]!;
      expect(Object.keys(row.otherAccountsWithEmail[0]!).sort()).toEqual(["count", "role"]);
      const text = JSON.stringify(row);
      expect(text).not.toContain("Diagnostics Clinic");
      expect(text).not.toContain(clinicId);
    });

    it("has nothing to say about an address that is on one account only", async () => {
      expect((await byEmail())[emails.plain]).toMatchObject({ otherAccountsWithEmail: [], emailBlocksSignIn: false });
    });
  });

  describe("an address stored with capital letters", () => {
    it("is flagged, because sign-in looks up the lowercase form and can never find it", async () => {
      const row = (await byEmail())[emails.mixed]!;
      expect(row.emailNotLowercase).toBe(true);
      expect(adminNotes(row).join(" ")).toMatch(/capital letters/);
    });

    it("is not flagged for an ordinary lowercase address", async () => {
      expect((await byEmail())[emails.plain]!.emailNotLowercase).toBe(false);
    });
  });

  it("does not write anything while reporting all this", async () => {
    const before = [await rawDb.user.count(), await rawDb.rateLimitBucket.count()];
    await listPlatformAdmins(db);
    expect([await rawDb.user.count(), await rawDb.rateLimitBucket.count()]).toEqual(before);
  });

  it("describes an admin with nothing wrong in no notes at all", () => {
    const clean: AdminRow = {
      email: "a@example.com",
      name: null,
      status: "ACTIVE",
      twoFactorConfirmed: true,
      lastLoginAt: null,
      sessionsValidAfter: null,
      sessionsRefusedForMs: 0,
      otherAccountsWithEmail: [],
      emailBlocksSignIn: false,
      emailNotLowercase: false,
    };
    expect(adminNotes(clean)).toEqual([]);
  });
});
