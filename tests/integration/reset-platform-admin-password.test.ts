import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { rawDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { resetPlatformAdminPassword } from "../../prisma/reset-platform-admin-password";

describe("reset-platform-admin-password script", () => {
  const stamp = Date.now();
  const adminEmail = `reset-admin-${stamp}@example.com`;
  const otherAdminEmail = `reset-other-${stamp}@example.com`;
  const clinicOwnerEmail = `reset-owner-${stamp}@example.com`;
  const disabledEmail = `reset-disabled-${stamp}@example.com`;
  const db = rawDb as unknown as PrismaClient;
  let clinicId: string;

  beforeAll(async () => {
    const oldHash = await hashPassword("the-old-password-123");
    await rawDb.user.create({ data: { email: adminEmail, passwordHash: oldHash, role: "PLATFORM_ADMIN" } });
    await rawDb.user.create({ data: { email: otherAdminEmail, passwordHash: oldHash, role: "PLATFORM_ADMIN" } });
    await rawDb.user.create({ data: { email: disabledEmail, passwordHash: oldHash, role: "PLATFORM_ADMIN", status: "DISABLED" } });
    clinicId = (await rawDb.tenant.create({ data: { slug: `reset-${stamp}`, name: "Reset Clinic" } })).id;
    await rawDb.user.create({ data: { tenantId: clinicId, email: clinicOwnerEmail, passwordHash: oldHash, role: "TENANT_ADMIN" } });
  });

  afterAll(async () => {
    await rawDb.user.deleteMany({ where: { email: { in: [adminEmail, otherAdminEmail, disabledEmail, clinicOwnerEmail] } } });
    await rawDb.tenant.delete({ where: { id: clinicId } });
    await rawDb.rateLimitBucket.deleteMany({ where: { key: { contains: `${stamp}@example.com` } } });
  });

  it("sets the new password and signs out old sessions for that admin only", async () => {
    const now = new Date();
    const before = await rawDb.user.findFirstOrThrow({ where: { email: otherAdminEmail } });

    await resetPlatformAdminPassword(db, { email: adminEmail.toUpperCase(), password: "a-brand-new-password" }, now);

    const admin = await rawDb.user.findFirstOrThrow({ where: { email: adminEmail } });
    expect(await verifyPassword("a-brand-new-password", admin.passwordHash)).toBe(true);
    expect(await verifyPassword("the-old-password-123", admin.passwordHash)).toBe(false);
    expect(admin.sessionsValidAfter?.getTime()).toBe(now.getTime());
    expect(admin).toMatchObject({ role: "PLATFORM_ADMIN", status: "ACTIVE", tenantId: null });

    // The other admin is untouched.
    const other = await rawDb.user.findFirstOrThrow({ where: { email: otherAdminEmail } });
    expect(other.passwordHash).toBe(before.passwordHash);
    expect(other.sessionsValidAfter).toBeNull();
  });

  describe("which clock stamps the sign-out", () => {
    /**
     * The same database, but its clock reads 2031. If the script took the time
     * from the computer it runs on, the stamp would be today's; it takes it
     * from the database, so it is 2031. That is the whole point: the app
     * compares this stamp with the moment a later sign-in began, measured on
     * the server next to the database, so a PC clock that ran ahead would have
     * every sign-in for the next while refused as "from before the reset".
     */
    const databaseSays = new Date("2031-01-02T03:04:05.000Z");
    function withDatabaseClock(real: PrismaClient, clock: Date): PrismaClient {
      const bound = (target: object, prop: string | symbol) => {
        const value = (target as Record<string | symbol, unknown>)[prop];
        return typeof value === "function" ? value.bind(target) : value;
      };
      return new Proxy(real, {
        get(target, prop) {
          if (prop !== "$transaction") return bound(target, prop);
          return (run: (tx: unknown) => Promise<unknown>) =>
            target.$transaction((tx) =>
              run(
                new Proxy(tx, {
                  get: (t, p) => (p === "$queryRaw" ? async () => [{ now: clock }] : bound(t, p)),
                }),
              ),
            );
        },
      });
    }

    it("is the database's, not the computer's", async () => {
      await resetPlatformAdminPassword(withDatabaseClock(db, databaseSays), { email: adminEmail, password: "another-new-password-1" });
      const admin = await rawDb.user.findFirstOrThrow({ where: { email: adminEmail } });
      expect(admin.sessionsValidAfter?.toISOString()).toBe(databaseSays.toISOString());
    });

    it("reads the real database's clock when nothing is injected", async () => {
      const dbNow = (await rawDb.$queryRaw<{ now: Date }[]>`SELECT now() AS now`)[0]!.now;
      await resetPlatformAdminPassword(db, { email: adminEmail, password: "yet-another-new-password-1" });
      const stamped = (await rawDb.user.findFirstOrThrow({ where: { email: adminEmail } })).sessionsValidAfter!;
      // Within seconds of the database's own now(), on whichever side of it.
      expect(Math.abs(stamped.getTime() - dbNow.getTime())).toBeLessThan(10_000);
    });

    it("is never later than the database's clock a moment afterwards — so a sign-in that follows is never refused", async () => {
      await resetPlatformAdminPassword(db, { email: adminEmail, password: "one-more-new-password-1" });
      const stamped = (await rawDb.user.findFirstOrThrow({ where: { email: adminEmail } })).sessionsValidAfter!;
      const later = (await rawDb.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
      expect(stamped.getTime()).toBeLessThanOrEqual(later.getTime());
    });
  });

  it("refuses clinic accounts, unknown emails and disabled admins, changing nothing", async () => {
    const owner = await rawDb.user.findFirstOrThrow({ where: { email: clinicOwnerEmail } });
    await expect(resetPlatformAdminPassword(db, { email: clinicOwnerEmail, password: "a-brand-new-password" })).rejects.toThrow(/TENANT_ADMIN account, not a platform admin/);
    expect((await rawDb.user.findFirstOrThrow({ where: { email: clinicOwnerEmail } })).passwordHash).toBe(owner.passwordHash);

    await expect(resetPlatformAdminPassword(db, { email: `nobody-${stamp}@example.com`, password: "a-brand-new-password" })).rejects.toThrow(/no platform admin/);

    const disabled = await rawDb.user.findFirstOrThrow({ where: { email: disabledEmail } });
    await expect(resetPlatformAdminPassword(db, { email: disabledEmail, password: "a-brand-new-password" })).rejects.toThrow(/DISABLED/);
    expect((await rawDb.user.findFirstOrThrow({ where: { email: disabledEmail } })).passwordHash).toBe(disabled.passwordHash);
  });

  it("rejects short passwords before touching the database", async () => {
    await expect(resetPlatformAdminPassword(db, { email: adminEmail, password: "short" })).rejects.toThrow(/at least 12/);
  });

  it("clears only this email's sign-in lockout, and only when asked", async () => {
    const future = new Date(Date.now() + 10 * 60_000);
    await rawDb.rateLimitBucket.createMany({
      data: [
        { key: `login:unified:${adminEmail}`, count: 11, resetAt: future },
        { key: `login:unified:${otherAdminEmail}`, count: 11, resetAt: future },
      ],
    });

    await resetPlatformAdminPassword(db, { email: adminEmail, password: "a-brand-new-password" });
    expect(await rawDb.rateLimitBucket.count({ where: { key: `login:unified:${adminEmail}` } })).toBe(1);

    const result = await resetPlatformAdminPassword(db, { email: adminEmail, password: "a-brand-new-password", clearLockout: true });
    expect(result.lockoutCleared).toBe(1);
    expect(await rawDb.rateLimitBucket.count({ where: { key: `login:unified:${adminEmail}` } })).toBe(0);
    expect(await rawDb.rateLimitBucket.count({ where: { key: `login:unified:${otherAdminEmail}` } })).toBe(1);
  });
});
