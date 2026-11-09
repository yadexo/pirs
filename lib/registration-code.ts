import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The shared code that has to be typed before an account can be created on the
 * clinic or admin register page.
 *
 * Deliberately crude, and deliberately temporary: it is one secret for
 * everyone, so it says "whoever has been told the code" and nothing more. It is
 * not an invitation, it does not expire, and it cannot be traced to a person.
 * It exists so registration can be opened to a handful of known people before
 * there is a real invitation system, and it is meant to be replaced — see
 * docs/operations/registration-code.md.
 *
 * REGISTRATION_CODE is read at request time (not NEXT_PUBLIC_, not baked into
 * the bundle), so changing it needs a redeploy only because Vercel binds
 * environment variables per deployment, never a rebuild of the pages.
 *
 * Unset — or set to whitespace — means registration is **off**: both pages 404
 * and both actions refuse. That is the fail-closed direction: forgetting to
 * configure it cannot leave a public sign-up open.
 */
export function registrationCode(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = (env.REGISTRATION_CODE ?? "").trim();
  return value || null;
}

export function registrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return registrationCode(env) !== null;
}

/**
 * Temporary: let someone choose their password on the register form itself,
 * instead of being emailed a one-time link, and have the account work
 * immediately.
 *
 * Off unless REGISTRATION_SET_PASSWORD_DIRECTLY is exactly "1". Off is the
 * normal way round, and the link flow is the one to keep: a link proves the
 * address exists before the account does, cannot be replayed, and leaves no
 * password anywhere it could be read later. This exists for setting a
 * deployment up by hand when waiting on an inbox is in the way.
 *
 * What it does *not* change: the registration code is still required, the
 * rate limits still apply, and two-factor setup is still forced for owners
 * and platform admins on their first page. It only replaces "we email you a
 * link" with "you type a password here".
 *
 * Removing it: see docs/operations/registration-code.md.
 */
export function setPasswordDirectly(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.REGISTRATION_SET_PASSWORD_DIRECTLY ?? "").trim() === "1";
}

/** Re-exported so server code has one place to look; the value lives in a client-safe module. */
export { REGISTRATION_MIN_PASSWORD_LENGTH } from "@/lib/registration-constants";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Whether what was typed is the code.
 *
 * Compared as SHA-256 digests with timingSafeEqual: digests so the two sides
 * are always the same length (timingSafeEqual throws otherwise, and the length
 * itself would leak how long the code is), and timingSafeEqual so the time
 * taken does not depend on how many leading characters were right.
 *
 * Only the surrounding whitespace is forgiven — a code pasted with a trailing
 * newline is the code. Nothing else is normalised: it is compared byte for byte.
 */
export function registrationCodeMatches(given: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = registrationCode(env);
  if (expected === null || typeof given !== "string") return false;
  const typed = given.trim();
  if (typed === "") return false;
  return timingSafeEqual(digest(typed), digest(expected));
}
