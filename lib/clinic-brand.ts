import "server-only";
import { cache } from "react";
import { rawDb } from "@/lib/db";

/** What a page needs to look like a clinic's own: its name, logo and colour. */
export interface ClinicBrand {
  name: string;
  logoUrl: string | null;
  color: string | null;
}

const lookup = cache(async (slug: string) =>
  rawDb.tenant.findUnique({
    where: { slug },
    select: { name: true, status: true, branding: { select: { businessName: true, logoUrl: true, primaryColor: true } } },
  }),
);

function brandOf(tenant: NonNullable<Awaited<ReturnType<typeof lookup>>>): ClinicBrand {
  return { name: tenant.branding?.businessName ?? tenant.name, logoUrl: tenant.branding?.logoUrl ?? null, color: tenant.branding?.primaryColor ?? null };
}

/**
 * The clinic's brand when it is suspended, otherwise null. Its app then says
 * it is temporarily unavailable, in the clinic's own colours, rather than a
 * bare 404 that reads as "this clinic never existed". Why it is suspended is
 * between the clinic and the platform, and is not shown.
 */
export async function getSuspendedClinic(slug: string): Promise<ClinicBrand | null> {
  const tenant = await lookup(slug);
  return tenant?.status === "SUSPENDED" ? brandOf(tenant) : null;
}

/**
 * The brand for a page shown on a clinic's own domain, where the host already
 * says whose it is: an active or suspended clinic. A clinic still being set
 * up (PENDING) has no public face yet.
 */
export async function getClinicBrand(slug: string): Promise<ClinicBrand | null> {
  const tenant = await lookup(slug);
  return tenant && (tenant.status === "ACTIVE" || tenant.status === "SUSPENDED") ? brandOf(tenant) : null;
}
