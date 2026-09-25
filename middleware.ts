import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/auth.config";
import { LAST_CLINIC_COOKIE, slugFromAppPath } from "@/lib/clinic-link";
import { clientAppPath, isClientHost, loginRedirectForHost, shortClientAppPath } from "@/lib/portal-hosts";

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

function withPathnameHeaders(req: NextRequest) {
  // Server layouts have no direct access to the pathname; pass it down.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return headers;
}

function withPathname(req: NextRequest) {
  return NextResponse.next({ request: { headers: withPathnameHeaders(req) } });
}

/** Remembers the clinic being viewed, so /app (and pirs.io) reopens it next time. */
function rememberClinic(req: NextRequest, res: NextResponse, appPath: string) {
  const slug = slugFromAppPath(appPath);
  if (slug && req.cookies.get(LAST_CLINIC_COOKIE)?.value !== slug) {
    res.cookies.set(LAST_CLINIC_COOKIE, slug, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: req.nextUrl.protocol === "https:" });
  }
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;
  const isAgencyAdmin = user?.role === "PLATFORM_ADMIN";
  const isMerchantUser = user?.role === "TENANT_ADMIN" || user?.role === "STAFF";

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");

  // --- the root domain is the client app ---------------------------------
  // pirs.io/<clinic>/... serves /app/<clinic>/... without the client ever
  // seeing "/app", and pirs.io itself opens "Find your clinic". A rewrite, not
  // a redirect, so the short address stays in the browser. Reserved routes
  // (/api, /login, /m, /agency, …) are untouched.
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
      const res = NextResponse.rewrite(url, { request: { headers: withPathnameHeaders(req) } });
      rememberClinic(req, res, target);
      return res;
    }
  }

  // --- custom subdomains open straight on their own login -----------------
  // clinic.pirs.io → clinic login, admin.pirs.io → admin login. Any
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
    return withPathname(req);
  }

  if (pathname.startsWith("/m/")) {
    if (!user) return NextResponse.redirect(new URL("/login", req.url));
    if (!isAgencyAdmin && !isMerchantUser) return NextResponse.rewrite(new URL("/not-found", req.url));
    // Per-merchant ownership is checked in requireMerchantContext, which has
    // database access and returns a real 404.
    return withPathname(req);
  }

  // --- client app: remember the clinic, so /app reopens it next time ------
  if (pathname.startsWith("/app/")) {
    const res = withPathname(req);
    rememberClinic(req, res, pathname);
    return res;
  }

  return withPathname(req);
});

export const config = {
  // Everything except Next's own static output: the root domain turns any
  // first segment into a clinic, so the paths can't be listed in advance.
  // /.well-known is excluded outright: Apple fetches the Apple Pay domain
  // association file there, on every host, and follows no redirect.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|\\.well-known).*)"],
};
