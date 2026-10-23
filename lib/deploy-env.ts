/**
 * Which deployment this is, for the handful of things (today: the "/" demo
 * index) that must never appear on the real production domains.
 *
 * `VERCEL_ENV` is set automatically by Vercel itself — "production" only on
 * the actual Production deployment, "preview" on every branch deploy
 * including staging, unset entirely off Vercel. Nothing has to remember to
 * configure it, which is the point: a forgotten env var fails closed here
 * (demo hidden) rather than open. `APP_ENV=production` is read too, as a
 * second, manual signal for a future non-Vercel host.
 */
export function isRealProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.APP_ENV === "production";
}
