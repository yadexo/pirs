import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createPlatformAdmin } from "../../prisma/create-platform-admin";

describe("create-platform-admin script", () => {
  const stamp = Date.now();
  const email = `Owner-${stamp}@Example.com`;
  const db = rawDb as unknown as PrismaClient;

  afterAll(async () => {
    await rawDb.user.deleteMany({ where: { email: { startsWith: `owner-${stamp}` } } });
    await rawDb.user.deleteMany({ where: { email: `second-${stamp}@example.com` } });
  });

  it("creates exactly one platform admin with a working password, and nothing else", async () => {
    const tenantsBefore = await rawDb.tenant.count();
    const usersBefore = await rawDb.user.count();

    const user = await createPlatformAdmin(db, { email, password: "a-long-enough-password", allowAdditional: true });

    const saved = await rawDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved).toMatchObject({ email: email.toLowerCase(), role: "PLATFORM_ADMIN", tenantId: null, status: "ACTIVE" });
    expect(await verifyPassword("a-long-enough-password", saved.passwordHash)).toBe(true);
    expect(await rawDb.tenant.count()).toBe(tenantsBefore);
    expect(await rawDb.user.count()).toBe(usersBefore + 1);
  });

  it("refuses an email already used by a staff-type account", async () => {
    await expect(createPlatformAdmin(db, { email, password: "a-long-enough-password", allowAdditional: true })).rejects.toThrow(/already has a PLATFORM_ADMIN account/);
  });

  it("refuses a second platform admin unless asked for one", async () => {
    await expect(createPlatformAdmin(db, { email: `second-${stamp}@example.com`, password: "a-long-enough-password" })).rejects.toThrow(/already has .* platform admin/);
    expect(await rawDb.user.count({ where: { email: `second-${stamp}@example.com` } })).toBe(0);
  });

  it("rejects short passwords and bad emails before touching the database", async () => {
    await expect(createPlatformAdmin(db, { email: `x-${stamp}@example.com`, password: "short", allowAdditional: true })).rejects.toThrow(/at least 12/);
    await expect(createPlatformAdmin(db, { email: "not-an-email", password: "a-long-enough-password", allowAdditional: true })).rejects.toThrow(/valid email/);
  });
});
