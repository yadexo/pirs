import { ADMIN_HOST, CLIENT_HOST, normaliseHost, PORTAL_HOST, ROOT_DOMAIN } from "@/lib/portal-hosts";

/**
 * The permanent redirect off the domain the platform moved away from.
 *
 * Edge-safe and pure, so the decision can be tested without booting the
 * middleware — which would mean importing NextAuth and the whole auth stack
 * for what is really a question about two strings.
 *
 * Set LEGACY_ROOT_DOMAIN and every address in the table below is answered
 * with a 308 to the same path on its new host. Leave it empty and nothing
 * redirects. The value is read once, at import: changing it in a dashboard
 * takes effect on the next deploy, not on save.
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
 * Each old address and the host that replaced it. Spelled out rather than
 * derived by swapping the domain off the end, because the surfaces moved as
 * well as the domain: the old apex was the client app and is now a subdomain,
 * and the portal was renamed from clinic to app.
 *
 * A Map, not an object literal: the host comes from a request header, so
 * `Host: constructor` would otherwise find Object.prototype's own property
 * and send the visitor to a URL built out of a function's source.
 *
 * An old subdomain that is not in here gets no redirect at all. A 308 is
 * cached by the browser indefinitely, and a guessed host that turns out not to
 * be attached to the Vercel project would pin visitors to a certificate error
 * with no way back. Still serving the old app somewhere is the recoverable
 * failure, so it is the one to prefer — which does mean that this table has to
 * be checked against the old domain's live DNS before the switch goes on.
 */
function legacyTargets(legacy: string): Map<string, string> {
  return new Map([
    // The old apex and www were the client app; it has its own host now, and
    // the apex is a marketing site that this app must not send anyone to.
    [legacy, CLIENT_HOST],
    [`www.${legacy}`, CLIENT_HOST],
    // login.<old> is a redirect to the staff login at the hosting layer, so it
    // means the portal, not the client app that now carries the login label.
    [`login.${legacy}`, PORTAL_HOST],
    [`clinic.${legacy}`, PORTAL_HOST],
    [`admin.${legacy}`, ADMIN_HOST],
    // Staging has no variable of its own; it follows the root domain.
    [`staging.${legacy}`, `staging.${ROOT_DOMAIN}`],
  ]);
}

const LEGACY_ROOT = normaliseHost(process.env.LEGACY_ROOT_DOMAIN);
const LEGACY_TARGETS = LEGACY_ROOT ? legacyTargets(LEGACY_ROOT) : null;

/**
 * Where this request should be sent, or null to leave it alone.
 *
 * `search` is passed through untouched, so a join link keeps its ?join=1 and
 * a shop link its ?tab=treatments.
 */
export function legacyRedirectUrl(host: string | null | undefined, pathname: string, search = ""): string | null {
  if (!LEGACY_TARGETS) return null;

  // Checked before the host, so that reading this function cannot leave any
  // doubt about whether the exemption is conditional on anything.
  if (isExempt(pathname)) return null;

  // Exact equality on the normalised host, which is also what keeps
  // pirs.io.evil.com — somebody else's domain that merely starts with ours —
  // out: it is simply not one of the keys.
  const target = LEGACY_TARGETS.get(normaliseHost(host));
  if (!target) return null;

  return `https://${target}${pathname}${search}`;
}
