import "server-only";
import { rawDb } from "@/lib/db";

/**
 * Deletes a clinic and everything it owns, atomically.
 *
 * Most tenant data goes with the tenant through ON DELETE CASCADE. Eight
 * relations deliberately refuse deletion while history points at a row
 * (an appointment keeps its treatment, a member keeps their plan) — and
 * Postgres enforces those inside the cascade, so a plain tenant delete fails
 * for any clinic that has actually been used. Those dependents are removed
 * first, in order, then the tenant.
 *
 * Adding a NoAction/Restrict relation between tenant rows? Add its dependent
 * here. tests/integration/merchant-deletion.test.ts fails until you do.
 */
export async function deleteTenantCompletely(tenantId: string): Promise<void> {
  await rawDb.$transaction(async (tx) => {
    // Rows that reference a service, staff member or location.
    await tx.appointment.deleteMany({ where: { tenantId } });
    // Rows that reference a package or plan.
    await tx.customerPackage.deleteMany({ where: { tenantId } });
    await tx.customerMembership.deleteMany({ where: { tenantId } });
    // Package contents reference services; they have no tenant column of their own.
    await tx.packageItem.deleteMany({ where: { package: { tenantId } } });
    // Catalogue rows that reference categories.
    await tx.catalogItemTag.deleteMany({ where: { OR: [{ service: { tenantId } }, { product: { tenantId } }] } });
    await tx.clientResult.deleteMany({ where: { tenantId } });
    await tx.catalogTag.deleteMany({ where: { tenantId } });
    await tx.service.deleteMany({ where: { tenantId } });
    await tx.product.deleteMany({ where: { tenantId } });

    await tx.tenant.delete({ where: { id: tenantId } });
  });
}
