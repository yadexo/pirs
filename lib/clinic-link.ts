/** Shared by the browser (QR scanning) and the server (cookies, redirects). */

export const LAST_CLINIC_COOKIE = "last_clinic";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
 * Reads a scanned clinic QR. Only the clinic slug is taken from it — never the
 * host — so a doctored code can at most open another clinic's page here.
 */
export function slugFromScannedCode(value: string): string | null {
  try {
    return slugFromAppPath(new URL(value.trim(), "https://placeholder.invalid").pathname);
  } catch {
    return null;
  }
}
