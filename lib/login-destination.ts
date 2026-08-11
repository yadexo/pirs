import "server-only";
import { rawDb } from "@/lib/db";

/**
 * Post-login destinations. A destination arrives as a query parameter, so it
 * is attacker-controlled: it is only ever accepted as a same-origin path, and
 * a role that has no business at that path is sent to its own landing page
 * instead (see `resolveDestination`). Nothing here grants access — the
 * middleware and `requireMerchantContext` still guard every surface.
 */

/** Accepts same-origin paths only. Rejects absolute and protocol-relative URLs. */
export function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (next === "/login") return null;
  return next;
}

export interface PortalDescription {
  section: string;
  title: string;
  hint: string;
  accent: string;
}

/** Human wording for the login screen, so you can see which door you opened. */
export async function describeDestination(target: string): Promise<PortalDescription | null> {
  if (target === "/agency" || target.startsWith("/agency/")) {
    return {
      section: "Admin",
      title: "Sign in to the agency console",
      hint: "For whoever runs the platform.",
      accent: "var(--accent-purple)",
    };
  }

  const merchantMatch = /^\/m\/([^/]+)/.exec(target);
  if (merchantMatch) {
    const tenant = await rawDb.tenant.findUnique({
      where: { id: merchantMatch[1] },
      select: { name: true, branding: { select: { businessName: true } } },
    });
    const name = tenant?.branding?.businessName ?? tenant?.name;
    return {
      section: "Clinic",
      title: name ? `Sign in to ${name}` : "Sign in to the clinic portal",
      hint: "For clinic owners and their staff.",
      accent: "var(--primary)",
    };
  }

  const appMatch = /^\/app\/([^/]+)/.exec(target);
  if (appMatch) {
    const tenant = await rawDb.tenant.findUnique({
      where: { slug: appMatch[1] },
      select: { name: true, branding: { select: { businessName: true } } },
    });
    const name = tenant?.branding?.businessName ?? tenant?.name;
    return {
      section: "Client",
      title: name ? `Sign in to ${name}` : "Sign in to the client app",
      hint: "For the clinic's own clients.",
      accent: "var(--accent-pink)",
    };
  }

  return null;
}

interface Actor {
  role: string;
  tenantId: string | null;
  tenantSlug: string | null;
}

/** The role's own landing page, ignoring anything the URL asked for. */
export function landingFor({ role, tenantId, tenantSlug }: Actor): string {
  if (role === "PLATFORM_ADMIN") return "/agency";
  if (role === "CUSTOMER") return tenantSlug ? `/app/${tenantSlug}` : "/";
  if (tenantId) return `/m/${tenantId}`;
  return "/login";
}

/** Roles that can open each section, for the "wrong account" explanation. */
export const SECTION_REQUIREMENT: Record<string, string> = {
  Admin: "a platform admin account",
  Clinic: "a clinic owner or staff account",
  Client: "a client account at that clinic",
};

/**
 * Can this role actually open that path? Used to tell a signed-in user their
 * account is wrong for the portal they picked, rather than silently routing
 * them back to their own — which makes all three cards look identical.
 */
export function canReach(actor: Actor, next: string | null): boolean {
  const target = safeNext(next ?? undefined);
  if (!target) return true;
  return resolveDestination(actor, target) === target;
}

/**
 * Honour `next` only where the role belongs; otherwise fall back to the role's
 * own landing page. Sending a clinic admin who clicked "Admin" to /agency
 * would just bounce them off the middleware, which reads as a broken link.
 */
export function resolveDestination(actor: Actor, next: string | null): string {
  const fallback = landingFor(actor);
  const target = safeNext(next ?? undefined);
  if (!target) return fallback;

  if (target === "/agency" || target.startsWith("/agency/")) {
    return actor.role === "PLATFORM_ADMIN" ? target : fallback;
  }

  const merchantMatch = /^\/m\/([^/]+)/.exec(target);
  if (merchantMatch) {
    if (actor.role === "PLATFORM_ADMIN") return target;
    const isMerchantUser = actor.role === "TENANT_ADMIN" || actor.role === "STAFF";
    return isMerchantUser && merchantMatch[1] === actor.tenantId ? target : fallback;
  }

  const appMatch = /^\/app\/([^/]+)/.exec(target);
  if (appMatch) {
    return actor.role === "CUSTOMER" && appMatch[1] === actor.tenantSlug ? target : fallback;
  }

  return fallback;
}
