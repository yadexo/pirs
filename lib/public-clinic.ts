import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { rawDb } from "@/lib/db";
import { CLINIC_HOST_HEADER, clientAppScope, isClientHost } from "@/lib/portal-hosts";

export interface PublicClinic {
  id: string;
  slug: string;
  name: string;
  appIconUrl: string | null;
  logoUrl: string | null;
  color: string | null;
  /** "brand" | "white" — the launch screen's background behind the logo. */
  launchBackground: string;
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
      branding: { select: { businessName: true, appIconUrl: true, logoUrl: true, primaryColor: true, launchBackground: true, updatedAt: true } },
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
    launchBackground: b?.launchBackground ?? "brand",
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


/**
 * The clinic app's base path for the request being handled.
 *
 * On the clinic's own domain the whole host is that clinic, so the base path
 * is "/" — there is no slug in the address at all. Only the middleware knows
 * a host belongs to a clinic, and it says so in a header it controls.
 */
export async function currentClientBasePath(slug: string): Promise<string> {
  return (await currentClientAppPaths(slug)).base;
}

/**
 * Where this clinic's app lives for the request being handled, and the scope
 * the installed app registers.
 *
 * One function because the two have to agree: a scope that does not contain
 * the base path drops the client out of the installed app and into a browser
 * with an address bar. On a clinic's own domain both are "/", because the
 * host is the app.
 */
export async function currentClientAppPaths(slug: string): Promise<{ base: string; scope: string }> {
  return clientAppPathsFor(slug, await headers());
}

/**
 * The same, from a set of request headers — for a route handler, which has
 * the request in its hand and should read it rather than ask for it again.
 */
export function clientAppPathsFor(slug: string, requestHeaders: Headers): { base: string; scope: string } {
  // An empty base, not "/", and the contract is the one the other two values
  // already keep: a base never ends in a slash, so every `${base}/shop` in
  // the app stays a single slash. "/" would make all of them "//shop", which
  // a browser reads as a URL on a host called "shop".
  if (requestHeaders.get(CLINIC_HOST_HEADER) === slug) return { base: "", scope: "/" };
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  return { base: clientBasePath(slug, host), scope: clientAppScope(host) };
}


/** Home-screen label: iOS truncates past roughly 12 characters. */
export function shortAppName(name: string): string {
  return name.length <= 12 ? name : name.split(/\s+/)[0]!.slice(0, 12);
}
