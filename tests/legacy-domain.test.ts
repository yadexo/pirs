import { describe, it, expect, afterEach, vi } from "vitest";
import { LEGACY_CLINIC, LEGACY_ADMIN, LEGACY_LOGIN, LEGACY_ROOT, LEGACY_STAGING, LEGACY_WWW, ROOT } from "./fixtures/hosts";

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

async function withLegacy(value: string | undefined) {
  if (value === undefined) delete process.env.LEGACY_ROOT_DOMAIN;
  else process.env.LEGACY_ROOT_DOMAIN = value;
  vi.resetModules();
  return import("@/lib/legacy-domain");
}

describe("redirecting off the old domain", () => {
  it("carries every address shape to the same path on the new domain", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);

    // The short clinic link a poster carries.
    expect(legacyRedirectUrl(LEGACY_ROOT, "/riverside")).toBe(`https://${ROOT}/riverside`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/")).toBe(`https://${ROOT}/`);
    // The long form; the new domain's own middleware then shortens it.
    expect(legacyRedirectUrl(LEGACY_ROOT, "/app/riverside")).toBe(`https://${ROOT}/app/riverside`);
    // A clinic portal deep link, and the check-in/QR shape.
    expect(legacyRedirectUrl(LEGACY_CLINIC, "/m/abc123/clients")).toBe(`https://clinic.${ROOT}/m/abc123/clients`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/m/abc123")).toBe(`https://${ROOT}/m/abc123`);
    expect(legacyRedirectUrl(LEGACY_ADMIN, "/agency/white-label")).toBe(`https://admin.${ROOT}/agency/white-label`);
    // Subdomains with no special case of their own still move.
    expect(legacyRedirectUrl(LEGACY_STAGING, "/app/riverside")).toBe(`https://staging.${ROOT}/app/riverside`);
    expect(legacyRedirectUrl(LEGACY_LOGIN, "/")).toBe(`https://login.${ROOT}/`);
  });

  it("keeps the query string", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/riverside", "?join=1")).toBe(`https://${ROOT}/riverside?join=1`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/riverside/shop", "?tab=treatments")).toBe(`https://${ROOT}/riverside/shop?tab=treatments`);
  });

  it("folds www into the bare root, so there is only one hop", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);
    expect(legacyRedirectUrl(LEGACY_WWW, "/riverside")).toBe(`https://${ROOT}/riverside`);
  });

  it("ignores case, ports and a trailing dot, like every other host check", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);
    expect(legacyRedirectUrl(`${LEGACY_ROOT.toUpperCase()}:443`, "/riverside")).toBe(`https://${ROOT}/riverside`);
    expect(legacyRedirectUrl(`${LEGACY_ROOT}.`, "/riverside")).toBe(`https://${ROOT}/riverside`);
    expect(legacyRedirectUrl(`${LEGACY_CLINIC.toUpperCase()}`, "/login")).toBe(`https://clinic.${ROOT}/login`);
  });

  it("leaves every other host alone", async () => {
    const { legacyRedirectUrl } = await withLegacy(LEGACY_ROOT);

    // Our old domain as somebody else's prefix is somebody else's domain.
    expect(legacyRedirectUrl(`${LEGACY_ROOT}.evil.com`, "/riverside")).toBeNull();
    // A bare suffix match would catch this; a label-boundary match does not.
    expect(legacyRedirectUrl(`not${LEGACY_ROOT}`, "/")).toBeNull();
    // The new domain must never redirect to itself.
    expect(legacyRedirectUrl(ROOT, "/riverside")).toBeNull();
    expect(legacyRedirectUrl(`clinic.${ROOT}`, "/login")).toBeNull();
    for (const host of ["localhost:3000", "192.168.178.25:3443", "pirs.vercel.app", "", null, undefined]) {
      expect(legacyRedirectUrl(host, "/riverside")).toBeNull();
    }
  });
});

describe("the paths that keep answering on the old domain", () => {
  it("never redirects the Stripe webhook or any cron job", async () => {
    const { legacyRedirectUrl, LEGACY_EXEMPT } = await withLegacy(LEGACY_ROOT);

    for (const host of [LEGACY_ROOT, LEGACY_WWW, LEGACY_CLINIC, LEGACY_ADMIN, LEGACY_STAGING]) {
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
    expect(legacyRedirectUrl(LEGACY_ROOT, "/api/webhooks/stripe-other")).toBe(`https://${ROOT}/api/webhooks/stripe-other`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/api/cronjobs")).toBe(`https://${ROOT}/api/cronjobs`);
    expect(legacyRedirectUrl(LEGACY_ROOT, "/api/health")).toBe(`https://${ROOT}/api/health`);
    expect(legacyRedirectUrl(LEGACY_CLINIC, "/api/uploads")).toBe(`https://clinic.${ROOT}/api/uploads`);
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
