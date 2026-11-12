/**
 * Attaching, checking and removing a clinic's own domain.
 *
 * Vercel is faked throughout — the point here is who may do this, what is
 * refused before Vercel is ever called, and what ends up in the database and
 * the audit log.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { ENROLLED } from "../helpers/enrolled";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn() }));
let impersonating: string | null = null;
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: (name: string) => (name === "impersonate_merchant" && impersonating ? { value: impersonating } : undefined) })),
}));

/** The fake Vercel. Each test says what it should do. */
const vercel = vi.hoisted(() => ({
  add: vi.fn(async (host: string) => ({ name: host, verified: false, verification: [] as unknown[] })),
  get: vi.fn(async (host: string) => ({ name: host, verified: false, verification: [] as unknown[] })),
  verify: vi.fn(async (host: string) => ({ name: host, verified: true, verification: [] as unknown[] })),
  remove: vi.fn(async () => undefined),
}));
vi.mock("@/lib/vercel-domains", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, vercelConfig: () => ({ token: "t", projectId: "p" }), vercelDomainsApi: () => vercel };
});

const { attachClinicDomainAction, checkClinicDomainAction, removeClinicDomainAction } = await import("@/lib/actions/clinic-domains");

const stamp = Date.now();
const HOST = `app.clinic-${stamp}.example`;

