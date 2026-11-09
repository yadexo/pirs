/**
 * Every link a client is given points at the same place.
 *
 * The clinic's own domain once it has one, the shared address otherwise —
 * and the shared one keeps working either way, because it is what everyone
 * already installed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("server-only", () => ({}));
const { clinicAppOrigin, clinicAppUrl, clinicJoinUrl } = await import("@/lib/clinic-app-link");
const { forgetClinicHosts } = await import("@/lib/clinic-hosts");

const stamp = Date.now();
const SLUG = `cal-${stamp}`;
// Deliberately shares no text with the slug, so "the slug is not in the
// link" is a real assertion rather than one the fixture makes impossible.
const HOST = `app.whitelabel-${stamp}.example`;

describe("links into a clinic's app", () => {
  let tenantId: string;
  const env = { ...process.env };

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug: SLUG, name: "Link Clinic" } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId).catch(() => undefined);
    process.env = env;
    forgetClinicHosts();
  });

  beforeEach(async () => {
    process.env.CLIENT_APP_URL = "https://login.deza.ai";
    process.env.APP_URL = "https://app.deza.ai";
    await rawDb.clinicDomain.deleteMany({ where: { tenantId } });
    forgetClinicHosts();
  });

  describe("with no domain of its own", () => {
    it("uses the shared client host, in the short shape", async () => {
      expect(await clinicAppUrl(SLUG)).toBe(`https://login.deza.ai/${SLUG}`);
      expect(await clinicAppUrl(SLUG, "/shop")).toBe(`https://login.deza.ai/${SLUG}/shop`);
      expect(await clinicJoinUrl(SLUG)).toBe(`https://login.deza.ai/${SLUG}?join=1`);
      expect(await clinicAppOrigin(SLUG)).toBe("https://login.deza.ai");
    });

    it("falls back to the long shape where no client host is configured", async () => {
      // Development and staging, where one host serves everything.
      delete process.env.CLIENT_APP_URL;
      forgetClinicHosts();
      expect(await clinicAppUrl(SLUG, "/shop")).toBe(`https://app.deza.ai/app/${SLUG}/shop`);
    });
  });

  describe("once it has a verified domain", () => {
    beforeEach(async () => {
      await rawDb.clinicDomain.create({ data: { tenantId, host: HOST, status: "VERIFIED", verifiedAt: new Date() } });
      forgetClinicHosts();
    });

    it("sends every kind of link there, with no slug in it", async () => {
      expect(await clinicAppOrigin(SLUG)).toBe(`https://${HOST}`);
      expect(await clinicAppUrl(SLUG)).toBe(`https://${HOST}`);
      expect(await clinicAppUrl(SLUG, "/shop")).toBe(`https://${HOST}/shop`);
      expect(await clinicJoinUrl(SLUG)).toBe(`https://${HOST}?join=1`);
      for (const url of [await clinicAppUrl(SLUG, "/shop"), await clinicJoinUrl(SLUG)]) expect(url).not.toContain(SLUG);
    });

    it("is always https, whatever the shared host is set to", async () => {
      process.env.CLIENT_APP_URL = "http://localhost:3000";
      forgetClinicHosts();
      expect(await clinicAppUrl(SLUG, "/shop")).toBe(`https://${HOST}/shop`);
    });
  });

  it("ignores a domain that has not verified yet", async () => {
    await rawDb.clinicDomain.create({ data: { tenantId, host: HOST, status: "PENDING" } });
    forgetClinicHosts();
    // Routing it early would send a client to a host with no certificate.
    expect(await clinicAppUrl(SLUG, "/shop")).toBe(`https://login.deza.ai/${SLUG}/shop`);
  });

  it("ignores another clinic's domain", async () => {
    const other = await rawDb.tenant.create({ data: { slug: `cal-other-${stamp}`, name: "Other" } });
    try {
      await rawDb.clinicDomain.create({ data: { tenantId: other.id, host: HOST, status: "VERIFIED", verifiedAt: new Date() } });
      forgetClinicHosts();
      expect(await clinicAppUrl(SLUG, "/shop")).toBe(`https://login.deza.ai/${SLUG}/shop`);
      expect(await clinicAppUrl(`cal-other-${stamp}`, "/shop")).toBe(`https://${HOST}/shop`);
    } finally {
      await deleteTenantCompletely(other.id);
    }
  });
});
