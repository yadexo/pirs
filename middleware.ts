import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const CUSTOMER_PROTECTED_SEGMENTS = [
  "account",
  "checkout",
  "basket",
  "appointments",
  "orders",
  "loyalty",
  "messages",
  "notifications",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!user || (user.role !== "TENANT_ADMIN" && user.role !== "STAFF")) {
      const url = new URL("/admin/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/platform") && pathname !== "/platform/login") {
    if (!user || user.role !== "PLATFORM_ADMIN") {
      return NextResponse.redirect(new URL("/platform/login", req.url));
    }
  }

  const segments = pathname.split("/").filter(Boolean);
  const [tenantSlug, section] = segments;
  const isReservedPrefix = ["admin", "platform", "api", "uploads", "_next"].includes(tenantSlug ?? "");

  if (tenantSlug && !isReservedPrefix && section && CUSTOMER_PROTECTED_SEGMENTS.includes(section)) {
    if (!user || user.role !== "CUSTOMER") {
      const url = new URL(`/${tenantSlug}/login`, req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (user.tenantSlug !== tenantSlug) {
      // A customer of a different clinic tried to reach this tenant's protected area.
      return NextResponse.redirect(new URL(`/${tenantSlug}/login`, req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/admin/:path*",
    "/platform/:path*",
    "/:tenant/account/:path*",
    "/:tenant/checkout/:path*",
    "/:tenant/basket/:path*",
    "/:tenant/appointments/:path*",
    "/:tenant/orders/:path*",
    "/:tenant/loyalty/:path*",
    "/:tenant/messages/:path*",
    "/:tenant/notifications/:path*",
  ],
};
