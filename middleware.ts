import NextAuth, { type NextAuthRequest } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/auth.config";
import { LAST_CLINIC_COOKIE, slugFromAppPath } from "@/lib/clinic-link";
import { legacyRedirectUrl } from "@/lib/legacy-domain";
import { CLINIC_HOST_HEADER, ROOT_DOMAIN, clientAppPath, clinicDomainRoute, isClientHost, loginForHost, loginRedirectForHost, normaliseHost, shortClientAppPath } from "@/lib/portal-hosts";
import { applySecurityHeaders } from "@/lib/security-headers";

const { auth } = NextAuth(authConfig);

/**
 * Permanent redirects from the pre-collapse information architecture.
 * Each old surface now lives inside one of the six merchant pages; the
 * destination here mirrors the relocation table.
 *
 * `:m` is replaced with the signed-in user's merchant id at request time.
 */
const MERCHANT_REDIRECTS: Record<string, string> = {
  "/admin": "/m/:m",
  "/admin/analytics": "/m/:m",
  "/admin/customers": "/m/:m/clients",
  "/admin/leads": "/m/:m/clients?status=lead",
  "/admin/conversations": "/m/:m/clients",
  "/admin/appointments": "/m/:m/appointments",
  "/admin/calendar": "/m/:m/appointments?view=calendar",
  "/admin/orders": "/m/:m/shop",
  "/admin/payments": "/m/:m/shop?type=payments",
  "/admin/memberships": "/m/:m/memberships",
  "/admin/services": "/m/:m/app-builder?tab=products&type=service",
  "/admin/products": "/m/:m/app-builder?tab=products",
  "/admin/packages": "/m/:m/app-builder?tab=custom-plans",
  "/admin/loyalty": "/m/:m/app-builder?tab=rewards",
  "/admin/promotions": "/m/:m/app-builder?tab=offers",
  "/admin/notifications": "/m/:m/app-builder?tab=offers&type=campaigns",
  "/admin/staff": "/m/:m/app-builder?tab=settings&section=team",
  "/admin/locations": "/m/:m/app-builder?tab=settings&section=locations",
  "/admin/branding": "/m/:m/app-builder?tab=settings&section=branding",
  "/admin/settings": "/m/:m/app-builder?tab=settings&section=general",
  "/admin/audit-log": "/m/:m/app-builder?tab=settings&section=audit-log",
};

const AGENCY_REDIRECTS: Record<string, string> = {
  "/platform": "/agency",
  "/platform/tenants": "/agency",
  "/platform/tenants/new": "/agency",
};

function withPathnameHeaders(req: NextRequest, nonce: string, clinicHostSlug?: string) {
  // Server layouts have no direct access to the pathname; pass it down. The
  // nonce travels the same way, so a server component (the launch-screen
  // splash is the one that needs it) can put it on its own inline <script>.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  headers.set("x-nonce", nonce);
  // Set only when this request arrived on a clinic's own domain. The server
  // needs it to build links and the app's scope as "/" rather than
  // "/<slug>", and it is the middleware — not a page — that knows the host
  // belongs to that clinic. A request cannot set this itself: Headers built
  // from the incoming request are replaced here, not merged.
  if (clinicHostSlug) headers.set(CLINIC_HOST_HEADER, clinicHostSlug);
  else headers.delete(CLINIC_HOST_HEADER);
  return headers;
}

function withPathname(req: NextRequest, nonce: string, clinicHostSlug?: string) {
  return NextResponse.next({ request: { headers: withPathnameHeaders(req, nonce, clinicHostSlug) } });
}

/**
 * Which clinic answers on a host of its own, cached in this instance.
 *
 * Middleware runs on the Edge runtime and cannot reach the database, so the
 * map comes from /api/internal/clinic-hosts — which is Node, and can. One
 * fetch per instance per minute, never on the request path of a host we
 * already recognise (see `route`, which only asks for unknown hosts).
 *
 * Three deliberate properties: a failure keeps serving the last good copy,
 * because one bad read should not take every clinic's domain offline; a
 * failure with nothing cached yet answers "not a clinic domain", which shows
 * the landing page rather than a crash; and after a failure the next attempt
 * is seconds away, not a minute, so recovery is quick without hammering.
 */
const CLINIC_HOSTS_TTL_MS = 60_000;
const CLINIC_HOSTS_RETRY_MS = 5_000;
const CLINIC_HOSTS_PATH = "/api/internal/clinic-hosts";

let hostMap: { hosts: Record<string, string>; freshUntil: number } | null = null;

