/**
 * The hosts the suite talks about, derived from the same environment
 * lib/portal-hosts.ts reads (.env.test, loaded by tests/setup.ts before any
 * test module imports).
 *
 * This deliberately makes assertions like isClientHost(ROOT) tautological —
 * both sides come from one variable. That is the right trade for these files,
 * whose subject is the normalisation around the table (ports, case, trailing
 * dots, suffix attacks) rather than the table's contents. The contents are
 * proved against a domain the code has never seen in
 * tests/portal-hosts-env.test.ts, which is where a hardcoded leftover shows up.
 */

export const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "deza.ai").toLowerCase();
export const WWW = `www.${ROOT}`;
export const CLINIC = `clinic.${ROOT}`;
export const ADMIN = `admin.${ROOT}`;

/** The domain the platform moved off, as the legacy-redirect tests use it. */
export const LEGACY_ROOT = "pirs.io";
export const LEGACY_WWW = `www.${LEGACY_ROOT}`;
export const LEGACY_CLINIC = `clinic.${LEGACY_ROOT}`;
export const LEGACY_ADMIN = `admin.${LEGACY_ROOT}`;
export const LEGACY_STAGING = `staging.${LEGACY_ROOT}`;
export const LEGACY_LOGIN = `login.${LEGACY_ROOT}`;
