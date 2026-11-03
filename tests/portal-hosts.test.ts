import { describe, it, expect } from "vitest";
import { ADMIN_LOGIN, CLINIC_LOGIN, clientAppPath, clientHosts, isClientHost, loginForHost, loginRedirectForHost, shortClientAppPath, clientAppScope } from "@/lib/portal-hosts";
import { ADMIN, CLIENT, PORTAL, ROOT, STAGING, WWW } from "./fixtures/hosts";

describe("subdomain logins", () => {
  it("sends the clinic portal host to the clinic login", () => {
    expect(loginForHost(PORTAL)).toBe(CLINIC_LOGIN);
    expect(CLINIC_LOGIN).toBe("/login");
  });

  it("sends the admin subdomain to the admin login", () => {
    expect(loginForHost(ADMIN)).toBe(ADMIN_LOGIN);
    expect(ADMIN_LOGIN).toBe("/login?next=%2Fagency");
  });

  it("ignores case, ports and a trailing dot", () => {
    expect(loginForHost(`${ADMIN.toUpperCase()}:443`)).toBe(ADMIN_LOGIN);
    expect(loginForHost(`${PORTAL}.`)).toBe(CLINIC_LOGIN);
  });

  it("redirects on the same subdomain, over https", () => {
    expect(loginRedirectForHost(`${ADMIN.toUpperCase()}:443`)).toBe(`https://${ADMIN}/login?next=%2Fagency`);
    expect(loginRedirectForHost(PORTAL)).toBe(`https://${PORTAL}/login`);
    expect(loginRedirectForHost("pirs.vercel.app")).toBeNull();
  });

  it("keeps the landing page everywhere else", () => {
    // The two vercel.app hosts are the real preview URLs, which come from the
    // Vercel project name and are deliberately not renamed with the brand.
    // The client host belongs here too: it serves the client app, not a login.
    for (const host of ["pirs-git-main-yadexo.vercel.app", "pirs.vercel.app", "localhost:3000", "192.168.178.25:3443", ROOT, WWW, CLIENT, STAGING, `clinics.${ROOT}`, `evil.${ADMIN}.example.com`, "", null, undefined]) {
      expect(loginForHost(host)).toBeNull();
    }
  });

  it("answers a host named after a property every object has", () => {
    // The host arrives in a request header, so "constructor" is a string
    // somebody can send. An object literal would return Object itself here.
    for (const host of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(loginForHost(host)).toBeNull();
      expect(loginRedirectForHost(host)).toBeNull();
      expect(isClientHost(host)).toBe(false);
    }
  });
});

describe("the client host serves the client app", () => {
  it("knows which hosts are the client app", () => {
    for (const host of [CLIENT, `${CLIENT.toUpperCase()}:443`]) expect(isClientHost(host)).toBe(true);
    // The apex and www are a separate marketing site; staging serves the long form.
    for (const host of [ROOT, WWW, STAGING, PORTAL, ADMIN, "pirs.vercel.app", "localhost:3000", "", null]) expect(isClientHost(host)).toBe(false);
  });

  it("exposes the list, so it can grow past one host", () => {
    expect(clientHosts()).toContain(CLIENT);
    expect(clientHosts()).not.toContain(ROOT);
    // A copy: a caller cannot widen what the middleware routes on.
    expect(clientHosts()).not.toBe(clientHosts());
  });

  it("turns the first path segment into a clinic", () => {
    expect(clientAppPath("/riverside-wellness")).toBe("/app/riverside-wellness");
    expect(clientAppPath("/riverside-wellness/shop")).toBe("/app/riverside-wellness/shop");
    expect(clientAppPath("/riverside-wellness/shop?tab=treatments")).toBe("/app/riverside-wellness/shop?tab=treatments");
    // The bare host opens "Find your clinic".
    expect(clientAppPath("/")).toBe("/app");
  });

  it("leaves the app's own routes alone", () => {
    for (const path of ["/api/health", "/login", "/m/abc", "/agency", "/agency/settings", "/set-password", "/forgot-password", "/app/riverside", "/client-sw.js", "/favicon.ico", "/uploads/x.png"]) {
      expect(clientAppPath(path)).toBeNull();
    }
  });
});

describe("the short address on the client host", () => {
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

describe("the installed app's scope", () => {
  it("is the whole client host, where every path is the client app", () => {
    expect(clientAppScope(CLIENT)).toBe("/");
  });

  it("is only /app/ elsewhere, keeping the clinic and agency surfaces out", () => {
    expect(clientAppScope(PORTAL)).toBe("/app/");
    expect(clientAppScope(STAGING)).toBe("/app/");
    expect(clientAppScope("localhost:3000")).toBe("/app/");
    expect(clientAppScope(null)).toBe("/app/");
  });

  it("always ends in a slash — iOS treats a scope without one as a single page", () => {
    for (const host of [CLIENT, PORTAL, null]) expect(clientAppScope(host).endsWith("/")).toBe(true);
  });
});