async function clinicSlugForHost(req: NextRequest, host: string): Promise<string | null> {
  const now = Date.now();
  if (!hostMap || now >= hostMap.freshUntil) {
    try {
      const response = await fetch(new URL(CLINIC_HOSTS_PATH, req.nextUrl.origin), { cache: "no-store" });
      if (!response.ok) throw new Error(`host map responded ${response.status}`);
      const body = (await response.json()) as { hosts?: Record<string, string> };
      hostMap = { hosts: body.hosts ?? {}, freshUntil: now + CLINIC_HOSTS_TTL_MS };
    } catch (err) {
      console.warn("[domain] could not read the host map:", err instanceof Error ? err.message : err);
      if (!hostMap) return null;
      hostMap = { hosts: hostMap.hosts, freshUntil: now + CLINIC_HOSTS_RETRY_MS };
    }
  }
  return Object.prototype.hasOwnProperty.call(hostMap.hosts, host) ? (hostMap.hosts[host] ?? null) : null;
}

/** Remembers the clinic being viewed, so /app (and login.deza.ai) reopens it next time. */
function rememberClinic(req: NextRequest, res: NextResponse, appPath: string) {
  const slug = slugFromAppPath(appPath);
  if (slug && req.cookies.get(LAST_CLINIC_COOKIE)?.value !== slug) {
    res.cookies.set(LAST_CLINIC_COOKIE, slug, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: req.nextUrl.protocol === "https:" });
  }
}

/**
 * Hosts this deployment already knows, so an unknown one can be looked up as
 * a clinic's domain without asking about every ordinary request. Covers the
 * three platform hosts and everything that is not a real domain: localhost,
 * a LAN address for phone testing, preview URLs, staging.
 */
