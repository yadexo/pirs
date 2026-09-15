import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);

const { requireMerchantAction, runAction, ActionError } = await import("@/lib/merchant-action");

type Role = "PLATFORM_ADMIN" | "TENANT_ADMIN" | "STAFF" | "CUSTOMER";
let userId = "unset";
const as = (role: Role, tenantId: string | null, permissions: string[] | "ALL" = "ALL") =>
  authMock.auth.mockResolvedValue({
    user: { id: userId, email: "x@example.com", name: "x", role, tenantId, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions },
  });

describe("requireMerchantAction", () => {
  let mine: string;
  let other: string;
  let suspended: string;

  beforeAll(async () => {
    const stamp = Date.now();
    mine = (await rawDb.tenant.create({ data: { slug: `ma-mine-${stamp}`, name: "Mine" } })).id;
    other = (await rawDb.tenant.create({ data: { slug: `ma-other-${stamp}`, name: "Other" } })).id;
    // A real user row: the audit log references it by foreign key.
    userId = (await rawDb.user.create({ data: { email: `ma-${stamp}@example.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
    suspended = (await rawDb.tenant.create({ data: { slug: `ma-susp-${stamp}`, name: "Suspended", status: "SUSPENDED" } })).id;
  });

  afterAll(async () => {
    await rawDb.tenant.deleteMany({ where: { id: { in: [mine, other, suspended] } } });
    await rawDb.user.delete({ where: { id: userId } });
  });

  const allowed = (id: string, need: Parameters<typeof requireMerchantAction>[1]) =>
    requireMerchantAction(id, need).then(() => true, (e) => (e instanceof ActionError ? false : Promise.reject(e)));

  it("lets an agency admin act on any clinic — the gap impersonation used to hit", async () => {
    as("PLATFORM_ADMIN", null);
    expect(await allowed(mine, "owner")).toBe(true);
    expect(await allowed(other, "catalog.manage")).toBe(true);
    // Suspended clinics stay reachable by the agency, which is how they get un-suspended.
    expect(await allowed(suspended, "owner")).toBe(true);
  });

  it("confines a clinic owner to their own clinic", async () => {
    as("TENANT_ADMIN", mine);
    expect(await allowed(mine, "owner")).toBe(true);
    expect(await allowed(mine, "catalog.manage")).toBe(true);
    expect(await allowed(other, "catalog.manage")).toBe(false);
  });

  it("gives staff only what their role grants, and never owner-only actions", async () => {
    as("STAFF", mine, ["catalog.manage"]);
    expect(await allowed(mine, "catalog.manage")).toBe(true);
    expect(await allowed(mine, "loyalty.adjust")).toBe(false);
    expect(await allowed(mine, "owner")).toBe(false);
    expect(await allowed(other, "catalog.manage")).toBe(false);
  });

  it("'member' admits any staff of the clinic, but still nobody from elsewhere", async () => {
    as("STAFF", mine, []);
    expect(await allowed(mine, "member")).toBe(true);
    expect(await allowed(other, "member")).toBe(false);
    as("CUSTOMER", mine);
    expect(await allowed(mine, "member")).toBe(false);
  });

    it("blocks a suspended clinic's own users", async () => {
    as("TENANT_ADMIN", suspended);
    expect(await allowed(suspended, "catalog.manage")).toBe(false);
  });

  it("refuses clients and signed-out visitors", async () => {
    as("CUSTOMER", mine);
    expect(await allowed(mine, "catalog.manage")).toBe(false);
    authMock.auth.mockResolvedValue(null);
    expect(await allowed(mine, "catalog.manage")).toBe(false);
  });

  it("answers another clinic and a non-existent clinic identically", async () => {
    as("TENANT_ADMIN", mine);
    const msg = (id: string) => requireMerchantAction(id, "catalog.manage").catch((e: Error) => e.message);
    expect(await msg(other)).toBe(await msg("does-not-exist"));
  });

  it("scopes the returned database client to the named clinic", async () => {
    as("PLATFORM_ADMIN", null);
    const { db } = await requireMerchantAction(other, "owner");
    await rawDb.serviceCategory.create({ data: { tenantId: mine, name: "belongs to mine" } });
    expect(await db.serviceCategory.findMany({ where: {} })).toEqual([]);
  });

  it("records agency edits as agency edits in the audit log", async () => {
    as("PLATFORM_ADMIN", null);
    const ctx = await requireMerchantAction(other, "owner");
    await ctx.audit("test.touch", "Tenant", other);
    const row = await rawDb.auditLog.findFirst({ where: { tenantId: other, action: "test.touch" } });
    expect(row?.actorType).toBe("PLATFORM_ADMIN");
  });
});

describe("runAction", () => {
  it("turns expected failures into messages and hides unexpected ones", async () => {
    expect(await runAction(async () => ({ id: "1" }))).toEqual({ ok: true, id: "1" });
    expect(await runAction(async () => { throw new ActionError("Nope"); })).toEqual({ error: "Nope" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runAction(async () => { throw new Error("db password is hunter2"); })).toEqual({ error: "Something went wrong. Please try again." });
    spy.mockRestore();
  });
});
