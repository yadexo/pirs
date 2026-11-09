/**
 * The host -> clinic map: what goes in it, and how its cache behaves. The
 * middleware routes on this, so "only verified domains of active clinics" is
 * the whole security property — a pending domain routed early would serve a
 * clinic's app on a host whose certificate does not exist yet.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("server-only", () => ({}));
const { CLINIC_HOST_TTL_MS, clinicHostMap, clinicSlugForHost, forgetClinicHosts, readClinicHostMap } = await import("@/lib/clinic-hosts");

const stamp = Date.now();
const slugOf = (name: string) => `ch-${name}-${stamp}`;
const hostOf = (name: string) => `${name}.clinic-${stamp}.example`;

describe("the clinic host map", () => {
  let liveId: string;
  let pendingId: string;
  let suspendedId: string;

  beforeAll(async () => {
    const clinic = async (name: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE") =>
      (await rawDb.tenant.create({ data: { slug: slugOf(name), name: `Host ${name}`, status } })).id;

    liveId = await clinic("live");
    pendingId = await clinic("pending");
    suspendedId = await clinic("suspended", "SUSPENDED");

    await rawDb.clinicDomain.createMany({
      data: [
        { tenantId: liveId, host: hostOf("live"), status: "VERIFIED", verifiedAt: new Date() },
        { tenantId: pendingId, host: hostOf("pending"), status: "PENDING" },
        { tenantId: suspendedId, host: hostOf("suspended"), status: "VERIFIED", verifiedAt: new Date() },
      ],
    });
  });

  afterAll(async () => {
    for (const id of [liveId, pendingId, suspendedId]) await deleteTenantCompletely(id).catch(() => undefined);
    forgetClinicHosts();
  });

  beforeEach(() => forgetClinicHosts());

  it("has the verified domain of an active clinic", async () => {
    expect((await readClinicHostMap()).hosts[hostOf("live")]).toBe(slugOf("live"));
  });

  it("leaves out a domain that has not verified yet", async () => {
    // Routing it early would serve the app on a host with no certificate.
    expect((await readClinicHostMap()).hosts).not.toHaveProperty(hostOf("pending"));
  });

  it("leaves out a suspended clinic, however verified its domain is", async () => {
    expect((await readClinicHostMap()).hosts).not.toHaveProperty(hostOf("suspended"));
  });

  it("carries nothing but hosts and slugs", async () => {
    const map = await readClinicHostMap();
    expect(Object.keys(map).sort()).toEqual(["generatedAt", "hosts"]);
    const text = JSON.stringify(map);
    expect(text).not.toContain("Host live");
    expect(text).not.toContain(liveId);
  });

  describe("looking a host up", () => {
    it("finds the clinic, whatever case or port the host arrives in", async () => {
      for (const host of [hostOf("live"), hostOf("live").toUpperCase(), `${hostOf("live")}:443`, `${hostOf("live")}.`]) {
        expect(await clinicSlugForHost(host), host).toBe(slugOf("live"));
      }
    });

    it("is null for a host nobody has attached, and for nothing at all", async () => {
      for (const host of [hostOf("nobody"), "", null, undefined, hostOf("pending")]) {
        expect(await clinicSlugForHost(host), String(host)).toBeNull();
      }
    });

    it("cannot be tricked into answering for a property every object has", async () => {
      // The map is a plain lookup; "constructor" must not resolve to a clinic.
      for (const host of ["constructor", "__proto__", "tostring", "hasownproperty"]) {
        expect(await clinicSlugForHost(host), host).toBeNull();
      }
    });
  });

  describe("the cache", () => {
    it("serves the same copy inside its window, and a fresh one after", async () => {
      const first = await clinicHostMap(0);
      const cached = await clinicHostMap(CLINIC_HOST_TTL_MS - 1);
      expect(cached.generatedAt).toBe(first.generatedAt);

      const later = await clinicHostMap(CLINIC_HOST_TTL_MS + 1);
      expect(later.generatedAt).not.toBe(first.generatedAt);
    });

    it("picks up a domain that verified, once it is dropped", async () => {
      await clinicHostMap(0);
      await rawDb.clinicDomain.update({ where: { host: hostOf("pending") }, data: { status: "VERIFIED", verifiedAt: new Date() } });

      // Still the old answer inside the window — which is what the TTL buys.
      expect((await clinicHostMap(1)).hosts).not.toHaveProperty(hostOf("pending"));
      // Dropping it is what an attach or a verify does.
      forgetClinicHosts();
      expect((await clinicHostMap(2)).hosts[hostOf("pending")]).toBe(slugOf("pending"));

      await rawDb.clinicDomain.update({ where: { host: hostOf("pending") }, data: { status: "PENDING", verifiedAt: null } });
      forgetClinicHosts();
    });
  });
});
