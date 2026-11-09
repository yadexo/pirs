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
  /** The address has an account, but not of the kind this door signs in — a clinic owner at the admin login, say. */
  | "no_account_of_type"
  /** The email is on more than one account of this door's own kind, so there is no single account to sign in to. */
  | "ambiguous_email"
  | "clinic_not_active"
  | "account_not_active"
  | "staff_blocked"
  | "wrong_password"
  | "two_factor_required"
  | "two_factor_invalid_code"
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
  /** Why something was refused, as a code. Never free text. */
  reason?: string;
  /** The state a record ended in, e.g. a domain's PENDING / VERIFIED / FAILED. */
  status?: string;
}

/** Outcomes that are expected in normal use and are not a problem. */
const INFO: ReadonlySet<SignInOutcome> = new Set(["success", "two_factor_required"]);

/**
 * Letters, digits and `_ + -`. No "@", colon, dot, slash or space, so nothing
 * shaped like an email, an IPv4 or IPv6 address, a host or a path gets through.
 * A safety net for those shapes, not a substitute for passing only codes: a bare
 * word is a bare word.
 */
const SAFE = /^[A-Za-z0-9_+-]{1,64}$/;
const clean = (value: string | number) => (SAFE.test(String(value)) ? String(value) : "?");

function format(tag: string, outcome: string, fields: SignInFields): string {
  const parts = [`outcome=${outcome}`];
  if (fields.audience) parts.push(`audience=${clean(fields.audience)}`);
  if (fields.portal) parts.push(`portal=${clean(fields.portal)}`);
  if (fields.role) parts.push(`role=${clean(fields.role)}`);
  if (fields.roles?.length) parts.push(`roles=${clean([...fields.roles].sort().join("+"))}`);
  if (fields.ahead_s !== undefined) parts.push(`ahead_s=${clean(Math.round(fields.ahead_s))}`);
  if (fields.reason) parts.push(`reason=${clean(fields.reason)}`);
  if (fields.status) parts.push(`status=${clean(fields.status)}`);
  return `[${tag}] ${parts.join(" ")}`;
}

/** Never lets logging be the reason something fails. */
function write(line: string, info: boolean): void {
  try {
    if (info) console.info(line);
    else console.warn(line);
  } catch {
    /* ignore */
  }
}

export function formatSignInLine(outcome: SignInOutcome, fields: SignInFields = {}): string {
  return format("signin", outcome, fields);
}

export function logSignIn(outcome: SignInOutcome, fields: SignInFields = {}): void {
  try {
    write(formatSignInLine(outcome, fields), INFO.has(outcome));
  } catch {
    /* ignore */
  }
}

/**
 * Outcomes of asking for a password-reset link (lib/actions/password.ts). The
 * person always sees "we sent a link", so without these a reset that went to
 * nobody — or to an address whose account is of a different kind than the door
 * it was asked for — leaves nothing behind at all.
 */
export type ResetOutcome =
  | "sent"
  | "no_such_user"
  /** The address has an account, but not of the kind this door resets. */
  | "no_account_of_type"
  /** Several accounts of the same kind on one address: there is no single one to send to. */
  | "ambiguous_email"
  | "rate_limited"
  | "clinic_not_active";

const RESET_INFO: ReadonlySet<ResetOutcome> = new Set<ResetOutcome>(["sent"]);

/** Search for `[reset]`. Same rules as above: reason codes and labels, never an address. */
export function logReset(outcome: ResetOutcome, fields: SignInFields = {}): void {
  try {
    write(format("reset", outcome, fields), RESET_INFO.has(outcome));
  } catch {
    /* ignore */
  }
}

/**
 * Outcomes of self-registration (lib/actions/register.ts). The registration
 * code itself is never a field here and never could be: `clean` would print it
 * as "?" if it were, and the outcomes say only whether one was given and
 * whether it matched.
 */
export type RegisterOutcome =
  | "success"
  /** REGISTRATION_CODE is not set, so registration is off entirely. */
  | "disabled"
  | "code_missing"
  | "code_wrong"
  | "rate_limited_ip"
  | "rate_limited_email"
  /** An account of this kind already exists on the address. */
  | "email_taken"
  | "invalid_input";

const REGISTER_INFO: ReadonlySet<RegisterOutcome> = new Set<RegisterOutcome>(["success"]);

/** Search for `[register]`. `portal` carries which register page it was: admin or clinic. */
export function logRegister(outcome: RegisterOutcome, fields: SignInFields = {}): void {
  try {
    write(format("register", outcome, fields), REGISTER_INFO.has(outcome));
  } catch {
    /* ignore */
  }
}

/**
 * Outcomes of attaching, checking or removing a clinic's own domain
 * (lib/actions/clinic-domains.ts).
 *
 * The host itself is never a field: it is somebody's real domain name, it has
 * no fixed shape, and `clean` would print most of them as "?" anyway. What a
 * line says is what happened and, for a refusal, which rule refused it — the
 * audit log holds the host, where it belongs.
 */
export type DomainOutcome =
  | "attached"
  | "checked"
  | "verified"
  | "removed"
  /** The typed domain broke one of the rules in lib/clinic-domain.ts. */
  | "refused"
  /** Vercel said no when attaching. */
  | "vercel_refused"
  /** Vercel said no when removing, so the row was kept. */
  | "vercel_remove_failed"
  /** A verification check could not be completed. */
  | "check_failed"
  /** No VERCEL_API_TOKEN / VERCEL_PROJECT_ID on this deployment. */
  | "not_configured";

const DOMAIN_INFO: ReadonlySet<DomainOutcome> = new Set<DomainOutcome>(["attached", "checked", "verified", "removed"]);

/** Search for `[domain]`. Same rules as above: codes and labels, never a host or a token. */
export function logDomain(outcome: DomainOutcome, fields: SignInFields = {}): void {
  try {
    write(format("domain", outcome, fields), DOMAIN_INFO.has(outcome));
  } catch {
    /* ignore */
  }
}
