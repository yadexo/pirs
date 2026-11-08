/**
 * One log line per sign-in outcome, in a fixed shape, so a failed sign-in in
 * Vercel's logs can be told apart from the next one:
 *
 *   [signin] outcome=wrong_password audience=staff portal=unified role=PLATFORM_ADMIN
 *
 * Search for `[signin]`. Until this existed every failure was the same bare
 * `CredentialsSignin`, whether the password was wrong, the email was on two
 * accounts, or the account was disabled — and a session refused *after* a
 * correct sign-in logged nothing at all.
 *
 * What goes in a line is a reason code and a few non-identifying labels. Never
 * an email, a password, an address, a token or a name: every value is checked
 * against a small character set below, so something free-form that reached
 * here by mistake is printed as "?" rather than leaked. The browser still gets
 * the same generic message for every failure; this is server-side only.
 */

/** Outcomes of the credentials step (lib/auth-credentials.ts). */
export type SignInOutcome =
  | "success"
  | "missing_fields"
  | "invalid_portal"
  | "rate_limited_account"
  | "rate_limited_ip"
  | "no_such_user"
  /** The email is on more than one staff-type account, so there is no single account to sign in to. */
  | "ambiguous_email"
  | "clinic_not_active"
  | "account_not_active"
  | "staff_blocked"
  | "wrong_password"
  | "two_factor_required"
  | "two_factor_invalid_code"
  /** Seen before the password is checked: the email is on several accounts, which can send it to the wrong sign-in. */
  | "multiple_accounts_for_email"
  /** A session that signed in fine, refused afterwards (lib/live-account.ts). */
  | "session_refused_account_inactive"
  | "session_refused_staff_blocked"
  | "session_refused_after_reset"
  | "session_refused_no_auth_time";

export interface SignInFields {
  audience?: "staff" | "client";
  portal?: string;
  role?: string;
  /** Roles of the accounts an email is on, e.g. ["PLATFORM_ADMIN", "CUSTOMER"]. */
  roles?: string[];
  /** For a refused session: how many seconds sessionsValidAfter is ahead of the session's start. Positive when clocks disagree. */
  ahead_s?: number;
}

/** Outcomes that are expected in normal use and are not a problem. */
const INFO: ReadonlySet<SignInOutcome> = new Set(["success", "two_factor_required", "multiple_accounts_for_email"]);

/**
 * Letters, digits and `_ + -`. No "@", colon, dot, slash or space, so nothing
 * shaped like an email, an IPv4 or IPv6 address, a host or a path gets through.
 * A safety net for those shapes, not a substitute for passing only codes: a bare
 * word is a bare word.
 */
const SAFE = /^[A-Za-z0-9_+-]{1,64}$/;
const clean = (value: string | number) => (SAFE.test(String(value)) ? String(value) : "?");

export function formatSignInLine(outcome: SignInOutcome, fields: SignInFields = {}): string {
  const parts = [`outcome=${outcome}`];
  if (fields.audience) parts.push(`audience=${clean(fields.audience)}`);
  if (fields.portal) parts.push(`portal=${clean(fields.portal)}`);
  if (fields.role) parts.push(`role=${clean(fields.role)}`);
  if (fields.roles?.length) parts.push(`roles=${clean([...fields.roles].sort().join("+"))}`);
  if (fields.ahead_s !== undefined) parts.push(`ahead_s=${clean(Math.round(fields.ahead_s))}`);
  return `[signin] ${parts.join(" ")}`;
}

/** Logging must never be the reason a sign-in fails. */
export function logSignIn(outcome: SignInOutcome, fields: SignInFields = {}): void {
  try {
    const line = formatSignInLine(outcome, fields);
    if (INFO.has(outcome)) console.info(line);
    else console.warn(line);
  } catch {
    /* ignore */
  }
}
