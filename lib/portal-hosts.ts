/**
 * Which login each custom subdomain opens at its root. Edge-safe (used by
 * middleware), no imports.
 *
 * Only these hosts skip the landing page. Everything else — the *.vercel.app
 * preview/production URL, localhost, a LAN address for phone testing — keeps
 * showing the three-portal overview at "/".
 */

/** The login a clinic owner or staff member uses. Their own clinic opens after sign-in. */
export const CLINIC_LOGIN = "/login";
/** The login for platform admins; `next` labels the page "Admin" and opens /agency after sign-in. */
export const ADMIN_LOGIN = `/login?next=${encodeURIComponent("/agency")}`;

const LOGIN_BY_HOST: Record<string, string> = {
  "clinic.pirs.io": CLINIC_LOGIN,
  "login.pirs.io": CLINIC_LOGIN,
  "admin.pirs.io": ADMIN_LOGIN,
};

/** "Admin.Pirs.io:443" → "admin.pirs.io". */
export function normaliseHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Where "/" should send this host, or null to show the landing page. */
export function loginForHost(host: string | null | undefined): string | null {
  return LOGIN_BY_HOST[normaliseHost(host)] ?? null;
}

/**
 * The absolute URL to redirect to, on the same subdomain the visitor asked for.
 * Built from the host itself rather than the server's own idea of its URL, and
 * only for the hosts listed above — all of which are served over HTTPS.
 */
export function loginRedirectForHost(host: string | null | undefined): string | null {
  const login = loginForHost(host);
  return login ? `https://${normaliseHost(host)}${login}` : null;
}
