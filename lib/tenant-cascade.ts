import type { Prisma } from "@prisma/client";

/**
 * The rows that have to go before a clinic's own row can, in the order they
 * have to go in.
 *
 * Most of a clinic's data follows it through ON DELETE CASCADE. Eight relations
 * deliberately refuse deletion while history points at a row (an appointment
 * keeps its treatment, a member keeps their plan), and Postgres enforces those
 * *inside* the cascade — so a plain `tenant.delete` fails for any clinic that
 * has actually been used.
 *
 * Deliberately free of `server-only` and of any Prisma client of its own, so
 * the two callers can share one list rather than keeping two in step:
 * lib/tenant-deletion.ts (the agency's "delete this clinic" button) and
 * prisma/reset-platform.ts (the operator's reset, which runs under plain tsx
 * where `server-only` cannot even be resolved).
 *
 * Adding a NoAction/Restrict relation between tenant rows? Add its dependent
 * here. tests/integration/merchant-deletion.test.ts fails until you do.
 */
export async function deleteTenantDependents(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
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
}