function isKnownPlatformHost(host: string): boolean {
  if (!host) return true;
  if (isClientHost(host) || loginForHost(host)) return true;
  if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` || host === `staging.${ROOT_DOMAIN}`) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".vercel.app")) return true;
  // A bare address: localhost by another name, or a LAN phone test.
  return /^[\d.]+$/.test(host) || host.includes(":");
}

/** Everything that decides where a request goes. Headers are applied once, after, to whatever this returns. */
async function route(req: NextAuthRequest, nonce: string): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;
  const isAgencyAdmin = user?.role === "PLATFORM_ADMIN";
  const isMerchantUser = user?.role === "TENANT_ADMIN" || user?.role === "STAFF";

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");

  // --- the domain we moved off -------------------------------------------
  // Before everything else, or the old domain would be served rather than
  // left behind: the rewrite below would hand out real clinic pages on it,
  // "/" on an old subdomain would show the landing page, and the auth gates
  // would send visitors to a login whose cookie is scoped to a dead host.
  // 308 rather than 301 because /api is inside the matcher, and a POST to an
  // old API path must not quietly become a GET.
  const legacy = legacyRedirectUrl(host, pathname, req.nextUrl.search);
  if (legacy) return NextResponse.redirect(legacy, 308);

  // --- a clinic's own domain ---------------------------------------------
  // app.clinicname.nl is that one clinic's app and nothing else: "/" is its
  // home, "/shop" its shop, and the slug never appears. Looked up only for a
  // host this deployment does not already know, so ordinary traffic never
  // waits on it — and never for the endpoint that serves the map itself,
  // which would be a request calling itself.
  const normalisedHost = normaliseHost(host);
  if (pathname !== CLINIC_HOSTS_PATH && !isKnownPlatformHost(normalisedHost)) {
    const slug = await clinicSlugForHost(req, normalisedHost);
    if (slug) {
      // An /app/<slug> link still works but sits outside the installed app's
      // scope, so it goes to the short address — the same reasoning as the
      // shared client host below.
      const short = shortClientAppPath(pathname);
      if (short) {
        const url = req.nextUrl.clone();
        url.pathname = short.startsWith(`/${slug}`) ? short.slice(`/${slug}`.length) || "/" : short;
        return NextResponse.redirect(url, 308);
      }

      const target = clinicDomainRoute(pathname);
      // The staff portal and the admin console never run on a clinic's host.
      if (target.kind === "deny") return NextResponse.rewrite(new URL("/not-found", req.url));
      if (target.kind === "app") {
        const url = req.nextUrl.clone();
        url.pathname = `/app/${slug}${pathname === "/" ? "" : pathname}`;
        const res = NextResponse.rewrite(url, { request: { headers: withPathnameHeaders(req, nonce, slug) } });
        rememberClinic(req, res, url.pathname);
        return res;
      }
      return withPathname(req, nonce, slug);
    }
  }

  // --- the client host is the client app ---------------------------------
  // login.deza.ai/<clinic>/... serves /app/<clinic>/... without the client
  // ever seeing "/app", and the host itself opens "Find your clinic". A
  // rewrite, not a redirect, so the short address stays in the browser.
  // Reserved routes (/api, /login, /m, /agency, …) are untouched.
  if (isClientHost(host)) {
    // An old /app/<clinic> link still works, but it is outside the installed
    // app's scope — iOS would open it in Safari, address bar and all. Send it
    // to the short address so the app stays full screen.
    const short = shortClientAppPath(pathname);
    if (short) {
      const url = req.nextUrl.clone();
      url.pathname = short;
      return NextResponse.redirect(url, 308);
    }
    const target = clientAppPath(pathname);
    if (target) {
      const url = req.nextUrl.clone();
      url.pathname = target;
      const res = NextResponse.rewrite(url, { request: { headers: withPathnameHeaders(req, nonce) } });
      rememberClinic(req, res, target);
      return res;
    }
  }

  // --- custom subdomains open straight on their own login -----------------
  // app.deza.ai → clinic login, admin.deza.ai → admin login. Any
  // other host (*.vercel.app, localhost) keeps the three-portal landing page.
  // 307, not permanent, so browsers don't cache it if the mapping changes.
  if (pathname === "/") {
    const login = loginRedirectForHost(host);
    if (login) return NextResponse.redirect(login, 307);
  }

  // --- legacy auth entry points ------------------------------------------
  if (pathname === "/admin/login" || pathname === "/platform/login") {
    return NextResponse.redirect(new URL("/login", req.url), 301);
  }

  // --- legacy agency surfaces --------------------------------------------
  const agencyTarget = AGENCY_REDIRECTS[pathname] ?? (pathname.startsWith("/platform/") ? "/agency" : null);
  if (agencyTarget) {
    return NextResponse.redirect(new URL(agencyTarget, req.url), 301);
  }

  // --- legacy merchant surfaces ------------------------------------------
  if (pathname.startsWith("/admin")) {
    if (!user) return NextResponse.redirect(new URL("/login", req.url));
    // Agency admins have no merchant of their own to redirect into.
    if (isAgencyAdmin) return NextResponse.redirect(new URL("/agency", req.url), 302);

    const template = MERCHANT_REDIRECTS[pathname];
    const merchantId = user.tenantId;
    if (template && merchantId) {
      return NextResponse.redirect(new URL(template.replace(":m", merchantId), req.url), 301);
    }
    return NextResponse.redirect(new URL(merchantId ? `/m/${merchantId}` : "/login", req.url), 301);
  }

  // --- new surfaces -------------------------------------------------------
  if (pathname.startsWith("/agency")) {
    if (!user) return NextResponse.redirect(new URL("/login", req.url));
    // Merchant users must not learn that /agency exists.
    if (!isAgencyAdmin) return NextResponse.rewrite(new URL("/not-found", req.url));
    return withPathname(req, nonce);
  }

  if (pathname.startsWith("/m/")) {
    if (!user) return NextResponse.redirect(new URL("/login", req.url));
    if (!isAgencyAdmin && !isMerchantUser) return NextResponse.rewrite(new URL("/not-found", req.url));
    // Per-merchant ownership is checked in requireMerchantContext, which has
    // database access and returns a real 404.
    return withPathname(req, nonce);
  }

  // --- client app: remember the clinic, so /app reopens it next time ------
  if (pathname.startsWith("/app/")) {
    const res = withPathname(req, nonce);
    rememberClinic(req, res, pathname);
    return res;
  }

  return withPathname(req, nonce);
}

export default auth(async (req) => {
  // One nonce per request, carried two ways: on the response's CSP (so the
  // browser will run a script that names it) and on the request headers via
  // withPathnameHeaders (so the one page that needs it, the launch-screen
  // splash, can read it back with next/headers and put it on its script tag).
  const nonce = crypto.randomUUID();
  const res = await route(req, nonce);
  // The service worker's own script response is not a page and registers no
  // nonce of its own to satisfy a nonce-based script-src — Chrome refuses the
  // registration outright ("An unknown error occurred when fetching the
  // script") if this response carries one. It needs no CSP of its own.
  const isServiceWorker = req.nextUrl.pathname === "/client-sw.js";
  applySecurityHeaders(res.headers, nonce, req.nextUrl.protocol === "https:", { skipCsp: isServiceWorker });
  return res;
});

export const config = {
  // Everything except Next's own static output: the root domain turns any
  // first segment into a clinic, so the paths can't be listed in advance.
  // /.well-known is excluded outright: Apple fetches the Apple Pay domain
  // association file there, on every host, and follows no redirect.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|\\.well-known).*)"],
};
