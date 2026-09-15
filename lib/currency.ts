import type { TenantDb } from "@/lib/tenant-db";

/**
 * Used only when a clinic has no branding row yet. Every charge, order and
 * price label must otherwise use the clinic's own `TenantBranding.currency` —
 * a hardcoded code at a call site means a clinic gets charged in the wrong
 * currency.
 */
export const DEFAULT_CURRENCY = "EUR";

/** The currency this clinic prices and charges in. */
export async function tenantCurrency(db: TenantDb): Promise<string> {
  const branding = await db.tenantBranding.findFirst({ select: { currency: true } });
  return branding?.currency ?? DEFAULT_CURRENCY;
}
