import { describe, it, expect } from "vitest";
import { ADMIN_LOGIN, CLINIC_LOGIN, loginForHost, loginRedirectForHost } from "@/lib/portal-hosts";

describe("subdomain logins", () => {
  it("sends the clinic subdomains to the clinic login", () => {
    for (const host of ["clinic.pirs.io", "login.pirs.io"]) expect(loginForHost(host)).toBe(CLINIC_LOGIN);
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
    expect(loginRedirectForHost("login.pirs.io")).toBe("https://login.pirs.io/login");
    expect(loginRedirectForHost("pirs.vercel.app")).toBeNull();
  });

  it("keeps the landing page everywhere else", () => {
    for (const host of ["pirs-git-main-yadexo.vercel.app", "pirs.vercel.app", "localhost:3000", "192.168.178.25:3443", "pirs.io", "clinics.pirs.io", "evil.admin.pirs.io.example.com", "", null, undefined]) {
      expect(loginForHost(host)).toBeNull();
    }
  });
});
