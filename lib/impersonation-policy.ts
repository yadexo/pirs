/**
 * Longest an agency admin's impersonation of a merchant may run. The cookie
 * expires with it, and the cleanup cron job closes any session left open
 * longer — a closed browser never calls exit — so the audit log never shows
 * someone inside a merchant account indefinitely.
 *
 * Lives outside lib/actions/impersonation.ts because a "use server" module
 * may only export async functions.
 */
export const IMPERSONATION_MAX_MS = 12 * 60 * 60 * 1000;

export const IMPERSONATION_COOKIE = "impersonate_merchant";
export const SESSION_ID_COOKIE = "impersonate_session";

/**
 * The merchant an agency admin is currently viewing, if any.
 *
 * Here rather than beside the actions that set the cookie: everything a
 * "use server" file exports is a public endpoint, callable by anyone who
 * finds its id, whether or not it was meant as one
 * (docs/security/review-2026-11.md, T-3). This only ever read the caller's own
 * cookie, so it gave nothing away — but a helper has no business being an
 * endpoint, and tests/action-exports.test.ts now refuses any that is.
 */
export async function getImpersonatedMerchantId(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return jar.get(IMPERSONATION_COOKIE)?.value ?? null;
}
