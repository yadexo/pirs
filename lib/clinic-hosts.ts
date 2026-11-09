import "server-only";
import { rawDb } from "@/lib/db";

/**
 * Which clinic answers on which of its own hosts.
 *
 * Small on purpose: a host, a slug, nothing else. The middleware has to make
 * this decision on every request, and it runs on the Edge runtime where
 * Prisma cannot — so this map is read here, in Node, and handed to the
 * middleware through an internal endpoint that caches it for a minute.
 *
 * Only VERIFIED domains of ACTIVE clinics are in it. A pending domain is a
 * promise about DNS that has not been kept yet, and routing it would serve a
 * clinic's app on a host whose certificate does not exist.
 */

export interface ClinicHostMap {
  /** host -> clinic slug */
  hosts: Record<string, string>;
  /** When this copy was built, so a consumer can tell how stale it is. */
  generatedAt: string;
}

/**
 * How long a copy of the map is reused before it is read again. Short,
 * because the whole point is that a domain starts working shortly after it
 * verifies without anybody redeploying.
 */
export const CLINIC_HOST_TTL_MS = 60_000;

let cached: { map: ClinicHostMap; at: number } | null = null;

/** Reads the map from the database. No cache — `clinicHostMap` is the cached one. */
export async function readClinicHostMap(): Promise<ClinicHostMap> {
  const rows = await rawDb.clinicDomain.findMany({
    where: { status: "VERIFIED", type: "CLIENT", tenant: { status: "ACTIVE" } },
    select: { host: true, tenant: { select: { slug: true } } },
  });
  const hosts: Record<string, string> = Object.create(null);
  for (const row of rows) hosts[row.host] = row.tenant.slug;
  return { hosts, generatedAt: new Date().toISOString() };
}

/**
 * The map, from memory when it is fresh enough.
 *
 * On a read failure the last good copy is served however old it is: a
 * database blip should not take every clinic's domain offline, and the worst
 * a stale copy can do is route a host that was removed seconds ago.
 */
export async function clinicHostMap(now = Date.now()): Promise<ClinicHostMap> {
  if (cached && now - cached.at < CLINIC_HOST_TTL_MS) return cached.map;
  try {
    const map = await readClinicHostMap();
    cached = { map, at: now };
    return map;
  } catch (err) {
    if (cached) {
      console.warn("[domain] falling back to the last host map:", err instanceof Error ? err.message : err);
      return cached.map;
    }
    throw err;
  }
}

/**
 * Drops the cached copy, so the next read is fresh.
 *
 * Called when a domain verifies or is removed. It only clears *this*
 * process's copy — other instances, and the middleware's own cache, still
 * wait out their TTL. That is the point of keeping the TTL at a minute.
 */
export function forgetClinicHosts(): void {
  cached = null;
}

/** The clinic this host serves, or null. */
export async function clinicSlugForHost(host: string | null | undefined): Promise<string | null> {
  const normalised = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!normalised) return null;
  const { hosts } = await clinicHostMap();
  return Object.prototype.hasOwnProperty.call(hosts, normalised) ? hosts[normalised]! : null;
}

/**
 * The clinic's own host, if it has a verified one. The reverse of the map
 * above, and it shares the same cached copy — so a link built during a
 * request costs nothing extra.
 */
export async function clinicHostForSlug(slug: string): Promise<string | null> {
  const { hosts } = await clinicHostMap();
  for (const [host, mapped] of Object.entries(hosts)) if (mapped === slug) return host;
  return null;
}
