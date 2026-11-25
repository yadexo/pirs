/**
 * A package's saving is measured against what this viewer would pay.
 *
 * For a non-member the catalog compared the package with the *member* price
 * of a single session — the "Members pay €135" teaser — so a 5-session pack
 * at €650 for €150 sessions said "Save €25" instead of "Save €100"
 * (docs/qa/bug-hunt-2026-11.md, S1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { getCatalog } from "@/lib/client-app-catalog";

describe("package savings for a non-member", () => {
  const stamp = Date.now();
  let tenantId: string;
  let profileId: string;
  let packageId: string;

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug: `pkgsave-${stamp}`, name: "Pkg Save" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId, businessName: "Pkg Save", currency: "EUR" } });
    const category = await rawDb.serviceCategory.create({ data: { tenantId, name: "Physio" } });
    const service = await rawDb.service.create({ data: { tenantId, categoryId: category.id, name: "PT", durationMinutes: 60, priceCents: 15_000 } });
    // A plan that discounts treatments by 10%, so a non-member sees a member teaser price.
    await rawDb.membershipPlan.create({ data: { tenantId, name: "Plus", billingFrequency: "MONTHLY", priceCents: 4_900, serviceDiscountPercent: 10 } });
    packageId = (
      await rawDb.package.create({ data: { tenantId, name: "5 × PT", priceCents: 65_000, totalUses: 5, active: true, items: { create: [{ serviceId: service.id, quantity: 1 }] } } as never })
    ).id;
    const user = await rawDb.user.create({ data: { tenantId, email: `ps-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    profileId = (await rawDb.customerProfile.create({ data: { tenantId, userId: user.id, firstName: "Nora", lastName: "Non" } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });

  it("compares with the €150 the non-member pays for a session, not the €135 member price", async () => {
    const catalog = await getCatalog(getTenantDb(tenantId), { tenantId, customerProfileId: profileId, inAppBookings: false });
    const pack = catalog.packages.find((p) => p.id === packageId)!;
    expect(catalog.isMember).toBe(false);
    expect(pack.savingCents).toBe(5 * 15_000 - 65_000);
  });
});
