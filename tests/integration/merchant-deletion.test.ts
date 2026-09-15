import { describe, it, expect } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

/**
 * Deleting a clinic must remove everything it owns in one go. Relations that
 * are ON DELETE RESTRICT inside that cascade can block it — the agency's
 * "Delete merchant" then fails for any clinic that has actually been used.
 */
describe("deleting a clinic", () => {
  it("removes a fully used clinic and everything it owns", async () => {
    const stamp = Date.now();
    const tenant = await rawDb.tenant.create({ data: { slug: `del-${stamp}`, name: "To delete" } });
    const tenantId = tenant.id;

    const location = await rawDb.location.create({ data: { tenantId, name: "Main" } });
    const svcCat = await rawDb.serviceCategory.create({ data: { tenantId, name: "General" } });
    const service = await rawDb.service.create({ data: { tenantId, categoryId: svcCat.id, name: "Consult", durationMinutes: 30, priceCents: 5000 } });
    const prodCat = await rawDb.productCategory.create({ data: { tenantId, name: "Care" } });
    await rawDb.product.create({ data: { tenantId, categoryId: prodCat.id, name: "Serum", sku: `S-${stamp}`, priceCents: 2000 } });

    const staffUser = await rawDb.user.create({ data: { tenantId, email: `st-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } });
    const staff = await rawDb.staffProfile.create({ data: { tenantId, userId: staffUser.id, firstName: "S", lastName: "T" } });

    const clientUser = await rawDb.user.create({ data: { tenantId, email: `cl-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    const client = await rawDb.customerProfile.create({ data: { tenantId, userId: clientUser.id, firstName: "C", lastName: "L" } });

    await rawDb.appointment.create({
      data: { tenantId, customerProfileId: client.id, serviceId: service.id, staffProfileId: staff.id, locationId: location.id, startAt: new Date(), endAt: new Date(Date.now() + 18e5) },
    });

    const plan = await rawDb.membershipPlan.create({ data: { tenantId, name: "Gold", billingFrequency: "MONTHLY", priceCents: 4900 } });
    await rawDb.customerMembership.create({ data: { tenantId, customerProfileId: client.id, membershipPlanId: plan.id, currentPeriodEnd: new Date(Date.now() + 864e5) } });

    const pkg = await rawDb.package.create({ data: { tenantId, name: "Bundle", priceCents: 20000, totalUses: 5 } });
    await rawDb.packageItem.create({ data: { packageId: pkg.id, serviceId: service.id } });
    await rawDb.customerPackage.create({ data: { tenantId, customerProfileId: client.id, packageId: pkg.id, remainingUses: 5, totalUses: 5 } as never });

    // Individual deletes are still refused while history points at the row:
    // a treatment with appointments, a plan with members, a package a client owns.
    await expect(rawDb.service.delete({ where: { id: service.id } })).rejects.toThrow(/Foreign key constraint/);
    await expect(rawDb.membershipPlan.delete({ where: { id: plan.id } })).rejects.toThrow(/Foreign key constraint/);
    await expect(rawDb.serviceCategory.delete({ where: { id: svcCat.id } })).rejects.toThrow(/Foreign key constraint/);

    await deleteTenantCompletely(tenantId);

    expect(await rawDb.tenant.findUnique({ where: { id: tenantId } })).toBeNull();
    for (const count of [
      rawDb.service.count({ where: { tenantId } }),
      rawDb.appointment.count({ where: { tenantId } }),
      rawDb.customerMembership.count({ where: { tenantId } }),
      rawDb.package.count({ where: { tenantId } }),
      rawDb.user.count({ where: { tenantId } }),
    ]) {
      expect(await count).toBe(0);
    }
  });
});
