import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { LOGIN_ATTEMPTS_PER_ACCOUNT, LOGIN_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS } from "@/lib/login-limits";
import { formatRemaining, listPlatformAdmins } from "../../prisma/list-platform-admins";

describe("list-platform-admins script", () => {
  const stamp = Date.now();
  const db = rawDb as unknown as PrismaClient;
  const protectedAdmin = `lpa-protected-${stamp}@example.com`;
  const bareAdmin = `lpa-bare-${stamp}@example.com`;
  const unconfirmedAdmin = `lpa-unconfirmed-${stamp}@example.com`;
  const disabledAdmin = `lpa-disabled-${stamp}@example.com`;
  const clinicOwner = `lpa-owner-${stamp}@example.com`;
  const SECRET = `JBSWY3DPEHPK3PXP${stamp}`;
  const PASSWORD = `a-very-unique-password-${stamp}`;
  let clinicId: string;
  const now = new Date("2026-11-08T12:00:00Z");
  const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);

  const mine = (report: Awaited<ReturnType<typeof listPlatformAdmins>>) => report.admins.filter((a) => a.email.includes(`-${stamp}@`));

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const make = (email: string, extra: Record<string, unknown> = {}) => rawDb.user.create({ data: { email, passwordHash, role: "PLATFORM_ADMIN", ...extra } });

    const protectedUser = await make(protectedAdmin, { firstName: "Pat", lastName: "Protected", lastLoginAt: new Date("2026-11-07T08:30:00Z") });
    await rawDb.twoFactorSecret.create({ data: { userId: protectedUser.id, secret: SECRET, confirmedAt: new Date("2026-10-01T00:00:00Z") } });
    await make(bareAdmin);
    const unconfirmedUser = await make(unconfirmedAdmin);
    await rawDb.twoFactorSecret.create({ data: { userId: unconfirmedUser.id, secret: SECRET + "X" } });
    await make(disabledAdmin, { status: "DISABLED" });

    clinicId = (await rawDb.tenant.create({ data: { slug: `lpa-${stamp}`, name: "LPA Clinic" } })).id;
    await rawDb.user.create({ data: { tenantId: clinicId, email: clinicOwner, passwordHash, role: "TENANT_ADMIN" } });

    await rawDb.rateLimitBucket.createMany({
      data: [
        // Locked: past the account limit, 7 minutes to go.
        { key: `login:admin:${bareAdmin}`, count: LOGIN_ATTEMPTS_PER_ACCOUNT + 1, resetAt: inMinutes(7) },
        // Running but not locked.
        { key: `login:admin:${protectedAdmin}`, count: 3, resetAt: inMinutes(4) },
        // Exactly at the limit is still allowed: it is the next attempt that is refused.
        { key: `login:admin:lpa-edge-${stamp}@example.com`, count: LOGIN_ATTEMPTS_PER_ACCOUNT, resetAt: inMinutes(2) },
        // A locked address.
        { key: `login:ip:203.0.113.${stamp % 250}`, count: LOGIN_ATTEMPTS_PER_IP + 5, resetAt: inMinutes(9) },
        // Over the limit but already over: must not be reported as a lock.
        { key: `login:admin:lpa-expired-${stamp}@example.com`, count: 99, resetAt: new Date(now.getTime() - 1000) },
        // Not a sign-in counter at all.
        { key: `register:lpa-${stamp}`, count: 99, resetAt: inMinutes(5) },
      ],
    });
  });

  afterAll(async () => {
    await rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: { contains: `-${stamp}@` } }, { key: { contains: `lpa-${stamp}` } }, { key: { contains: `203.0.113.${stamp % 250}` } }] } });
    await rawDb.user.deleteMany({ where: { email: { in: [protectedAdmin, bareAdmin, unconfirmedAdmin, disabledAdmin, clinicOwner] } } });
    await rawDb.tenant.delete({ where: { id: clinicId } });
  });

  describe("the admins", () => {
    it("lists platform admins only — a clinic owner is not one", async () => {
      const report = await listPlatformAdmins(db, now);
      expect(mine(report).map((a) => a.email).sort()).toEqual([protectedAdmin, bareAdmin, unconfirmedAdmin, disabledAdmin].sort());
      expect(report.admins.map((a) => a.email)).not.toContain(clinicOwner);
    });

    it("reports two-factor as confirmed only when it was confirmed", async () => {
      const byEmail = Object.fromEntries(mine(await listPlatformAdmins(db, now)).map((a) => [a.email, a]));
      expect(byEmail[protectedAdmin]!.twoFactorConfirmed).toBe(true);
      expect(byEmail[bareAdmin]!.twoFactorConfirmed).toBe(false);
      // A secret that was set up and never confirmed protects nothing.
      expect(byEmail[unconfirmedAdmin]!.twoFactorConfirmed).toBe(false);
    });

    it("reports status, name and last sign-in", async () => {
      const byEmail = Object.fromEntries(mine(await listPlatformAdmins(db, now)).map((a) => [a.email, a]));
      expect(byEmail[protectedAdmin]).toMatchObject({ status: "ACTIVE", name: "Pat Protected", lastLoginAt: "2026-11-07T08:30:00.000Z" });
      expect(byEmail[bareAdmin]).toMatchObject({ name: null, lastLoginAt: null });
      expect(byEmail[disabledAdmin]!.status).toBe("DISABLED");
    });
  });

  describe("the rate-limit counters", () => {
    const find = (report: Awaited<ReturnType<typeof listPlatformAdmins>>, subject: string) => report.buckets.find((b) => b.subject === subject);

    it("marks a counter over its limit as locked, with the time left", async () => {
      const report = await listPlatformAdmins(db, now);
      expect(find(report, bareAdmin)).toMatchObject({
        kind: "account",
        portal: "admin",
        attempts: LOGIN_ATTEMPTS_PER_ACCOUNT + 1,
        limit: LOGIN_ATTEMPTS_PER_ACCOUNT,
        locked: true,
        remainingMs: 7 * 60_000,
        platformAdmin: true,
      });
    });

    it("does not call a counter below the limit, or exactly at it, a lock", async () => {
      const report = await listPlatformAdmins(db, now);
      expect(find(report, protectedAdmin)).toMatchObject({ attempts: 3, locked: false, remainingMs: 4 * 60_000 });
      expect(find(report, `lpa-edge-${stamp}@example.com`)).toMatchObject({ attempts: LOGIN_ATTEMPTS_PER_ACCOUNT, locked: false });
    });

    it("reports an address by its own, higher limit", async () => {
      const report = await listPlatformAdmins(db, now);
      expect(find(report, `203.0.113.${stamp % 250}`)).toMatchObject({ kind: "ip", portal: null, limit: LOGIN_ATTEMPTS_PER_IP, locked: true, platformAdmin: false });
    });

    it("leaves out expired counters and anything that isn't a sign-in counter", async () => {
      const report = await listPlatformAdmins(db, now);
      expect(find(report, `lpa-expired-${stamp}@example.com`)).toBeUndefined();
      expect(report.buckets.some((b) => b.subject.includes("register"))).toBe(false);
    });

    it("never reports a lock longer than the window", async () => {
      const report = await listPlatformAdmins(db, now);
      // Only this test's own counters: the clock here is fixed, so a counter
      // another test left running (set against the real clock) would measure
      // as hours long and fail this on the time of day.
      const mine = report.buckets.filter((b) => b.subject.includes(`-${stamp}@`) || b.subject === `203.0.113.${stamp % 250}`);
      expect(mine.length).toBeGreaterThan(0);
      for (const b of mine) expect(b.remainingMs).toBeLessThanOrEqual(LOGIN_WINDOW_MS);
    });
  });

  describe("read-only, and nothing secret", () => {
    it("leaves the database exactly as it found it", async () => {
      const before = [await rawDb.user.count(), await rawDb.rateLimitBucket.count(), await rawDb.twoFactorSecret.count()];
      await listPlatformAdmins(db, now);
      expect([await rawDb.user.count(), await rawDb.rateLimitBucket.count(), await rawDb.twoFactorSecret.count()]).toEqual(before);
      const bucket = await rawDb.rateLimitBucket.findUniqueOrThrow({ where: { key: `login:admin:${bareAdmin}` } });
      expect(bucket.count).toBe(LOGIN_ATTEMPTS_PER_ACCOUNT + 1);
    });

    it("puts no password hash, password or two-factor secret in the report", async () => {
      const hash = (await rawDb.user.findFirstOrThrow({ where: { email: protectedAdmin } })).passwordHash;
      const text = JSON.stringify(await listPlatformAdmins(db, now));
      expect(text).not.toContain(hash);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(SECRET);
      expect(text).not.toMatch(/passwordHash|secret|backupCode/i);
    });

    it("can't write: the script contains no write call and never selects the secret columns", () => {
      const source = readFileSync("prisma/list-platform-admins.ts", "utf8")
        // The header explains what it avoids; only the code is under test.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
      expect(source).not.toMatch(/\$(executeRaw|executeRawUnsafe|queryRawUnsafe|transaction)/);
      // The one raw call is the database's clock: a SELECT, and the only one.
      expect(source.match(/\$queryRaw/g)).toHaveLength(1);
      expect(source).toMatch(/\$queryRaw<[^>]*>`SELECT now\(\) AS now`/);
      expect(source).not.toMatch(/passwordHash|secret\s*:/);
    });
  });

  it("writes a time left a person can read", () => {
    expect(formatRemaining(7 * 60_000)).toBe("7m 00s");
    expect(formatRemaining(7 * 60_000 + 12_000)).toBe("7m 12s");
    expect(formatRemaining(45_000)).toBe("45s");
    expect(formatRemaining(0)).toBe("0s");
    // Rounds up, so "0s left" is never shown for a lock that has not ended.
    expect(formatRemaining(400)).toBe("1s");
  });
});
