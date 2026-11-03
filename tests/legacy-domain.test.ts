import { describe, it, expect, afterEach, vi } from "vitest";
import { ADMIN, CLIENT, LEGACY_ADMIN, LEGACY_CLINIC, LEGACY_LOGIN, LEGACY_ROOT, LEGACY_STAGING, LEGACY_WWW, PORTAL, ROOT, STAGING } from "./fixtures/hosts";

/**
 * The redirect off the old domain, and the two paths that must survive it.
 *
 * LEGACY_ROOT_DOMAIN is read at module level, so each case needs a fresh
 * module registry — the same pattern as tests/portal-hosts-env.test.ts.
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function withLegacy(value: string | undefined, env: Record<string, string> = {}) {
  if (value === undefined) delete process.env.LEGACY_ROOT_DOMAIN;
  else process.env.LEGACY_ROOT_DOMAIN = value;
  for (const [key, v] of Object.entries(env)) process.env[key] = v;
  vi.resetModules();
  return import("@/lib/legacy-domain");
}

describe("redirecting off the old domain", () => {
  it("carries every address shape to the host that replaced it", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);

    // The short clinic link a poster carries: the old apex was the client app.
    expect(legacyRedirectUrl(LEGACY_ROOT, "/riverside")).toBe(`https://${CLIENT}/riverside`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/")).toBe(`https://${CLIENT}/`);
    // The long form; the new host's own middleware then shortens it.
    expect(legacyRedirectUrl(LEGACY_ROOT, "/app/riverside")).toBe(`https://${CLIENT}/app/riverside`);
    // A clinic portal deep link, and the check-in/QR shape.
    expect(legacyRedirectUrl(LEGACY_CLINIC, "/m/abc123/clients")).toBe(`https://${PORTAL}/m/abc123/clients`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/m/abc123")).toBe(`https://${CLIENT}/m/abc123`);
    expect(legacyRedirectUrl(LEGACY_ADMIN, "/agency/white-label")).toBe(`https://${ADMIN}/agency/white-label`);
    expect(legacyRedirectUrl(LEGACY_STAGING, "/app/riverside")).toBe(`https://${STAGING}/app/riverside`);
  });

  it("sends the old login subdomain to the portal, which is what it opens today", async () => {
    // login.<old> is a redirect to the staff login at the hosting layer. The
    // label moved to the client app on the new domain, so following the label
    // rather than the meaning would land staff in a client's app.
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);
    expect(legacyRedirectUrl(LEGACY_LOGIN, "/")).toBe(`https://${PORTAL}/`);
    expect(legacyRedirectUrl(LEGACY_LOGIN, "/login")).toBe(`https://${PORTAL}/login`);
  });

  it("keeps the query string", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/riverside", "?join=1")).toBe(`https://${CLIENT}/riverside?join=1`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/riverside/shop", "?tab=treatments")).toBe(`https://${CLIENT}/riverside/shop?tab=treatments`);
  });

  it("sends www to the client app, never to the apex", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);
    expect(legacyRedirectUrl(LEGACY_WWW, "/riverside")).toBe(`https://${CLIENT}/riverside`);
    // Not redundant: folding www into the bare root is the obvious way to
    // write this, and on the new domain the bare root is somebody else's
    // marketing site. A 308 is cached for good, so the mistake would stick.
    expect(legacyRedirectUrl(LEGACY_WWW, "/riverside")).not.toBe(`https://${ROOT}/riverside`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/riverside")).not.toBe(`https://${ROOT}/riverside`);
  });

  it("follows the configured root domain rather than a built-in one", async () => {
    const { legacyRedirectUrl } = await withLegacy("old.test", { NEXT_PUBLIC_ROOT_DOMAIN: "example.test" });

    expect(legacyRedirectUrl("old.test", "/riverside")).toBe("https://login.example.test/riverside");
    expect(legacyRedirectUrl("clinic.old.test", "/login")).toBe("https://app.example.test/login");
    expect(legacyRedirectUrl("admin.old.test", "/agency")).toBe("https://admin.example.test/agency");
    expect(legacyRedirectUrl("staging.old.test", "/app/x")).toBe("https://staging.example.test/app/x");
  });

  it("ignores case, ports and a trailing dot, like every other host check", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);
    expect(legacyRedirectUrl(`${LEGACY_ROOT.toUpperCase()}:443`, "/riverside")).toBe(`https://${CLIENT}/riverside`);
    expect(legacyRedirectUrl(`${LEGACY_ROOT}.`, "/riverside")).toBe(`https://${CLIENT}/riverside`);
    expect(legacyRedirectUrl(`${LEGACY_CLINIC.toUpperCase()}`, "/login")).toBe(`https://${PORTAL}/login`);
  });

  it("leaves every other host alone", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);

    // Our old domain as somebody else's prefix is somebody else's domain.
    expect(legacyRedirectUrl(`${LEGACY_ROOT}.evil.com`, "/riverside")).toBeNull();
    // A bare suffix match would catch this; exact equality does not.
    expect(legacyRedirectUrl(`not${LEGACY_ROOT}`, "/")).toBeNull();
    // An old subdomain nobody listed is served, not sent to a guessed host.
    expect(legacyRedirectUrl(`shop.${LEGACY_ROOT}`, "/riverside")).toBeNull();
    expect(legacyRedirectUrl(`a.b.${LEGACY_ROOT}`, "/")).toBeNull();
    // The new hosts must never redirect to themselves.
    expect(legacyRedirectUrl(CLIENT, "/riverside")).toBeNull();
    expect(legacyRedirectUrl(PORTAL, "/login")).toBeNull();
    expect(legacyRedirectUrl(ROOT, "/riverside")).toBeNull();
    for (const host of ["localhost:3000", "192.168.178.25:3443", "pirs.vercel.app", "", null, undefined]) {
      expect(legacyRedirectUrl(host, "/riverside")).toBeNull();
    }
  });

  it("answers a host named after a property every object has", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);
    // An object literal would find these on Object.prototype and build a URL
    // out of whatever it found. The host is a request header, so they are
    // strings somebody can send.
    for (const host of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(legacyRedirectUrl(host, "/riverside")).toBeNull();
    }
  });
});

describe("the paths that keep answering on the old domain", () => {
  it("never redirects the Stripe webhook or any cron job", async () => {
    const { legacyRedirectUrl, LEGACY_EXEMPT } = await withLegacy(LEGACY_ROOT);

    for (const host of [LEGACY_ROOT, LEGACY_WWW, LEGACY_CLINIC, LEGACY_ADMIN, LEGACY_STAGING, LEGACY_LOGIN]) {
      expect(legacyRedirectUrl(host, "/api/webhooks/stripe")).toBeNull();
      expect(legacyRedirectUrl(host, "/api/cron")).toBeNull();
      for (const job of ["cleanup", "marketing", "memberships"]) {
        expect(legacyRedirectUrl(host, `/api/cron/${job}`)).toBeNull();
      }
    }

    // The test and the code agree about what the list is.
    expect([...LEGACY_EXEMPT]).toEqual(["/api/webhooks/stripe", "/api/cron"]);
  });

  it("does not exempt more than those two", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);

    // A prefix match alone would wrongly catch these.
    expect(legacyRedirectUrl(LEGACY_ROOT, "/api/webhooks/stripe-other")).toBe(`https://${CLIENT}/api/webhooks/stripe-other`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/api/cronjobs")).toBe(`https://${CLIENT}/api/cronjobs`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/api/health")).toBe(`https://${CLIENT}/api/health`);
    expect(legacyRedirectUrl(LEGACY_CLINIC, "/api/uploads")).toBe(`https://${PORTAL}/api/uploads`);
  });
});

describe("the switch", () => {
  it("redirects nothing at all when no legacy domain is set", async () => {
    for (const value of [undefined, "", "   "]) {
      const { legacyRedirectUrl } = await withLegacy(value);
      for (const host of [LEGACY_ROOT, LEGACY_WWW, LEGACY_CLINIC, LEGACY_ADMIN, LEGACY_STAGING, LEGACY_LOGIN]) {
        expect(legacyRedirectUrl(host, "/riverside")).toBeNull();
        expect(legacyRedirectUrl(host, "/")).toBeNull();
      }
      // Same answer as with the switch on, for a different reason — the
      // exemption does not depend on it.
      expect(legacyRedirectUrl(LEGACY_ROOT, "/api/cron/cleanup")).toBeNull();
    }
  });
});
