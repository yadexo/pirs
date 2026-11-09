/**
 * The operator's reset: what it says it would do, and what it actually does.
 *
 * !! This file empties the test database of clinics and platform admins. That
 * is safe only because vitest.config.ts sets fileParallelism: false — test
 * files run one at a time, and every other file builds its own fixtures in
 * beforeAll when its turn comes. Keep it that way, and do not add a test here
 * that leans on rows another file left behind.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { rawDb } from "@/lib/db";

vi.mock("server-only", () => ({}));
const { applyReset, confirmationPhrase, databaseHost, planReset, tableCounts } = await import("../../prisma/reset-platform");

const db = rawDb as unknown as PrismaClient;
const stamp = Date.now();

describe("what the reset would delete", () => {
  let usedClinicId: string;
  let plainClinicId: string;
  let adminId: string;
  let secondAdminId: string;
  let ownerId: string;
  let clientId: string;

  beforeAll(async () => {
    // A clinic that has actually been used: a package whose contents point at
    // a service, which is one of the relations Postgres refuses to cascade
    // through, so a plain tenant.delete on it fails.
    usedClinicId = (await rawDb.tenant.create({ data: { slug: `rp-used-${stamp}`, name: "Used Clinic", stripeAccountId: `acct_rp_${stamp}` } })).id;
    const category = await rawDb.serviceCategory.create({ data: { tenantId: usedClinicId, name: "Treatments" } });
    const service = await rawDb.service.create({
      data: { tenantId: usedClinicId, categoryId: category.id, name: "A treatment", durationMinutes: 30, priceCents: 5000 },
    });
    const pkg = await rawDb.package.create({ data: { tenantId: usedClinicId, name: "A package", priceCents: 10000, totalUses: 3 } });
    await rawDb.packageItem.create({ data: { packageId: pkg.id, serviceId: service.id } });

    plainClinicId = (await rawDb.tenant.create({ data: { slug: `rp-plain-${stamp}`, name: "Plain Clinic" } })).id;

    adminId = (await rawDb.user.create({ data: { email: `rp-admin-${stamp}@example.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
    secondAdminId = (await rawDb.user.create({ data: { email: `rp-admin2-${stamp}@example.com`, passwordHash: "x", role: "PLATFORM_ADMIN", status: "DISABLED" } })).id;
    ownerId = (await rawDb.user.create({ data: { tenantId: plainClinicId, email: `rp-owner-${stamp}@example.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    clientId = (await rawDb.user.create({ data: { tenantId: plainClinicId, email: `rp-client-${stamp}@example.com`, passwordHash: "x", role: "CUSTOMER" } })).id;

    // The admin onboarded one of the clinics, and left a trail at platform level.
    await rawDb.tenant.update({ where: { id: plainClinicId }, data: { createdByUserId: adminId } });
    await rawDb.auditLog.create({ data: { tenantId: null, actorUserId: adminId, actorType: "PLATFORM_ADMIN", action: `rp.test.${stamp}`, entityType: "User", entityId: adminId } });
    await rawDb.twoFactorSecret.create({ data: { userId: adminId, secret: `SECRET${stamp}`, confirmedAt: new Date() } });
    // A sign-in counter for that admin, and one for somebody else.
    await rawDb.rateLimitBucket.createMany({
      data: [
        { key: `login:admin:rp-admin-${stamp}@example.com`, count: 11, resetAt: new Date(Date.now() + 600_000) },
        { key: `login:ip:203.0.113.${stamp % 200}`, count: 2, resetAt: new Date(Date.now() + 600_000) },
      ],
    });
    if ((await rawDb.agencySettings.count()) === 0) await rawDb.agencySettings.create({ data: { name: "Deza" } });
  });

  it("names the database in a phrase that cannot be true of another one", () => {
    expect(confirmationPhrase("ep-frosty-cloud-zal3mzce.eu-central-1.aws.neon.tech")).toBe("delete everything on ep-frosty-cloud-zal3mzce.eu-central-1.aws.neon.tech");
    expect(databaseHost("postgresql://user:pw@ep-frosty.neon.tech:5432/neondb?sslmode=require")).toBe("ep-frosty.neon.tech");
  });

  it("refuses to name a database it cannot read", () => {
    expect(() => databaseHost(undefined)).toThrow(/DATABASE_URL is not set/);
    expect(() => databaseHost("not-a-url")).toThrow(/could not be read/);
  });

  it("lists every clinic, with the Stripe account it would orphan", async () => {
    const plan = await planReset(db);
    const used = plan.clinics.find((c) => c.id === usedClinicId);
    expect(used).toMatchObject({ slug: `rp-used-${stamp}`, name: "Used Clinic", stripeAccountId: `acct_rp_${stamp}` });
    expect(plan.clinics.map((c) => c.id)).toContain(plainClinicId);
  });

  it("lists every platform admin, active or not, and nobody else", async () => {
    const plan = await planReset(db);
    const emails = plan.platformAdmins.map((a) => a.email);
    expect(emails).toContain(`rp-admin-${stamp}@example.com`);
    expect(emails).toContain(`rp-admin2-${stamp}@example.com`);
    expect(emails).not.toContain(`rp-owner-${stamp}@example.com`);
    expect(plan.platformAdmins.find((a) => a.email === `rp-admin2-${stamp}@example.com`)!.status).toBe("DISABLED");
  });

  it("counts rows per table, leaving out the empty ones and Prisma's own", async () => {
    const plan = await planReset(db);
    const byTable = Object.fromEntries(plan.counts.map((c) => [c.table, c.rows]));
    expect(byTable.Tenant).toBeGreaterThanOrEqual(2);
    expect(byTable.User).toBeGreaterThanOrEqual(4);
    expect(plan.counts.every((c) => c.rows > 0)).toBe(true);
    expect(plan.counts.map((c) => c.table)).not.toContain("_prisma_migrations");
  });

  it("says what it is keeping, including the permission catalogue", async () => {
    const plan = await planReset(db);
    expect(plan.kept.agencySettings).toBeGreaterThan(0);
    expect(plan.kept.permissions).toBeGreaterThan(0);
    expect(plan.kept.platformAuditLogs).toBeGreaterThan(0);
  });

  it("changes nothing while planning", async () => {
    const before = [await rawDb.tenant.count(), await rawDb.user.count(), await rawDb.auditLog.count()];
    await planReset(db);
    await tableCounts(db);
    expect([await rawDb.tenant.count(), await rawDb.user.count(), await rawDb.auditLog.count()]).toEqual(before);
  });

  // Everything above reads. From here on the database is emptied, so this is
  // deliberately the last test in the file.
  describe("and then actually deleting it", () => {
    it("removes every clinic and every platform admin, and keeps what it promised", async () => {
      const plan = await planReset(db);
      const agencyBefore = await rawDb.agencySettings.count();
      const permissionsBefore = await rawDb.permission.count();

      const result = await applyReset(db, plan);

      expect(result.clinicsDeleted).toHaveLength(plan.clinics.length);
      expect(result.adminsDeleted).toBe(plan.platformAdmins.length);
      // The used clinic went too, so the ordered deletes did their job — a
      // plain tenant.delete on it would have been refused by Postgres.
      expect(await rawDb.tenant.count()).toBe(0);
      expect(await rawDb.user.count({ where: { role: "PLATFORM_ADMIN" } })).toBe(0);
      // Clinic accounts go with their clinic, by cascade.
      expect(await rawDb.user.count()).toBe(0);
      for (const id of [ownerId, clientId, adminId, secondAdminId]) {
        expect(await rawDb.user.findUnique({ where: { id } })).toBeNull();
      }
      expect(await rawDb.twoFactorSecret.count()).toBe(0);

      expect(await rawDb.agencySettings.count()).toBe(agencyBefore);
      expect(await rawDb.permission.count()).toBe(permissionsBefore);
    });

    it("keeps the platform's audit trail, with the deleted actor nulled out", async () => {
      const row = await rawDb.auditLog.findFirstOrThrow({ where: { action: `rp.test.${stamp}` } });
      expect(row.actorUserId).toBeNull();
      expect(row.actorType).toBe("PLATFORM_ADMIN");
    });

    it("clears the deleted admins' own sign-in counters, and nobody else's", async () => {
      expect(await rawDb.rateLimitBucket.count({ where: { key: { endsWith: `:rp-admin-${stamp}@example.com` } } })).toBe(0);
      expect(await rawDb.rateLimitBucket.count({ where: { key: `login:ip:203.0.113.${stamp % 200}` } })).toBe(1);
      await rawDb.rateLimitBucket.deleteMany({ where: { key: `login:ip:203.0.113.${stamp % 200}` } });
    });

    it("reports the rows that are left, and running it again is a no-op", async () => {
      const plan = await planReset(db);
      expect(plan.clinics).toEqual([]);
      expect(plan.platformAdmins).toEqual([]);
      const again = await applyReset(db, plan);
      expect(again).toMatchObject({ clinicsDeleted: [], adminsDeleted: 0 });
      expect(again.countsAfter.map((c) => c.table)).not.toContain("Tenant");
    });
  });
});
