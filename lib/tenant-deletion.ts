import "server-only";
import { rawDb } from "@/lib/db";
import { deleteTenantDependents } from "@/lib/tenant-cascade";

/**
 * Deletes a clinic and everything it owns, atomically.
 *
 * Most tenant data goes with the tenant through ON DELETE CASCADE; the
 * handful of relations that refuse deletion while history points at a row go
 * first, in order, and that order lives in lib/tenant-cascade.ts so the
 * operator's reset (prisma/reset-platform.ts) uses the same one. Add a new
 * NoAction/Restrict relation between tenant rows and you add its dependent
 * there; tests/integration/merchant-deletion.test.ts fails until you do.
 */
export async function deleteTenantCompletely(tenantId: string): Promise<void> {
  await rawDb.$transaction(async (tx) => {
    await deleteTenantDependents(tx, tenantId);
    await tx.tenant.delete({ where: { id: tenantId } });
  });
}
