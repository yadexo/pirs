import { describe, it, expect } from "vitest";
import { CLIENT_HOST, PORTAL_HOST, ADMIN_HOST, ROOT_DOMAIN, clinicDomainRoute, CLINIC_HOST_HEADER } from "@/lib/portal-hosts";

/**
 * What a clinic's own host does with a path.
 *
 * On that host the clinic is the whole site, so the first segment is one of
 * its pages — not a slug, and not a door into anything of the platform's.
 */
describe("paths on a clinic's own domain", () => {
  const kindOf = (pathname: string) => clinicDomainRoute(pathname).kind;

  it("serves the clinic's app at the root and at its own pages", () => {
    for (const path of ["/", "/shop", "/rewards", "/profile", "/scan", "/shop/anything/deeper"]) {
      expect(kindOf(path), path).toBe("app");
    }
  });

  it("treats another clinic's slug as a page of this clinic, which is a 404", () => {
    // "/other-clinic" becomes "/app/<this clinic>/other-clinic". There is no
    // such page, so it 404s — the other clinic is simply not reachable here.
    expect(kindOf("/other-clinic")).toBe("app");
  });

  it("refuses the staff portal, the admin console and sign-in", () => {
    for (const path of ["/login", "/login?next=/agency", "/logout", "/m/abc123", "/agency", "/agency/settings", "/admin", "/register/clinic", "/account/two-factor"]) {
      expect(kindOf(path), path).toBe("deny");
    }
  });

  it("serves the app's own plumbing unchanged", () => {
    for (const path of ["/api/client-auth/session", "/_next/data/x.json", "/uploads/logo.png", "/client-sw.js", "/favicon.ico", "/robots.txt"]) {
      expect(kindOf(path), path).toBe("as-is");
    }
  });

  it("serves the clinic's own manifest and icons, which live at the root here", () => {
    // Not a root file despite the dot: on this host the first segment is a
    // page of the app, and the manifest is the clinic's own.
    expect(kindOf("/manifest.webmanifest")).toBe("app");
    expect(kindOf("/app-icon/192.png")).toBe("app");
    expect(kindOf("/launch-image/x.png")).toBe("app");
  });

  it("serves the shared password pages, which a client reaches by email on this host", () => {
    // A client's reset link opens on the origin they use, which is this one.
    expect(kindOf("/set-password")).toBe("as-is");
    expect(kindOf("/forgot-password")).toBe("as-is");
  });

  it("is not case-sensitive about the platform's own paths", () => {
    expect(kindOf("/Login")).toBe("deny");
    expect(kindOf("/AGENCY")).toBe("deny");
  });
});

describe("the header the middleware uses to say which clinic a host is", () => {
  it("is a request header a page can read", () => {
    expect(CLINIC_HOST_HEADER).toBe("x-clinic-host");
  });
});

describe("hosts a clinic domain is never confused with", () => {
  it("the three platform hosts are distinct from each other", () => {
    expect(new Set([CLIENT_HOST, PORTAL_HOST, ADMIN_HOST, ROOT_DOMAIN]).size).toBe(4);
  });
});
