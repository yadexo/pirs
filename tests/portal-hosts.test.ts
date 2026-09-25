import { describe, it, expect } from "vitest";
import { ADMIN_LOGIN, CLINIC_LOGIN, clientAppPath, isClientHost, loginForHost, loginRedirectForHost, shortClientAppPath } from "@/lib/portal-hosts";

describe("subdomain logins", () => {
  it("sends the clinic subdomains to the clinic login", () => {
    expect(loginForHost("clinic.pirs.io")).toBe(CLINIC_LOGIN);
    expect(CLINIC_LOGIN).toBe("/login");
  });

  it("sends the admin subdomain to the admin login", () => {
    expect(loginForHost("admin.pirs.io")).toBe(ADMIN_LOGIN);
    expect(ADMIN_LOGIN).toBe("/login?next=%2Fagency");
  });

  it("ignores case, ports and a trailing dot", () => {
    expect(loginForHost("Admin.PIRS.io:443")).toBe(ADMIN_LOGIN);
    expect(loginForHost("clinic.pirs.io.")).toBe(CLINIC_LOGIN);
  });

  it("redirects on the same subdomain, over https", () => {
    expect(loginRedirectForHost("Admin.pirs.io:443")).toBe("https://admin.pirs.io/login?next=%2Fagency");
    expect(loginRedirectForHost("clinic.pirs.io")).toBe("https://clinic.pirs.io/login");
    expect(loginRedirectForHost("pirs.vercel.app")).toBeNull();
  });

  it("keeps the landing page everywhere else", () => {
    for (const host of ["pirs-git-main-yadexo.vercel.app", "pirs.vercel.app", "localhost:3000", "192.168.178.25:3443", "pirs.io", "clinics.pirs.io", "login.pirs.io", "evil.admin.pirs.io.example.com", "", null, undefined]) {
      expect(loginForHost(host)).toBeNull();
    }
  });
});

describe("the root domain serves the client app", () => {
  it("knows which hosts are the client app", () => {
    for (const host of ["pirs.io", "www.pirs.io", "PIRS.io:443"]) expect(isClientHost(host)).toBe(true);
    for (const host of ["clinic.pirs.io", "admin.pirs.io", "pirs.vercel.app", "localhost:3000", "", null]) expect(isClientHost(host)).toBe(false);
  });

  it("turns the first path segment into a clinic", () => {
    expect(clientAppPath("/riverside-wellness")).toBe("/app/riverside-wellness");
    expect(clientAppPath("/riverside-wellness/shop")).toBe("/app/riverside-wellness/shop");
    expect(clientAppPath("/riverside-wellness/shop?tab=treatments")).toBe("/app/riverside-wellness/shop?tab=treatments");
    // The bare domain opens "Find your clinic".
    expect(clientAppPath("/")).toBe("/app");
  });

  it("leaves the app's own routes alone", () => {
    for (const path of ["/api/health", "/login", "/m/abc", "/agency", "/agency/settings", "/set-password", "/forgot-password", "/app/riverside", "/client-sw.js", "/favicon.ico", "/uploads/x.png"]) {
      expect(clientAppPath(path)).toBeNull();
    }
  });
});

describe("the short address on the root domain", () => {
  it("turns a long client-app path into the short one", () => {
    expect(shortClientAppPath("/app/riverside/shop")).toBe("/riverside/shop");
    expect(shortClientAppPath("/app/riverside")).toBe("/riverside");
    expect(shortClientAppPath("/app")).toBe("/");
    expect(shortClientAppPath("/app/")).toBe("/");
  });

  it("leaves anything that isn't a client-app path alone", () => {
    expect(shortClientAppPath("/riverside/shop")).toBeNull();
    expect(shortClientAppPath("/application/form")).toBeNull();
    expect(shortClientAppPath("/m/abc")).toBeNull();
    expect(shortClientAppPath("/")).toBeNull();
  });
});
