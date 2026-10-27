import type { TenantDb } from "@/lib/tenant-db";

/**
 * Every currency a clinic may actually be billed in. Keep this in sync with
 * the dropdown in App Builder → Settings → Branding (saveBrandingAction,
 * lib/actions/clinic-settings.ts) and the platform admin's "Add merchant"
 * form (lib/actions/merchants.ts) — those are the only two places a value
 * outside this set could ever get written.
 */
export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function isCurrency(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Used only when a clinic has no branding row yet, or (defensively) if a row
 * somehow holds a value outside SUPPORTED_CURRENCIES. Every charge, order and
 * price label must otherwise use the clinic's own `TenantBranding.currency` —
 * a hardcoded code at a call site means a clinic gets charged in the wrong
 * currency.
 */
export const DEFAULT_CURRENCY: Currency = "EUR";

/** The currency this clinic prices and charges in. */
export async function tenantCurrency(db: TenantDb): Promise<Currency> {
  const branding = await db.tenantBranding.findFirst({ select: { currency: true } });
  const value = branding?.currency;
  return value && isCurrency(value) ? value : DEFAULT_CURRENCY;
}
