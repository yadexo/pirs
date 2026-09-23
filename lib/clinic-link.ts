/** Shared by the browser (QR scanning) and the server (cookies, redirects). */

export const LAST_CLINIC_COOKIE = "last_clinic";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Hosts whose first path segment is the clinic itself (pirs.io/riverside). */
const CLIENT_ROOT_HOSTS = new Set(["pirs.io", "www.pirs.io"]);

export function isClinicSlug(value: string | undefined | null): value is string {
  return !!value && value.length <= 80 && SLUG.test(value);
}

/** The clinic slug in a client-app path such as /app/riverside/shop. */
export function slugFromAppPath(pathname: string): string | null {
  const m = /^\/app\/([^/]+)/.exec(pathname);
  const slug = m ? decodeURIComponent(m[1]!) : null;
  return isClinicSlug(slug) ? slug : null;
}

/**
 * Reads a scanned clinic QR, in either shape: the long /app/<clinic> path, or
 * the short pirs.io/<clinic> link clinics print now.
 *
 * Only the slug is taken from it, never the host, so a doctored code can at
 * most open another clinic's page here. The short shape is accepted only from
 * our own root domain (or a relative link) — otherwise every URL in the world
 * would look like a clinic code.
 */
export function slugFromScannedCode(value: string): string | null {
  const text = value.trim();
  // A link or a path — never bare text, which would make any scanned word a clinic.
  if (!text.startsWith("/") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;

  let url: URL;
  try {
    url = new URL(text, "https://relative.invalid");
  } catch {
    return null;
  }

  const fromAppPath = slugFromAppPath(url.pathname);
  if (fromAppPath) return fromAppPath;

  const ourRootDomain = url.hostname === "relative.invalid" || CLIENT_ROOT_HOSTS.has(url.hostname.toLowerCase());
  if (!ourRootDomain) return null;

  // One segment only: pirs.io/riverside, never pirs.io/some/other/page.
  const [, first = "", second] = url.pathname.split("/");
  if (second) return null;
  const slug = first ? decodeURIComponent(first) : null;
  return isClinicSlug(slug) ? slug : null;
}
