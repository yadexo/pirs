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

/**
 * The root domain everything else is derived from.
 *
 * NEXT_PUBLIC_ because this module is bundled for the browser too: the QR
 * scanner (app/app/clinic-finder.tsx) reads isClientHost through
 * lib/clinic-link.ts. A server-only variable would read as undefined there
 * and silently fall back to the default, so a scanned poster would be
 * validated against the wrong domain with no error anywhere.
 *
 * `||`, not `??`: a Vercel variable set to an empty string is still a string,
 * and an empty root domain would make CLIENT_HOSTS {"", "www."} — which, since
 * normaliseHost(null) is also "", would have isClientHost(null) return true
 * and the middleware rewrite requests that arrive with no host header at all.
 */
export const ROOT_DOMAIN = normaliseHost(process.env.NEXT_PUBLIC_ROOT_DOMAIN) || "deza.ai";

/** Env-supplied hosts, normalised and with blanks dropped. */
function hostList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(normaliseHost)
    .filter(Boolean);
}

/**
 * Each custom subdomain, overridable one at a time. Only LOGIN_HOST is unset
 * by default: login.<root> is a redirect to the clinic login at the hosting
 * layer rather than a host this code knows about. Setting it adds it here.
 */
const LOGIN_BY_HOST: Record<string, string> = {
  [normaliseHost(process.env.CLINIC_HOST) || `clinic.${ROOT_DOMAIN}`]: CLINIC_LOGIN,
  [normaliseHost(process.env.ADMIN_HOST) || `admin.${ROOT_DOMAIN}`]: ADMIN_LOGIN,
  ...(normaliseHost(process.env.LOGIN_HOST) ? { [normaliseHost(process.env.LOGIN_HOST)]: CLINIC_LOGIN } : {}),
};

/**
 * Hosts that serve the client app at the root, so a clinic's clients get
 * deza.ai/<clinic> instead of clinic.deza.ai/app/<clinic>. Everything under
 * /app still works on every host; this only adds the shorter address.
 *
 * NEXT_PUBLIC_EXTRA_CLIENT_HOSTS adds more (staging, say) without a code
 * change — but read the scope note above clientAppScope first: a host that
 * serves the clinic portal too should not be in here.
 */
const CLIENT_HOSTS = new Set([ROOT_DOMAIN, `www.${ROOT_DOMAIN}`, ...hostList(process.env.NEXT_PUBLIC_EXTRA_CLIENT_HOSTS)]);

/**
 * First path segments that belong to the app itself and can never be a clinic.
 * A clinic slug that collided with one of these would be unreachable, so
 * lib/actions/merchants.ts should refuse them when creating a clinic.
 */
export const RESERVED_SLUGS = new Set([
  "api",
  "_next",
  "app",
  "m",
  "agency",
  "admin",
  "login",
  "logout",
  "set-password",
  "forgot-password",
  "uploads",
  "static",
  "assets",
  "well-known",
]);

/**
 * The installed app's scope on this host. Always ends in "/", which is what
 * iOS treats as a directory — a scope of "/riverside" has Safari open every
 * deeper page (the Shop tab, say) in a browser view with an address bar
 * instead of inside the app.
 *
 * On the root domain that is the domain itself: everything there is the
 * client app, and the short /riverside and long /app/riverside address are
 * both inside it. Elsewhere it is /app/, which keeps the clinic portal and
 * the agency console — different surfaces on the same host — outside.
 */
export function clientAppScope(host: string | null | undefined): string {
  return isClientHost(host) ? "/" : "/app/";
}
export function isClientHost(host: string | null | undefined): boolean {
  return CLIENT_HOSTS.has(normaliseHost(host));
}

/**
 * The client-app path that a root-domain URL stands for, or null to leave the
 * request alone: deza.ai/riverside/shop serves /app/riverside/shop, with the
 * short address still showing in the browser.
 */
/**
 * The short address for a long one: /app/riverside/shop -> /riverside/shop.
 * On the root domain the long form works but sits outside the installed
 * app's scope, so an old link would drop the client into Safari with an
 * address bar. Null when the path isn't a client-app path.
 */
export function shortClientAppPath(pathname: string): string | null {
  if (pathname !== "/app" && !pathname.startsWith("/app/")) return null;
  const rest = pathname.slice("/app".length);
  return rest === "" || rest === "/" ? "/" : rest;
}

export function clientAppPath(pathname: string): string | null {
  if (pathname === "/" || pathname === "") return "/app";
  const [, first = ""] = pathname.split("/");
  // Reserved routes, and anything with a file extension (client-sw.js,
  // favicon.ico), are served as-is.
  if (!first || RESERVED_SLUGS.has(first.toLowerCase()) || first.includes(".")) return null;
  return `/app${pathname}`;
}

/** "Admin.Deza.ai:443" → "admin.deza.ai". */
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
