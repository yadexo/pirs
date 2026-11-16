import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { DEFAULT_TIME_ZONE } from "@/lib/time-zone";

/**
 * The clinic's time zone (TenantBranding.timeZone, set in clinic settings).
 * Every day and wall-clock time of a clinic is read in this zone — never the
 * server's, which is UTC in production.
 */
export async function clinicZone(db: TenantDb): Promise<string> {
  const branding = await db.tenantBranding.findFirst({ where: {}, select: { timeZone: true } });
  return branding?.timeZone || DEFAULT_TIME_ZONE;
}
