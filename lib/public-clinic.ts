import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { rawDb } from "@/lib/db";
import { isClientHost } from "@/lib/portal-hosts";

export interface PublicClinic {
  id: string;
  slug: string;
  name: string;
  appIconUrl: string | null;
  logoUrl: string | null;
  color: string | null;
  /** Changes whenever branding changes — used to bust cached icons. */
  version: string;
}

/**
 * The little a stranger may know about a clinic from its app link: name,
 * colour and icon. Only active clinics resolve.
 */
export const getPublicClinic = cache(async (slug: string): Promise<PublicClinic | null> => {
  const tenant = await rawDb.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      branding: { select: { businessName: true, appIconUrl: true, logoUrl: true, primaryColor: true, updatedAt: true } },
    },
  });
  if (!tenant || tenant.status !== "ACTIVE") return null;
  const b = tenant.branding;
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: b?.businessName ?? tenant.name,
    appIconUrl: b?.appIconUrl ?? null,
    logoUrl: b?.logoUrl ?? null,
    color: b?.primaryColor ?? null,
    version: String(b?.updatedAt.getTime() ?? 0),
  };
});

/**
 * Where this clinic's app lives on the host the request came in on: "/riverside"
 * on the root domain, "/app/riverside" everywhere else. The installable app's
 * scope and icons have to match the address the client is actually using.
 */
export function clientBasePath(slug: string, host: string | null | undefined): string {
  return isClientHost(host) ? `/${encodeURIComponent(slug)}` : `/app/${encodeURIComponent(slug)}`;
}


/** The clinic app's base path for the request being handled. */
export async function currentClientBasePath(slug: string): Promise<string> {
  const requestHeaders = await headers();
  return clientBasePath(slug, requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"));
}


/** Home-screen label: iOS truncates past roughly 12 characters. */
export function shortAppName(name: string): string {
  return name.length <= 12 ? name : name.split(/\s+/)[0]!.slice(0, 12);
}
