/**
 * A push payload carries a path, and the service worker resolves it against
 * its own origin — so the same path means different things to a client who
 * installed from the clinic's domain and one who installed from the shared
 * host. Getting this wrong sends half of them to a 404.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("server-only", () => ({}));
const { pushBasePath } = await import("@/lib/push-base-path");
const { forgetClinicHosts } = await import("@/lib/clinic-hosts");

const stamp = Date.now();
const SLUG = `pbp-${stamp}`;
const HOST = `app.whitelabel-${stamp}.example`;

describe("where a clinic's app sits on the origin a device subscribed from", () => {
  let tenantId: string;
  const env = { ...process.env };

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug: SLUG, name: "Push Base Clinic" } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId).catch(() => undefined);
    process.env = env;
    forgetClinicHosts();
  });

  beforeEach(async () => {
    process.env.CLIENT_APP_URL = "https://login.deza.ai";
    process.env.NEXT_PUBLIC_CLIENT_HOST = "login.deza.ai";
    await rawDb.clinicDomain.deleteMany({ where: { tenantId } });
    forgetClinicHosts();
  });

  it("is nothing at all on the clinic's own domain — the host is the app", async () => {
    await rawDb.clinicDomain.create({ data: { tenantId, host: HOST, status: "VERIFIED", verifiedAt: new Date() } });
    forgetClinicHosts();
    expect(await pushBasePath(`https://${HOST}`, SLUG)).toBe("");
  });

  it("is the slug on the shared client host", async () => {
    expect(await pushBasePath("https://login.deza.ai", SLUG)).toBe(`/${SLUG}`);
  });

  it("is under /app anywhere else — a preview URL, the portal host, localhost", async () => {
    for (const origin of ["https://app.deza.ai", "https://my-app.vercel.app", "http://localhost:3000"]) {
      expect(await pushBasePath(origin, SLUG), origin).toBe(`/app/${SLUG}`);
    }
  });

  it("reads a subscription from before domains existed as the shared host", async () => {
    // Every row predating this column was made on the shared address, so a
    // null needs no backfill to be right.
    expect(await pushBasePath(null, SLUG)).toBe(`/${SLUG}`);
    expect(await pushBasePath(undefined, SLUG)).toBe(`/${SLUG}`);
    delete process.env.CLIENT_APP_URL;
    expect(await pushBasePath(null, SLUG)).toBe(`/app/${SLUG}`);
  });

  it("will not put one clinic's device inside another clinic's app", async () => {
    const other = await rawDb.tenant.create({ data: { slug: `pbp-other-${stamp}`, name: "Other" } });
    try {
      await rawDb.clinicDomain.create({ data: { tenantId: other.id, host: HOST, status: "VERIFIED", verifiedAt: new Date() } });
      forgetClinicHosts();
      // The host belongs to the other clinic, so for this one it is just
      // another host this deployment answers on.
      expect(await pushBasePath(`https://${HOST}`, SLUG)).toBe(`/app/${SLUG}`);
    } finally {
      await deleteTenantCompletely(other.id);
    }
  });

  it("treats a domain that has not verified as not routable", async () => {
    await rawDb.clinicDomain.create({ data: { tenantId, host: HOST, status: "PENDING" } });
    forgetClinicHosts();
    expect(await pushBasePath(`https://${HOST}`, SLUG)).toBe(`/app/${SLUG}`);
  });

  it("is not thrown by rubbish where an origin should be", async () => {
    for (const origin of ["", "not a url", "://", "javascript:alert(1)"]) {
      expect(await pushBasePath(origin, SLUG), origin).toBe(`/${SLUG}`);
    }
  });
});
