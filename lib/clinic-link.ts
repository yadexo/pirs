/** Shared by the browser (QR scanning) and the server (cookies, redirects). */

import { isClientHost } from "@/lib/portal-hosts";

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
 * Reads a scanned clinic QR, in either shape: the long /app/<clinic> path, or
 * the short login.deza.ai/<clinic> link clinics print now.
 *
 * Only the slug is taken from it, never the host, so a doctored code can at
 * most open another clinic's page here. The short shape is accepted only from
 * one of our own client hosts (or a relative link) — otherwise every URL in
 * the world would look like a clinic code.
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

  // The same host table the middleware routes on — not a second copy of it,
  // which is how a printed poster for a new domain comes to scan as nothing.
  const onAClientHost = url.hostname === "relative.invalid" || isClientHost(url.hostname);
  if (!onAClientHost) return null;

  // One segment only: login.deza.ai/riverside, never login.deza.ai/some/other/page.
  const [, first = "", second] = url.pathname.split("/");
  if (second) return null;
  const slug = first ? decodeURIComponent(first) : null;
  return isClinicSlug(slug) ? slug : null;
}
