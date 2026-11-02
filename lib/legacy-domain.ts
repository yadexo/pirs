import { normaliseHost, ROOT_DOMAIN } from "@/lib/portal-hosts";

/**
 * The permanent redirect off the domain the platform moved away from.
 *
 * Edge-safe and pure, so the decision can be tested without booting the
 * middleware — which would mean importing NextAuth and the whole auth stack
 * for what is really a question about two strings.
 *
 * Set LEGACY_ROOT_DOMAIN and every request to that domain, or any subdomain of
 * it, is answered with a 308 to the same path on the matching host under
 * ROOT_DOMAIN. Leave it empty and nothing redirects. Note that the value is
 * bound to a deployment: changing it in a dashboard takes effect on the next
 * deploy, not on save.
 */

/**
 * The paths that keep answering on the old domain.
 *
 * Stripe's webhook endpoints and the scheduler's cron URLs are configured
 * elsewhere, by hand, and a redirect is not something either follows usefully
 * — Stripe would record a 308 as a failed delivery. They stay put until those
 * addresses have been repointed, which is a separate, manual step.
 */
export const LEGACY_EXEMPT = ["/api/webhooks/stripe", "/api/cron"] as const;

function isExempt(pathname: string): boolean {
  return LEGACY_EXEMPT.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

/**
 * Where this request should be sent, or null to leave it alone.
 *
 * `search` is passed through untouched, so a join link keeps its ?join=1 and
 * a shop link its ?tab=treatments.
 */
export function legacyRedirectUrl(host: string | null | undefined, pathname: string, search = ""): string | null {
  const legacy = normaliseHost(process.env.LEGACY_ROOT_DOMAIN);
  if (!legacy) return null;

  // Checked before the host, so that reading this function cannot leave any
  // doubt about whether the exemption is conditional on anything.
  if (isExempt(pathname)) return null;

  const current = normaliseHost(host);
  // Suffix match on a label boundary, never `includes`: pirs.io.evil.com is
  // somebody else's domain that merely starts with ours.
  if (current !== legacy && !current.endsWith(`.${legacy}`)) return null;

  const subdomain = current === legacy ? "" : current.slice(0, -(legacy.length + 1));
  // www folds into the bare root rather than redirecting twice.
  const target = subdomain === "" || subdomain === "www" ? ROOT_DOMAIN : `${subdomain}.${ROOT_DOMAIN}`;

  return `https://${target}${pathname}${search}`;
}
