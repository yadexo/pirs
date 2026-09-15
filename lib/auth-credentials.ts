import "server-only";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { permissionsFor } from "@/lib/live-account";
import type { SessionPermissions, SessionUserShape } from "@/types/next-auth";

/**
 * Who a session is for. Staff (agency, clinic admins, clinic staff) and
 * clients get separate sessions in separate cookies, so a clinic can have its
 * portal and its client app signed in side by side in one browser — signing
 * in to one never signs you out of the other.
 */
export type Audience = "staff" | "client";

/**
 * "unified" is /login: the email identifies the account. "customer" is a
 * clinic's own client app, where the clinic comes from the URL — the same
 * email may be a client at more than one clinic, so the slug disambiguates.
 */
type Portal = "customer" | "unified";

const include = {
  staffProfile: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  customerProfile: true,
  tenant: { select: { slug: true, status: true } },
} as const;

export async function authorizeCredentials(credentials: Partial<Record<string, unknown>> | undefined, audience: Audience): Promise<SessionUserShape | null> {
  const portal = credentials?.portal as Portal | undefined;
  const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
  const password = credentials?.password as string | undefined;
  const tenantSlug = credentials?.tenantSlug as string | undefined;

  if (!portal || !email || !password) return null;

  const { ok } = await rateLimit(`login:${portal}:${email}`, 10, 10 * 60 * 1000);
  if (!ok) throw new Error("Too many sign-in attempts. Try again in a few minutes.");

  const roles = audience === "client" ? (["CUSTOMER"] as const) : (["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"] as const);
  let user;

  if (portal === "unified") {
    const matches = await rawDb.user.findMany({ where: { email, role: { in: [...roles] } }, include });
    // Same address registered under two clinics is ambiguous — we cannot
    // guess which, and picking one would be a security bug.
    const match = matches[0];
    if (matches.length !== 1 || !match) return null;
    // A suspended clinic must not be reachable through this door.
    if (match.tenant && match.tenant.status !== "ACTIVE") return null;
    user = match;
  } else {
    if (portal !== "customer" || audience !== "client" || !tenantSlug) return null;
    const tenant = await rawDb.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, status: true } });
    if (!tenant || tenant.status !== "ACTIVE") return null;
    user = await rawDb.user.findFirst({ where: { email, tenantId: tenant.id, role: "CUSTOMER" }, include });
  }

  if (!user || user.status !== "ACTIVE") return null;
  // Deactivated staff, or a staff login with no profile, cannot sign in.
  if (user.role === "STAFF" && (!user.staffProfile || !user.staffProfile.active)) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;

  await rawDb.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const permissions: SessionPermissions = permissionsFor(user);
  let name = email;
  if (user.staffProfile && (user.role === "STAFF" || user.role === "TENANT_ADMIN")) {
    name = `${user.staffProfile.firstName} ${user.staffProfile.lastName}`;
  } else if (user.role === "CUSTOMER" && user.customerProfile) {
    name = `${user.customerProfile.firstName} ${user.customerProfile.lastName}`;
  }

  return {
    id: user.id,
    email: user.email,
    name,
    role: user.role,
    tenantId: user.tenantId,
    tenantSlug: user.tenant?.slug ?? null,
    staffProfileId: user.staffProfile?.id ?? null,
    customerProfileId: user.customerProfile?.id ?? null,
    permissions,
  };
}
