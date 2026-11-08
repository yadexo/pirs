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
