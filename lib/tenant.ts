import "server-only";
import { notFound } from "next/navigation";
import { rawDb } from "@/lib/db";

/** Public tenant + branding lookup for the customer-facing app shell. Read-only, no auth required. */
export async function getTenantBySlug(slug: string) {
  const tenant = await rawDb.tenant.findUnique({
    where: { slug },
    include: { branding: true, settings: true },
  });
  if (!tenant || tenant.status !== "ACTIVE") return null;
  return tenant;
}

export async function getTenantBySlugOrNotFound(slug: string) {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  return tenant;
}

export type TenantWithBranding = NonNullable<Awaited<ReturnType<typeof getTenantBySlug>>>;
