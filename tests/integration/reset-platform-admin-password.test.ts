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
