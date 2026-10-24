import "server-only";
// From @auth/core directly, not the "next-auth" package root — that one
// pulls in Next.js-specific entry points this file has no other reason to
// load (and that break outside a Next.js runtime, e.g. under plain Node).
import { CredentialsSignin } from "@auth/core/errors";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { rateLimit, retryAfterLabel } from "@/lib/rate-limit";
import { permissionsFor } from "@/lib/live-account";
import { getTwoFactorStatus, verifyTwoFactorCode } from "@/lib/two-factor";
import type { SessionPermissions, SessionUserShape } from "@/types/next-auth";

/**
 * A plain `throw new Error(...)` from `authorize()` does not survive the trip
 * back through Auth.js — only a thrown `AuthError` (`CredentialsSignin` is
 * one) does, and even then with no message by default. Passing a string to
 * it sets `.message`, which `signInOrError` (auth.ts) reads to show this
 * specific text instead of the generic "wrong password" one — the only
 * message worth being specific about, since it is not "wrong password",
 * it is "slow down".
 */
class RateLimitedSignIn extends CredentialsSignin {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Exported so the calling Server Action can detect this case by message
 * rather than `instanceof TwoFactorRequiredSignIn` — Next bundles the
 * NextAuth route handler (where authorize() runs) separately from the
 * server action that catches the error, so the same class, thrown there and
 * imported here, can be two distinct constructors by the time it crosses
 * that boundary. The string itself is the one thing guaranteed to compare
 * equal on both sides.
 */
export const TWO_FACTOR_REQUIRED_MESSAGE = "__2fa_required__";

/** Password was right; this account has 2FA confirmed and no code was given yet. The login form's cue to show the code field. */
export class TwoFactorRequiredSignIn extends CredentialsSignin {
  constructor() {
    super(TWO_FACTOR_REQUIRED_MESSAGE);
  }
}

/** Password was right, a code was given, and it matched neither the TOTP nor any unused backup code. */
class InvalidTwoFactorCodeSignIn extends CredentialsSignin {
  constructor() {
    super("That code didn't work. Check the time on your phone, or use a backup code.");
  }
}

/** The caller's address from the request NextAuth hands the authorize callback. */
export function ipFromRequest(req: Request | undefined): string {
  if (!req) return "unknown";
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

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

export async function authorizeCredentials(
  credentials: Partial<Record<string, unknown>> | undefined,
  audience: Audience,
  ip = "unknown",
): Promise<SessionUserShape | null> {
  const portal = credentials?.portal as Portal | undefined;
  const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
  const password = credentials?.password as string | undefined;
  const tenantSlug = credentials?.tenantSlug as string | undefined;

  if (!portal || !email || !password) return null;

  // Both limits run regardless of which trips first, so a attacker spraying
  // one password across many accounts from one address is still caught, and
  // a botnet trying one account from many addresses still is too.
  const [byAccount, byIp] = await Promise.all([
    rateLimit(`login:${portal}:${email}`, 10, 10 * 60 * 1000),
    rateLimit(`login:ip:${ip}`, 30, 10 * 60 * 1000),
  ]);
  const limited = !byAccount.ok ? byAccount : !byIp.ok ? byIp : null;
  if (limited) throw new RateLimitedSignIn(`Too many sign-in attempts. Try again in ${retryAfterLabel(limited.retryAfterMs)}.`);

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

  // Second factor, only for an account that has confirmed one. A secret
  // generated mid-setup and never confirmed doesn't count — see
  // lib/two-factor.ts — so abandoning setup can't accidentally lock anyone out.
  const twoFactor = await getTwoFactorStatus(user.id);
  if (twoFactor?.confirmedAt) {
    const code = (credentials?.totpCode as string | undefined)?.trim();
    if (!code) throw new TwoFactorRequiredSignIn();
    if (!(await verifyTwoFactorCode(user.id, twoFactor.secret, code))) throw new InvalidTwoFactorCodeSignIn();
  }

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
