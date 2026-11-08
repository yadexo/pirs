import "server-only";
import { getTranslations } from "next-intl/server";
import { rateLimit, retryAfterParts } from "@/lib/rate-limit";
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
    logRegister("code_wrong", at);
    return { error: t("invalidCode") };
  }

  return null;
}
