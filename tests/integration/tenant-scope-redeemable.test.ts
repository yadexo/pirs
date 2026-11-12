/**
 * One clinic's view of collected items, with another clinic's rows in the
 * same table.
 *
 * The query below is the one on the Shop page
 * (app/m/[merchantId]/shop/page.tsx). It has no clinic in its `where`, because
 * the scoped client is supposed to add one — and for RedeemableItem it did
 * not, so every clinic saw the platform's last 25 collections: other clinics'
 * client names, notes and staff (docs/security/review-2026-11.md, T-1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

describe("collected items stay inside the clinic", () => {
  const stamp = Date.now();
  let mine: string;
  let theirs: string;
  let theirClient: string;
  let myService: string;
  let theirService: string;

  const clinic = async (tag: string) => {
    const tenant = await rawDb.tenant.create({ data: { slug: `scope-${tag}-${stamp}`, name: `Scope ${tag}` } });
    const user = await rawDb.user.create({ data: { tenantId: tenant.id, email: `scope-${tag}-${stamp}@example.com`, passwordHash: "x", role: "CUSTOMER" } });
    const profile = await rawDb.customerProfile.create({ data: { tenantId: tenant.id, userId: user.id, firstName: "Client", lastName: `Of-${tag}` } });
    const category = await rawDb.serviceCategory.create({ data: { tenantId: tenant.id, name: "Treatments" } });
    const service = await rawDb.service.create({ data: { tenantId: tenant.id, categoryId: category.id, name: `Treatment ${tag}`, priceCents: 10_000, durationMinutes: 30 } });
    await rawDb.redeemableItem.create({
      data: {
        tenantId: tenant.id,
        customerProfileId: profile.id,
        unitIndex: 0,
        source: "GIFT",
        itemType: "SERVICE",
        name: `Item of ${tag}`,
        token: `tok-${tag}-${stamp}`,
        code: `${tag.slice(0, 2).toUpperCase()}${String(stamp).slice(-6)}`,
        status: "REDEEMED",
        redeemedAt: new Date(),
        redemptionNote: `private note of ${tag}`,
      } as never,
    });
    await rawDb.priceHistory.create({ data: { tenantId: tenant.id, itemType: "SERVICE", serviceId: service.id, priceCents: 10_000 } as never });
    return { tenantId: tenant.id, profileId: profile.id, serviceId: service.id };
  };

  beforeAll(async () => {
    const a = await clinic("mine");
    const b = await clinic("theirs");
    mine = a.tenantId;
    myService = a.serviceId;
    theirs = b.tenantId;
    theirClient = b.profileId;
    theirService = b.serviceId;
  });

  afterAll(async () => {
    for (const id of [mine, theirs]) await deleteTenantCompletely(id).catch(() => undefined);
  });

  it("the Shop page's query returns this clinic's collections and nobody else's", async () => {
    const rows = await getTenantDb(mine).redeemableItem.findMany({
      where: { status: "REDEEMED" },
      orderBy: { redeemedAt: "desc" },
      take: 25,
      select: { name: true, tenantId: true, redemptionNote: true, customerProfile: { select: { lastName: true } } },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenantId === mine)).toBe(true);
    expect(rows.map((row) => row.name)).not.toContain("Item of theirs");
    expect(JSON.stringify(rows)).not.toContain("private note of theirs");
  });

  it("cannot count, find or change another clinic's item, even by its id", async () => {
    const db = getTenantDb(mine);
    const foreign = await rawDb.redeemableItem.findFirstOrThrow({ where: { tenantId: theirs } });

    expect(await db.redeemableItem.count({ where: { customerProfileId: theirClient } })).toBe(0);
    expect(await db.redeemableItem.findFirst({ where: { id: foreign.id } })).toBeNull();

    const changed = await db.redeemableItem.updateMany({ where: { id: foreign.id }, data: { status: "VOIDED" } });
    expect(changed.count).toBe(0);
    expect((await rawDb.redeemableItem.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe("REDEEMED");
  });

  it("price history is the clinic's own, with no filter written by the caller", async () => {
    // The shop loads "the whole history" (lib/client-app-catalog.ts). Whole
    // means this clinic's, not the platform's.
    const rows = await getTenantDb(mine).priceHistory.findMany({ select: { serviceId: true } });
    expect(rows.map((row) => row.serviceId)).toContain(myService);
    expect(rows.map((row) => row.serviceId)).not.toContain(theirService);
  });
});
