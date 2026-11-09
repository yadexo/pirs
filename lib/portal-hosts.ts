/**
 * Which surface each host serves, and which login it opens at its root.
 * Edge-safe (used by middleware), no imports.
 *
 * Three hosts are app hosts: the client app (login.<root>), the clinic portal
 * (app.<root>) and the platform admin (admin.<root>). Everything else — the
 * *.vercel.app preview/production URL, staging, localhost, a LAN address for
 * phone testing — keeps showing the three-portal overview at "/".
 *
 * The apex and www are deliberately absent: they serve a separate marketing
 * site, and this app must not route, rewrite or redirect on them.
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
 * and an empty root domain would leave every host below a bare label —
 * "login.", "app." — that matches nothing and resolves to nothing. Falling
 * back to the real domain is wrong in a way somebody notices; routing a whole
 * deployment to hosts that cannot exist is not.
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
 * The three app hosts, each overridable on its own.
 *
 * NEXT_PUBLIC_ on the client host for the same reason as ROOT_DOMAIN above —
 * it feeds isClientHost, which ships to the browser. The other two are read
 * only by loginForHost, which runs in middleware, so they stay server-side and
 * out of the bundle.
 *
 * Keep them distinct. Pointing CLINIC_HOST at the client host (or listing the
 * portal host in NEXT_PUBLIC_EXTRA_CLIENT_HOSTS) makes the client rewrite in
 * middleware.ts shadow the login redirect below it: the portal login becomes
 * unreachable, and the installed app's scope widens to swallow /m/.
 */
export const CLIENT_HOST = normaliseHost(process.env.NEXT_PUBLIC_CLIENT_HOST) || `login.${ROOT_DOMAIN}`;
export const PORTAL_HOST = normaliseHost(process.env.CLINIC_HOST) || `app.${ROOT_DOMAIN}`;
export const ADMIN_HOST = normaliseHost(process.env.ADMIN_HOST) || `admin.${ROOT_DOMAIN}`;

/**
 * A Map, not an object literal: an object inherits from Object.prototype, so
 * `LOGIN_BY_HOST["constructor"]` would be the Object constructor — truthy,
 * and `?? null` below would not catch it. The host comes straight from a
 * request header, so `Host: constructor` is a string an attacker can send.
 */
const LOGIN_BY_HOST = new Map<string, string>([
  [PORTAL_HOST, CLINIC_LOGIN],
  [ADMIN_HOST, ADMIN_LOGIN],
]);

/**
 * Hosts that serve the client app at the root, so a clinic's clients get
 * login.deza.ai/<clinic> instead of app.deza.ai/app/<clinic>. Everything under
 * /app still works on every host; this only adds the shorter address.
 *
 * A list rather than a single host: login.<root> is Deza's own default, and
 * each clinic's own verified domain joins it later. NEXT_PUBLIC_EXTRA_CLIENT_HOSTS
 * adds one today without a code change — but read the scope note above
 * clientAppScope first: a host that serves the clinic portal too does not
 * belong in here.
 */
const CLIENT_HOSTS = new Set([CLIENT_HOST, ...hostList(process.env.NEXT_PUBLIC_EXTRA_CLIENT_HOSTS)]);

/**
 * Every host that serves the client app, for callers that need the list
 * rather than a yes/no — the Apple Pay registration, say.
 *
 * A copy, not the Set: the per-clinic-domain feature should extend this
 * module, not mutate a const from the outside.
 */
export function clientHosts(): readonly string[] {
  return [...CLIENT_HOSTS];
}

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
 * First segments that belong to the platform, not to a clinic's app. On a
 * clinic's own host these are refused rather than served: the staff portal
 * and the admin console never run on a clinic's domain, and a sign-in page
 * on it would set a cookie for the wrong origin.
 */
const PLATFORM_ONLY_SEGMENTS = new Set(["login", "logout", "m", "agency", "admin", "register", "account"]);

