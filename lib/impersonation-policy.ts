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
