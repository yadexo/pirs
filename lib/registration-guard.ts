import "server-only";
import { getTranslations } from "next-intl/server";
import { rateLimit, rateLimitExhausted, retryAfterParts } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { registrationCodeMatches, registrationEnabled } from "@/lib/registration-code";
import { logRegister } from "@/lib/signin-log";

/**
 * The one gate in front of self-registration, for both register pages.
 *
 * Every registration action calls this first, before it looks at anything else
 * the form said — so a guess costs an attempt whether or not the rest of the
 * form made sense, and nothing is created, emailed or even validated until the
 * code is right.
 *
 * When the code is replaced by a real invitation system, this function is the
 * seam: keep its signature and swap its body. See
 * docs/operations/registration-code.md.
 */

export type RegistrationKind = "admin" | "clinic";

/**
 * A six-digit code is guessable in a million tries, so the limits are what
 * actually stand between it and a patient attacker. Per address *and* per
 * email: one address spraying codes is caught by the first, a botnet trying
 * the same address from everywhere by the second.
 */
export const CODE_ATTEMPTS_PER_IP = 10;
export const CODE_ATTEMPTS_PER_EMAIL = 5;
export const CODE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Wrong codes from everyone put together, per hour, before registration
 * pauses for everyone.
 *
 * The two limits above both key on something the attacker chooses. The email
 * address is theirs to vary, and addresses to send from are cheap, so neither
 * slows a patient guesser — and what is being guessed is a code that creates
 * a platform admin (docs/security/review-2026-11.md, A-2). This one keys on
 * nothing: it counts wrong codes, whoever sent them.
 *
 * At this rate a six-digit code takes, on average, over two years to find;
 * unlimited, a rented botnet does it in an afternoon.
 *
 * The cost is that anyone can pause registration for an hour by guessing
 * wrong on purpose. That is the right way round: registration is a temporary
 * door for a handful of invited people, invitations do not use it, and a door
 * that closes under attack is better than one that can be picked.
 */
export const WRONG_CODES_PER_HOUR_EVERYONE = 20;
const EVERYONE_KEY = "register-code:wrong:everyone";

/** The email as a rate-limit key: whatever was typed, normalised and bounded. */
function limitKeyEmail(fd: FormData): string {
  return String(fd.get("email") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

/**
 * Null when registration may proceed; otherwise the message to show.
 *
 * The message never says which part was wrong — a missing code and a wrong one
 * read the same, and neither says whether registration is open — while the
 * logs tell them apart by reason code. Search for `[register]`.
 */
export async function guardRegistration(kind: RegistrationKind, fd: FormData): Promise<{ error: string } | null> {
  const t = await getTranslations("register.errors");
  const at = { portal: kind };


  if (!registrationEnabled()) {
    logRegister("disabled", at);
    // Said plainly: with the variable unset the pages 404 anyway, so anyone
    // reaching this posted a form directly and is owed no secret.
    return { error: t("closed") };
  }

  // Before anything else, and without counting: a right code is refused too
  // while this is tripped, or the limit would only slow down the wrong ones.
  const everyone = await rateLimitExhausted(EVERYONE_KEY, WRONG_CODES_PER_HOUR_EVERYONE);
  if (everyone.exhausted) {
    logRegister("rate_limited_everyone", at);
    const auth = await getTranslations("auth");
    const { unit, count } = retryAfterParts(everyone.retryAfterMs);
    const time = unit === "minute" ? auth("retryAfter.minutes", { count }) : auth("retryAfter.seconds", { count });
    return { error: auth("tooManyAttempts", { time }) };
  }

  const ip = await clientIp();
  const email = limitKeyEmail(fd);
  // Both counters are consumed before the code is compared, so a guess always
  // costs an attempt.
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`register-code:ip:${ip}`, CODE_ATTEMPTS_PER_IP, CODE_WINDOW_MS),
    email ? rateLimit(`register-code:email:${email}`, CODE_ATTEMPTS_PER_EMAIL, CODE_WINDOW_MS) : Promise.resolve({ ok: true as const, retryAfterMs: 0 }),
  ]);
  const limited = !byIp.ok ? byIp : !byEmail.ok ? byEmail : null;
  if (limited) {
    logRegister(!byIp.ok ? "rate_limited_ip" : "rate_limited_email", at);
    // The same wording sign-in uses for the same situation.
    const auth = await getTranslations("auth");
    const { unit, count } = retryAfterParts(limited.retryAfterMs);
    const time = unit === "minute" ? auth("retryAfter.minutes", { count }) : auth("retryAfter.seconds", { count });
    return { error: auth("tooManyAttempts", { time }) };
  }

  const given = fd.get("code");
  if (typeof given !== "string" || given.trim() === "") {
    logRegister("code_missing", at);
    return { error: t("invalidCode") };
  }
  if (!registrationCodeMatches(given)) {
    // Only a wrong code spends the shared allowance; a missing one is a form
    // submitted empty, not a guess.
    await rateLimit(EVERYONE_KEY, WRONG_CODES_PER_HOUR_EVERYONE, CODE_WINDOW_MS);
    logRegister("code_wrong", at);
    return { error: t("invalidCode") };
  }

  return null;
}