describe("a clinic's own domain", () => {
  let clinicId: string;
  let otherClinicId: string;
  let adminId: string;
  let ownerId: string;

  const asAdmin = (id = adminId) => authMock.auth.mockResolvedValue({ user: { id, email: "a@x.com", name: "a", authTime: Date.now() } });
  const form = (host: string) => {
    const fd = new FormData();
    fd.set("host", host);
    return fd;
  };
  const errorOf = (result: unknown) => (result as { error?: string }).error;

  beforeAll(async () => {
    clinicId = (await rawDb.tenant.create({ data: { slug: `cd-${stamp}`, name: "Domain Clinic" } })).id;
    otherClinicId = (await rawDb.tenant.create({ data: { slug: `cd-other-${stamp}`, name: "Other Domain Clinic" } })).id;
    adminId = (await rawDb.user.create({ data: { email: `cd-admin-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
    await rawDb.twoFactorSecret.create({ data: { userId: adminId, secret: "AAAAAAAAAAAAAAAA", confirmedAt: new Date() } });
    ownerId = (await rawDb.user.create({ data: { tenantId: clinicId, email: `cd-owner-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN", twoFactor: ENROLLED } })).id;
  });

  afterAll(async () => {
    await rawDb.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    for (const id of [clinicId, otherClinicId]) await deleteTenantCompletely(id).catch(() => undefined);
    await rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: "domain-attach:" } }, { key: { startsWith: "domain-check:" } }] } });
  });

  beforeEach(async () => {
    impersonating = null;
    asAdmin();
    vercel.add.mockClear();
    vercel.verify.mockClear();
    vercel.remove.mockClear();
    vercel.add.mockImplementation(async (host: string) => ({ name: host, verified: false, verification: [] }));
    vercel.verify.mockImplementation(async (host: string) => ({ name: host, verified: true, verification: [] }));
    vercel.remove.mockImplementation(async () => undefined);
    await rawDb.clinicDomain.deleteMany({});
    await rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: "domain-attach:" } }, { key: { startsWith: "domain-check:" } }] } });
  });

  afterEach(() => vi.restoreAllMocks());

  describe("who may do it", () => {
    it("refuses somebody who is not a platform admin, without calling Vercel", async () => {
      asAdmin(ownerId);
      expect(errorOf(await attachClinicDomainAction(clinicId, form(HOST)))).toBe("Not permitted.");
      expect(vercel.add).not.toHaveBeenCalled();
    });

    it("refuses an admin who has not set up two-factor", async () => {
      const bare = await rawDb.user.create({ data: { email: `cd-bare-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } });
      asAdmin(bare.id);
      expect(errorOf(await attachClinicDomainAction(clinicId, form(HOST)))).toMatch(/two-factor/i);
      expect(vercel.add).not.toHaveBeenCalled();
    });

    it("refuses while impersonating a clinic", async () => {
      impersonating = clinicId;
      expect(errorOf(await attachClinicDomainAction(clinicId, form(HOST)))).toMatch(/impersonating/i);
      expect(vercel.add).not.toHaveBeenCalled();
    });

    it("refuses a signed-out visitor", async () => {
      authMock.auth.mockResolvedValue(null);
      expect(errorOf(await attachClinicDomainAction(clinicId, form(HOST)))).toBe("Not permitted.");
    });

    it("guards removing and checking the same way", async () => {
      expect(await attachClinicDomainAction(clinicId, form(HOST))).toMatchObject({ ok: true });
      asAdmin(ownerId);
      expect(errorOf(await checkClinicDomainAction(clinicId))).toBe("Not permitted.");
      expect(errorOf(await removeClinicDomainAction(clinicId))).toBe("Not permitted.");
      expect(vercel.remove).not.toHaveBeenCalled();
    });
  });

  describe("what it refuses before Vercel is involved", () => {
    const refused = async (host: string) => {
      const result = await attachClinicDomainAction(clinicId, form(host));
      expect(vercel.add, `${host} reached Vercel`).not.toHaveBeenCalled();
      return errorOf(result);
    };

    it("an apex", async () => {
      expect(await refused("clinicname.nl")).toMatch(/subdomain/i);
    });

    it("our own domain", async () => {
      expect(await refused("app.deza.ai")).toMatch(/ours/i);
    });

    it("a local-only name and an address", async () => {
      expect(await refused("app.example.test")).toMatch(/local/i);
      vercel.add.mockClear();
      expect(await refused("203.0.113.9")).toMatch(/IP address/i);
    });

    it("a domain another clinic already has", async () => {
      expect(await attachClinicDomainAction(otherClinicId, form(HOST))).toMatchObject({ ok: true });
      vercel.add.mockClear();
      expect(await refused(HOST)).toMatch(/another clinic/i);
    });

    it("a second domain for a clinic that already has one", async () => {
      expect(await attachClinicDomainAction(clinicId, form(HOST))).toMatchObject({ ok: true });
      vercel.add.mockClear();
      expect(await refused(`other.clinic-${stamp}.example`)).toMatch(/already uses/i);
    });
  });

  describe("attaching", () => {
    it("adds it to Vercel, stores it pending, and records who did it", async () => {
      const result = await attachClinicDomainAction(clinicId, form(` HTTPS://${HOST.toUpperCase()}/ `));
      expect(result).toMatchObject({ ok: true });

      // Normalised on the way in, so the host map has one shape to match.
      expect(vercel.add).toHaveBeenCalledWith(HOST);
      const row = await rawDb.clinicDomain.findUniqueOrThrow({ where: { host: HOST } });
      expect(row).toMatchObject({ tenantId: clinicId, type: "CLIENT", status: "PENDING", createdByUserId: adminId });
      expect(row.lastCheckedAt).not.toBeNull();
      expect(row.verifiedAt).toBeNull();

      const audit = await rawDb.auditLog.findFirstOrThrow({ where: { action: "clinic.domain_attached", entityId: row.id } });
      expect(audit).toMatchObject({ tenantId: clinicId, actorUserId: adminId, actorType: "PLATFORM_ADMIN" });
      expect(audit.metadata).toMatchObject({ host: HOST, status: "PENDING" });
    });

    it("hands back the records the clinic has to add", async () => {
      vercel.add.mockImplementation(async (host: string) => ({
        name: host,
        verified: false,
        verification: [{ type: "TXT", domain: `_vercel.clinic-${stamp}.example`, value: "vc-domain-verify=abc", reason: "pending" }],
      }));
      const result = (await attachClinicDomainAction(clinicId, form(HOST))) as { ok: true; domain: { records: { type: string; name: string }[] } };
      expect(result.domain.records.map((r) => r.type)).toEqual(["CNAME", "TXT"]);
      expect(result.domain.records[0]).toMatchObject({ name: "app" });
    });

    it("writes nothing when Vercel refuses", async () => {
      vercel.add.mockImplementation(async () => {
        throw new (await import("@/lib/vercel-domains")).VercelApiError("taken", "domain_already_in_use", 409);
      });
      expect(errorOf(await attachClinicDomainAction(clinicId, form(HOST)))).toMatch(/another Vercel project/);
      expect(await rawDb.clinicDomain.count({ where: { host: HOST } })).toBe(0);
    });

    it("stops an admin who attaches in a loop", async () => {
      let last: unknown;
      for (let i = 0; i < 12; i++) {
        await rawDb.clinicDomain.deleteMany({});
        last = await attachClinicDomainAction(clinicId, form(`a${i}.clinic-${stamp}.example`));
        if (errorOf(last)) break;
      }
      expect(errorOf(last)).toMatch(/a lot of domains/i);
    }, 60000);
  });

  describe("checking", () => {
    beforeEach(async () => {
      await attachClinicDomainAction(clinicId, form(HOST));
    });

    it("marks it verified, stamps when, and audits that once", async () => {
      expect(await checkClinicDomainAction(clinicId)).toMatchObject({ ok: true });
      const row = await rawDb.clinicDomain.findUniqueOrThrow({ where: { host: HOST } });
      expect(row.status).toBe("VERIFIED");
      expect(row.verifiedAt).not.toBeNull();
      expect(await rawDb.auditLog.count({ where: { action: "clinic.domain_verified", entityId: row.id } })).toBe(1);

      // Checking again changes nothing and does not log a second verification.
      await checkClinicDomainAction(clinicId);
      expect(await rawDb.auditLog.count({ where: { action: "clinic.domain_verified", entityId: row.id } })).toBe(1);
    });

    it("keeps the row and says why when the check fails", async () => {
      vercel.verify.mockImplementation(async () => {
        throw new TypeError("fetch failed");
      });
      expect(await checkClinicDomainAction(clinicId)).toMatchObject({ ok: true });
      const row = await rawDb.clinicDomain.findUniqueOrThrow({ where: { host: HOST } });
      expect(row).toMatchObject({ status: "FAILED" });
      expect(row.lastError).toMatch(/Could not reach Vercel/);
      expect(row.lastCheckedAt).not.toBeNull();
    });

    it("takes a domain back out of service when it stops verifying", async () => {
      await checkClinicDomainAction(clinicId);
      vercel.verify.mockImplementation(async (host: string) => ({ name: host, verified: false, verification: [] }));
      await checkClinicDomainAction(clinicId);
      const row = await rawDb.clinicDomain.findUniqueOrThrow({ where: { host: HOST } });
      expect(row).toMatchObject({ status: "PENDING", verifiedAt: null });
    });

    it("says so when there is nothing to check", async () => {
      expect(errorOf(await checkClinicDomainAction(otherClinicId))).toMatch(/no domain/i);
    });
  });

  describe("removing", () => {
    beforeEach(async () => {
      await attachClinicDomainAction(clinicId, form(HOST));
    });

    it("takes it off Vercel first, then deletes the row, and audits it", async () => {
      const row = await rawDb.clinicDomain.findUniqueOrThrow({ where: { host: HOST } });
      expect(await removeClinicDomainAction(clinicId)).toMatchObject({ ok: true });
      expect(vercel.remove).toHaveBeenCalledWith(HOST);
      expect(await rawDb.clinicDomain.count({ where: { host: HOST } })).toBe(0);
      const audit = await rawDb.auditLog.findFirstOrThrow({ where: { action: "clinic.domain_removed", entityId: row.id } });
      expect(audit.metadata).toMatchObject({ host: HOST });
    });

    it("keeps the row when Vercel will not let go", async () => {
      // Otherwise the domain stays on the project with nothing pointing at
      // it, and attaching it again fails against an owner nobody can see.
      vercel.remove.mockImplementation(async () => {
        throw new TypeError("fetch failed");
      });
      expect(errorOf(await removeClinicDomainAction(clinicId))).toMatch(/Could not reach Vercel/);
      expect(await rawDb.clinicDomain.count({ where: { host: HOST } })).toBe(1);
    });

    it("goes with the clinic when the clinic is deleted", async () => {
      const temp = await rawDb.tenant.create({ data: { slug: `cd-temp-${stamp}`, name: "Temp" } });
      await rawDb.clinicDomain.create({ data: { tenantId: temp.id, host: `temp.clinic-${stamp}.example` } });
      await deleteTenantCompletely(temp.id);
      expect(await rawDb.clinicDomain.count({ where: { host: `temp.clinic-${stamp}.example` } })).toBe(0);
    });
  });
});
