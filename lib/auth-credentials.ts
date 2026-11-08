import "server-only";
// From @auth/core directly, not the "next-auth" package root — that one
// pulls in Next.js-specific entry points this file has no other reason to
// load (and that break outside a Next.js runtime, e.g. under plain Node).
import { CredentialsSignin } from "@auth/core/errors";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { LOGIN_ATTEMPTS_PER_ACCOUNT, LOGIN_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS } from "@/lib/login-limits";
import { logSignIn } from "@/lib/signin-log";
import { audienceFor, chooseAccount, isPortal, portalRoles, type Portal } from "@/lib/portal-scope";
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
 *
 * Next bundles the NextAuth route handler (where authorize() runs, and
 * where this file executes) separately from the server action that catches
 * the error — a different bundle than the one Next.js scopes its i18n
 * request config to, so calling next-intl's getTranslations() here isn't
 * reliable. The message carries the retry duration in milliseconds instead
 * of translated text; signInOrError (lib/actions/auth.ts), which does run in
 * a normal server-action context, is where this actually gets translated.
 */
export const RATE_LIMITED_MESSAGE_PREFIX = "__rate_limited__:";
class RateLimitedSignIn extends CredentialsSignin {
  constructor(retryAfterMs: number) {
    super(`${RATE_LIMITED_MESSAGE_PREFIX}${retryAfterMs}`);
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

/** Same bundle-split reasoning as RateLimitedSignIn above — a sentinel, translated on the other side. */
export const INVALID_TWO_FACTOR_CODE_MESSAGE = "__2fa_invalid_code__";

/** Password was right, a code was given, and it matched neither the TOTP nor any unused backup code. */
class InvalidTwoFactorCodeSignIn extends CredentialsSignin {
  constructor() {
    super(INVALID_TWO_FACTOR_CODE_MESSAGE);
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
  const rawPortal = credentials?.portal;
  const portal: Portal | undefined = isPortal(rawPortal) ? rawPortal : undefined;
  const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
  const password = credentials?.password as string | undefined;
  const tenantSlug = credentials?.tenantSlug as string | undefined;

  // Every outcome below is logged as a reason code (lib/signin-log.ts), so a
  // failed sign-in can be told apart in the logs. What the caller is told is
  // unchanged: still one generic failure, so the form cannot be used to find
  // out which part was wrong.
  const at = { audience, portal };
  // A portal that is present but not one of the four doors: a page left open
  // across a deploy that renamed them posts the old value, and that is worth
  // telling apart from a field nobody filled in.
  if (rawPortal !== undefined && rawPortal !== "" && !portal) {
    logSignIn("invalid_portal", { audience });
    return null;
  }
  if (!portal || !email || !password) {
    logSignIn("missing_fields", { audience });
    return null;
  }

  // The door and the session kind must agree: the client app's cookie is only
  // ever issued at a client door, and a staff cookie never at one. Derived from
  // the portal (lib/portal-scope.ts), not from the role of whichever account
  // turns up, so the two sessions can never be crossed.
  if (audienceFor(portal) !== audience) {
    logSignIn("invalid_portal", at);
    return null;
  }

  // Both limits run regardless of which trips first, so a attacker spraying
  // one password across many accounts from one address is still caught, and
  // a botnet trying one account from many addresses still is too.
  const [byAccount, byIp] = await Promise.all([
    rateLimit(`login:${portal}:${email}`, LOGIN_ATTEMPTS_PER_ACCOUNT, LOGIN_WINDOW_MS),
    rateLimit(`login:ip:${ip}`, LOGIN_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS),
  ]);
  const limited = !byAccount.ok ? byAccount : !byIp.ok ? byIp : null;
  if (limited) {
    logSignIn(!byAccount.ok ? "rate_limited_account" : "rate_limited_ip", at);
    throw new RateLimitedSignIn(limited.retryAfterMs);
  }

  let user;

  if (portal === "customer") {
    // A clinic's own app: the clinic is part of the identity, because the same
    // address may be a client of several clinics.
    if (!tenantSlug) {
      logSignIn("invalid_portal", at);
      return null;
    }
    const tenant = await rawDb.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, status: true } });
    if (!tenant || tenant.status !== "ACTIVE") {
      logSignIn("clinic_not_active", at);
      return null;
    }
    user = await rawDb.user.findFirst({ where: { email, tenantId: tenant.id, role: "CUSTOMER" }, include });
  } else {
    // Only the accounts this door is for (lib/portal-scope.ts). An address that
    // is a platform admin *and* a clinic owner *and* a client is one person
    // with three accounts: each door signs in its own, instead of all three
    // refusing each other.
    const matches = await rawDb.user.findMany({ where: { email, role: { in: portalRoles(portal) } }, include });
    const chosen = chooseAccount(matches, portal);

    if ("ambiguous" in chosen) {
      // Two accounts of the same kind on one address — the same person owning
      // two clinics, say. There is no way to tell which was meant, and picking
      // one would be a security bug.
      logSignIn("ambiguous_email", { ...at, roles: chosen.ambiguous });
      return null;
    }
    if ("none" in chosen) {
      // One extra count, on the failure path only, to tell "no such address"
      // from "the right address at the wrong door" — the second is what a
      // clinic owner typing their address into the admin login looks like, and
      // the two are indistinguishable from the outside on purpose.
      const elsewhere = await rawDb.user.count({ where: { email } });
      logSignIn(elsewhere > 0 ? "no_account_of_type" : "no_such_user", at);
      return null;
    }

    const match = chosen.account;
    // A suspended clinic must not be reachable through this door.
    if (match.tenant && match.tenant.status !== "ACTIVE") {
      logSignIn("clinic_not_active", { ...at, role: match.role });
      return null;
    }
    user = match;
  }

  if (!user) {
    logSignIn("no_such_user", at);
    return null;
  }
  if (user.status !== "ACTIVE") {
    logSignIn("account_not_active", { ...at, role: user.role });
    return null;
  }
  // Deactivated staff, or a staff login with no profile, cannot sign in.
  if (user.role === "STAFF" && (!user.staffProfile || !user.staffProfile.active)) {
    logSignIn("staff_blocked", { ...at, role: user.role });
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    logSignIn("wrong_password", { ...at, role: user.role });
    return null;
  }

  // Second factor, only for an account that has confirmed one. A secret
  // generated mid-setup and never confirmed doesn't count — see
  // lib/two-factor.ts — so abandoning setup can't accidentally lock anyone out.
  const twoFactor = await getTwoFactorStatus(user.id);
  if (twoFactor?.confirmedAt) {
    const code = (credentials?.totpCode as string | undefined)?.trim();
    if (!code) {
      logSignIn("two_factor_required", { ...at, role: user.role });
      throw new TwoFactorRequiredSignIn();
    }
    if (!(await verifyTwoFactorCode(user.id, twoFactor.secret, code))) {
      logSignIn("two_factor_invalid_code", { ...at, role: user.role });
      throw new InvalidTwoFactorCodeSignIn();
    }
  }

  await rawDb.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  logSignIn("success", { ...at, role: user.role });

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
