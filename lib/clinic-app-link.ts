import "server-only";
import { clinicHostForSlug } from "@/lib/clinic-hosts";

/**
 * Where a clinic's clients are sent, for every link we generate for them:
 * QR codes, the join link, emails, password resets.
 *
 * One function because these all have to agree. A QR code printed with one
 * address and an email with another is how a client ends up with two
 * installs of the same app, two push subscriptions, and two sets of
 * notifications.
 *
 * The clinic's own verified domain wins when it has one. The shared address
 * is the fallback and keeps working either way — it is what everyone already
 * installed, and taking it away would break their home screen.
 */

/** The origin, with no trailing slash: "https://app.clinicname.nl" or the shared host. */
export async function clinicAppOrigin(slug: string): Promise<string> {
  const host = await clinicHostForSlug(slug);
  if (host) return `https://${host}`;
  return (process.env.CLIENT_APP_URL ?? process.env.APP_URL ?? "").replace(/\/+$/, "");
}

/**
 * An absolute link into a clinic's app.
 *
 * `path` is relative to the clinic's app, so "/shop", not "/riverside/shop" —
 * where the slug goes, if anywhere, is this function's business.
 */
export async function clinicAppUrl(slug: string, path = ""): Promise<string> {
  const host = await clinicHostForSlug(slug);
  if (host) return `https://${host}${path}`;

  // The shared address: short (login.deza.ai/riverside) when a client host is
  // configured, long (APP_URL/app/riverside) otherwise, which is what
  // development and staging use.
  const origin = (process.env.CLIENT_APP_URL ?? process.env.APP_URL ?? "").replace(/\/+$/, "");
  const prefix = process.env.CLIENT_APP_URL ? "" : "/app";
  const relative = `${prefix}/${encodeURIComponent(slug)}${path}`;
  return origin ? `${origin}${relative}` : relative;
}

/** The link a clinic prints on posters and shares: opens its app and offers sign-up. */
export async function clinicJoinUrl(slug: string): Promise<string> {
  return clinicAppUrl(slug, "?join=1");
}
