/**
 * The platform's cut of a clinic's sale, as an application fee on the charge.
 *
 * PLATFORM_FEE_PERCENT is a percentage of the subtotal *before* tax — tax is
 * the state's money, not the clinic's revenue, so the platform doesn't take a
 * share of it. Unset or unreadable means 0: a missing environment variable can
 * never silently skim from a clinic.
 */

export const PLATFORM_FEE_ENV = "PLATFORM_FEE_PERCENT";

/** 0 when unset, negative, or not a number. Capped at 100%. */
export function platformFeePercent(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[PLATFORM_FEE_ENV];
  if (raw === undefined || raw === null || String(raw).trim() === "") return 0;
  const value = Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 100);
}

/**
 * The fee for one sale, in cents. Rounded to whole cents, and never more than
 * the amount actually being charged — Stripe rejects a fee above the charge,
 * and a discount or applied credit can make the charge smaller than the
 * subtotal it is based on.
 */
export function applicationFeeCents(
  { subtotalCents, chargedCents }: { subtotalCents: number; chargedCents: number },
  env: NodeJS.ProcessEnv = process.env,
): number {
  const percent = platformFeePercent(env);
  if (percent <= 0 || subtotalCents <= 0 || chargedCents <= 0) return 0;
  const fee = Math.round((subtotalCents * percent) / 100);
  return Math.max(0, Math.min(fee, chargedCents));
}
