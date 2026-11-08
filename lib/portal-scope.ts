/**
 * Which door a sign-in was opened at, and which accounts that door considers.
 *
 * One email address may hold several accounts of different kinds — a platform
 * admin, a clinic owner and a client of that clinic can all be the same person
 * and the same address. Sign-in used to look an address up across every
 * staff-type role at once and refuse whenever it found more than one match, so
 * that person could not sign in anywhere. The fix is to scope the lookup to the
 * surface being signed in to: the admin host only ever considers platform
 * admins, the clinic host only clinic accounts, a clinic's own app only its
 * clients.
 *
 * Nothing here grants access. It only narrows *which rows are looked at* before
 * a password is checked — which is why the portal may safely travel on the
 * request: naming a door you have no account at finds nothing and fails the
 * same way a wrong password does. Who may open which page afterwards is still
 * decided by lib/login-destination.ts and the guards behind it.
 */
import { ADMIN_HOST, PORTAL_HOST, normaliseHost } from "@/lib/portal-hosts";

/**
 * - `admin`   the platform admin host (admin.deza.ai), or a /agency destination
 * - `clinic`  the clinic portal host (app.deza.ai), or a /m/<clinic> destination
 * - `customer` a clinic's client app — always with the clinic's slug
 * - `staff`   the fallback where nothing identifies a door: localhost, a LAN
 *             address, *.vercel.app, staging. Staff-type accounts only, with
 *             platform admins preferred — never a client account, which is the
 *             mix-up this whole module exists to stop.
 */
export type Portal = "admin" | "clinic" | "customer" | "staff";

export type ScopedRole = "PLATFORM_ADMIN" | "TENANT_ADMIN" | "STAFF" | "CUSTOMER";

const PORTALS = ["admin", "clinic", "customer", "staff"] as const;

/**
 * The roles each door considers, most specific first. A tier is a group of
 * roles that are equally "this door's own": an address found in an earlier tier
 * settles the matter, and two matches *inside* one tier are genuinely
 * ambiguous — the same address owning two clinics, say — which still refuses.
 *
 * Only `staff` has more than one tier, and only because it is the door used
 * where the host says nothing at all. Preferring the platform admin there is a
 * fixed, documented order rather than whatever the database happened to return.
 */
const PORTAL_TIERS: Record<Portal, readonly (readonly ScopedRole[])[]> = {
  admin: [["PLATFORM_ADMIN"]],
  clinic: [["TENANT_ADMIN", "STAFF"]],
  customer: [["CUSTOMER"]],
  staff: [["PLATFORM_ADMIN"], ["TENANT_ADMIN", "STAFF"]],
};

export function isPortal(value: unknown): value is Portal {
  return typeof value === "string" && (PORTALS as readonly string[]).includes(value);
}

/** Every role this door considers, for the `role: { in: … }` of a lookup. */
export function portalRoles(portal: Portal): ScopedRole[] {
  return PORTAL_TIERS[portal].flat();
}

/**
 * Which session a door belongs to. Clients get their own cookie so a clinic can
 * have its portal and its client app signed in side by side; the two must never
 * be crossed, so this is derived from the portal rather than from the role of
 * whichever account was found.
 */
export function audienceFor(portal: Portal): "staff" | "client" {
  return portal === "customer" ? "client" : "staff";
}

export type Chosen<T> =
  /** Exactly one account of this door's kind. */
  | { account: T }
  /** Several equally-valid accounts within one tier: there is no way to pick, so nobody is signed in. */
  | { ambiguous: string[] }
  /** The address holds no account this door would accept. */
  | { none: true };

/**
 * The one account a door should sign in, out of every account on an address.
 *
 * Rows from outside this door's tiers are ignored outright — that is the point:
 * a platform admin whose address is also a client of some clinic signs in
 * normally at the admin door.
 */
export function chooseAccount<T extends { role: string }>(matches: readonly T[], portal: Portal): Chosen<T> {
  for (const tier of PORTAL_TIERS[portal]) {
    const inTier = matches.filter((m) => (tier as readonly string[]).includes(m.role));
    if (inTier.length === 1) return { account: inTier[0]! };
    if (inTier.length > 1) return { ambiguous: inTier.map((m) => m.role) };
  }
  return { none: true };
}

/** The clinic slug in a client-app destination, or null. Lowercase slugs only, as created. */
export function slugFromNext(next: string | null | undefined): string | null {
  const match = /^\/app\/([a-z0-9-]{1,80})(?:[/?#]|$)/.exec(next ?? "");
  return match?.[1] ?? null;
}

export interface OpenedDoor {
  portal: Portal;
  /** Set only for `customer`, where the clinic is part of the identity. */
  tenantSlug: string | null;
}

/**
 * The door this request opened.
 *
 * The host decides first, because on production it is the one thing the visitor
 * did not choose: admin.deza.ai is the admin door whatever `next` says. A
 * destination that the resulting account cannot reach is not this function's
 * problem — `canReach` already explains that case instead of quietly rerouting.
 *
 * Only where the host identifies no surface (localhost, a LAN address for phone
 * testing, *.vercel.app, staging, or the client host's own /login) does the
 * destination get a say, and then the fallback is the staff door.
 */
export function openedDoor(host: string | null | undefined, next: string | null | undefined): OpenedDoor {
  const normalised = normaliseHost(host);
  if (normalised === ADMIN_HOST) return { portal: "admin", tenantSlug: null };
  if (normalised === PORTAL_HOST) return { portal: "clinic", tenantSlug: null };

  const target = next ?? "";
  if (target === "/agency" || target.startsWith("/agency/") || target.startsWith("/agency?")) return { portal: "admin", tenantSlug: null };
  if (target.startsWith("/m/")) return { portal: "clinic", tenantSlug: null };
  const slug = slugFromNext(target);
  if (slug) return { portal: "customer", tenantSlug: slug };

  return { portal: "staff", tenantSlug: null };
}
