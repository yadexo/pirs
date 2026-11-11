import "server-only";
import { headers } from "next/headers";

/**
 * The address this request actually came in on, with no trailing slash.
 *
 * Not the same question as lib/clinic-app-link.ts answers. That one says where
 * a clinic's clients *should* be sent — the one address every QR code and
 * email agrees on. This one says where this client *is*, which is the only
 * honest key for anything remembered per install: a clinic with its own
 * domain has two live addresses, and a Home Screen icon added from one is a
 * different app, with its own storage, from an icon added from the other.
 *
 * Vercel terminates TLS, so the scheme has to come from x-forwarded-proto;
 * locally there is no such header and no TLS either, hence the fallback.
 */
export async function requestOrigin(): Promise<string | null> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return null;
  const proto = requestHeaders.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