/**
 * Files that really do sit at the root of every host, as opposed to pages of
 * a clinic's app that merely have a dot in the name.
 */
const ROOT_FILES = new Set(["client-sw.js", "favicon.ico", "robots.txt", "sitemap.xml"]);

/**
 * What a clinic's own host should do with a path.
 *
 * On that host the clinic is the whole site, so the first segment is a page
 * of its app — "/shop" is the shop, not a clinic slug. Three outcomes:
 *
 *  - "app": serve the clinic's app at this path (the usual case)
 *  - "as-is": the app's own plumbing, which is the same everywhere — /api,
 *    Next's assets, uploads, and the shared /set-password and
 *    /forgot-password pages, which a client reaches from an emailed link on
 *    this very host
 *  - "deny": the platform's own surfaces, which this host must not serve
 *
 * Another clinic's slug needs no rule of its own: "/other-clinic" becomes
 * "/app/<thisclinic>/other-clinic", which is not a page, so it is a 404.
 */
export function clinicDomainRoute(pathname: string): { kind: "app" } | { kind: "as-is" } | { kind: "deny" } {
  // Callers pass a pathname, but a query or fragment left on the end must not
  // be able to turn "/login" into something that is not "login".
  const [, first = ""] = pathname.split(/[?#]/)[0]!.split("/");
  const segment = first.toLowerCase();
  if (PLATFORM_ONLY_SEGMENTS.has(segment)) return { kind: "deny" };
  if (!segment) return { kind: "app" };
  if (RESERVED_SLUGS.has(segment) || ROOT_FILES.has(segment)) return { kind: "as-is" };
  // Deliberately not "anything with a dot". On the shared client host the
  // first segment is the clinic slug, so a dot there means a real file at the
  // root; here the first segment is a page of the app, and
  // /manifest.webmanifest is the clinic's manifest, not a root file.
  return { kind: "app" };
}

/**
 * The installed app's scope on this host. Always ends in "/", which is what
 * iOS treats as a directory — a scope of "/riverside" has Safari open every
 * deeper page (the Shop tab, say) in a browser view with an address bar
 * instead of inside the app.
 *
 * On a client host that is the whole host: everything there is the client
 * app, and the short /riverside and long /app/riverside address are both
 * inside it. Elsewhere it is /app/, which keeps the clinic portal and the
 * agency console — different surfaces on the same host — outside.
 */
export function clientAppScope(host: string | null | undefined): string {
  return isClientHost(host) ? "/" : "/app/";
}
export function isClientHost(host: string | null | undefined): boolean {
  return CLIENT_HOSTS.has(normaliseHost(host));
}

/**
 * The short address for a long one: /app/riverside/shop -> /riverside/shop.
 * On a client host the long form works but sits outside the installed app's
 * scope, so an old link would drop the client into Safari with an address
 * bar. Null when the path isn't a client-app path.
 */
export function shortClientAppPath(pathname: string): string | null {
  if (pathname !== "/app" && !pathname.startsWith("/app/")) return null;
  const rest = pathname.slice("/app".length);
  return rest === "" || rest === "/" ? "/" : rest;
}

/**
 * The client-app path that a client-host URL stands for, or null to leave the
 * request alone: login.deza.ai/riverside/shop serves /app/riverside/shop, with
 * the short address still showing in the browser.
 */
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
  return LOGIN_BY_HOST.get(normaliseHost(host)) ?? null;
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

/**
 * The request header the middleware sets when a request arrived on a clinic's
 * own domain, carrying that clinic's slug.
 *
 * It is how the server side knows to build links and the installed app's
 * scope as "/" rather than "/<slug>": only the middleware knows the host
 * belongs to that clinic, and only it can say so. Nothing outside can forge
 * it — the middleware rebuilds the header set on every request and deletes
 * this one unless it set it.
 */
export const CLINIC_HOST_HEADER = "x-clinic-host";
