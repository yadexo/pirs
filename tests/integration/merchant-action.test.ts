import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);

const { requireMerchantAction, runAction, ActionError } = await import("@/lib/merchant-action");

/**
 * The guard trusts the database, not the session token. Each test signs in as
 * a real account; the session's own claims are deliberately generous ("ALL",
 * PLATFORM_ADMIN) where that matters, to prove they are ignored.
 */
describe("requireMerchantAction", () => {
  const stamp = Date.now();
  let mine: string;
  let other: string;
  let suspended: string;
  const ids: Record<string, string> = {};

  /** A session for a real user, optionally lying about role and permissions. */
  const as = (who: string, claims: Record<string, unknown> = {}) =>
    authMock.auth.mockResolvedValue({
      user: { id: ids[who], email: "x@example.com", name: "x", role: "STAFF", tenantId: mine, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: [], ...claims },
    });

  async function staff(key: string, tenantId: string, permissionKeys: string[] | null, active = true) {
    const user = await rawDb.user.create({ data: { tenantId, email: `${key}-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } });
    let roleId: string | undefined;
    if (permissionKeys) {
      const role = await rawDb.role.create({ data: { tenantId, name: `${key}-role` } });
      roleId = role.id;
      for (const k of permissionKeys) {
        const permission = await rawDb.permission.findUniqueOrThrow({ where: { key: k } });
        await rawDb.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
    }
    await rawDb.staffProfile.create({ data: { tenantId, userId: user.id, firstName: key, lastName: "T", roleId, active } });
    ids[key] = user.id;
  }

  beforeAll(async () => {
    mine = (await rawDb.tenant.create({ data: { slug: `ma-mine-${stamp}`, name: "Mine" } })).id;
    other = (await rawDb.tenant.create({ data: { slug: `ma-other-${stamp}`, name: "Other" } })).id;
    suspended = (await rawDb.tenant.create({ data: { slug: `ma-susp-${stamp}`, name: "Suspended", status: "SUSPENDED" } })).id;

    ids.agency = (await rawDb.user.create({ data: { email: `agency-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
    ids.owner = (await rawDb.user.create({ data: { tenantId: mine, email: `owner-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    ids.suspendedOwner = (await rawDb.user.create({ data: { tenantId: suspended, email: `sowner-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    ids.client = (await rawDb.user.create({ data: { tenantId: mine, email: `client-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } })).id;
    ids.disabledUser = (await rawDb.user.create({ data: { tenantId: mine, email: `disabled-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN", status: "DISABLED" } })).id;
    ids.noProfile = (await rawDb.user.create({ data: { tenantId: mine, email: `noprofile-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } })).id;
    await staff("catalogStaff", mine, ["catalog.manage"]);
    await staff("noRoleStaff", mine, null);
    await staff("deactivatedStaff", mine, ["catalog.manage"], false);
  });

  afterAll(async () => {
    for (const id of [mine, other, suspended]) await deleteTenantCompletely(id);
    await rawDb.user.deleteMany({ where: { id: ids.agency } });
  });

  const allowed = (id: string, need: Parameters<typeof requireMerchantAction>[1]) =>
    requireMerchantAction(id, need).then(
      () => true,
      (e) => (e instanceof ActionError ? false : Promise.reject(e)),
    );

  it("lets an agency admin act on any clinic, including a suspended one", async () => {
    as("agency", { role: "PLATFORM_ADMIN", tenantId: null });
    expect(await allowed(mine, "owner")).toBe(true);
    expect(await allowed(other, "catalog.manage")).toBe(true);
    expect(await allowed(suspended, "owner")).toBe(true);
  });

  it("confines a clinic owner to their own clinic", async () => {
    as("owner", { role: "TENANT_ADMIN" });
    expect(await allowed(mine, "owner")).toBe(true);
    expect(await allowed(other, "catalog.manage")).toBe(false);
  });

  it("gives staff exactly what their role grants in the database", async () => {
    as("catalogStaff");
    expect(await allowed(mine, "catalog.manage")).toBe(true);
    expect(await allowed(mine, "loyalty.adjust")).toBe(false);
    expect(await allowed(mine, "owner")).toBe(false);
    expect(await allowed(other, "catalog.manage")).toBe(false);
  });

  it("ignores a session that claims more than the account has", async () => {
    // A 30-day token minted when this person had full access, or a forged claim.
    as("noRoleStaff", { permissions: "ALL" });
    expect(await allowed(mine, "catalog.manage")).toBe(false);
    as("catalogStaff", { role: "PLATFORM_ADMIN", tenantId: null });
    expect(await allowed(other, "catalog.manage")).toBe(false);
  });

  it("stops a deactivated staff member immediately, token or not", async () => {
    as("deactivatedStaff", { permissions: "ALL" });
    expect(await allowed(mine, "catalog.manage")).toBe(false);
    expect(await allowed(mine, "member")).toBe(false);
  });

  it("stops a suspended account and a staff login with no profile", async () => {
    as("disabledUser", { role: "TENANT_ADMIN" });
    expect(await allowed(mine, "owner")).toBe(false);
    // Used to fall through to "ALL".
    as("noProfile", { permissions: "ALL" });
    expect(await allowed(mine, "catalog.manage")).toBe(false);
  });

  it("applies a permission removed mid-session on the very next request", async () => {
    as("catalogStaff");
    expect(await allowed(mine, "catalog.manage")).toBe(true);
    const profile = await rawDb.staffProfile.findUniqueOrThrow({ where: { userId: ids.catalogStaff } });
    await rawDb.rolePermission.deleteMany({ where: { roleId: profile.roleId! } });
    expect(await allowed(mine, "catalog.manage")).toBe(false);
  });

  it("'member' admits any active staff of the clinic, and nobody from elsewhere", async () => {
    as("noRoleStaff");
    expect(await allowed(mine, "member")).toBe(true);
    expect(await allowed(other, "member")).toBe(false);
    as("client", { role: "CUSTOMER" });
    expect(await allowed(mine, "member")).toBe(false);
  });

  it("blocks a suspended clinic's own users", async () => {
    as("suspendedOwner", { role: "TENANT_ADMIN", tenantId: suspended });
    expect(await allowed(suspended, "catalog.manage")).toBe(false);
  });

  it("refuses signed-out visitors", async () => {
    authMock.auth.mockResolvedValue(null);
    expect(await allowed(mine, "member")).toBe(false);
  });

  it("answers another clinic and a non-existent clinic identically", async () => {
    as("owner", { role: "TENANT_ADMIN" });
    const msg = (id: string) => requireMerchantAction(id, "catalog.manage").catch((e: Error) => e.message);
    expect(await msg(other)).toBe(await msg("does-not-exist"));
  });

  it("scopes the returned database client to the named clinic", async () => {
    as("agency", { role: "PLATFORM_ADMIN", tenantId: null });
    const { db } = await requireMerchantAction(other, "owner");
    await rawDb.serviceCategory.create({ data: { tenantId: mine, name: "belongs to mine" } });
    expect(await db.serviceCategory.findMany({ where: {} })).toEqual([]);
  });

  it("records agency edits as agency edits in the audit log", async () => {
    as("agency", { role: "PLATFORM_ADMIN", tenantId: null });
    const ctx = await requireMerchantAction(other, "owner");
    await ctx.audit("test.touch", "Tenant", other);
    const row = await rawDb.auditLog.findFirst({ where: { tenantId: other, action: "test.touch" } });
    expect(row?.actorType).toBe("PLATFORM_ADMIN");
  });
});

describe("runAction", () => {
  it("turns expected failures into messages and hides unexpected ones", async () => {
    expect(await runAction(async () => ({ id: "1" }))).toEqual({ ok: true, id: "1" });
    expect(
      await runAction(async () => {
        throw new ActionError("Nope");
      }),
    ).toEqual({ error: "Nope" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await runAction(async () => {
        throw new Error("db password is hunter2");
      }),
    ).toEqual({ error: "Something went wrong. Please try again." });
    spy.mockRestore();
  });
});
