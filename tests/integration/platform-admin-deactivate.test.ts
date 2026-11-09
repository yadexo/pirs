import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { rawDb } from "@/lib/db";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn() }));

let impersonatingMerchantId: string | null = null;
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "impersonate_merchant" && impersonatingMerchantId ? { value: impersonatingMerchantId } : undefined),
  })),
}));

const { setAdminActiveAction } = await import("@/lib/actions/platform-admins");

/**
 * Deactivating/reactivating another platform admin: never yourself, never
 * the last active one, signs them out everywhere, and every write is audited.
 */
describe("setAdminActiveAction", () => {
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // "At least one active platform admin must remain" is counted across the
    // whole database, so any admin this file did not create makes the rules
    // below vacuous — and silently. That is not hypothetical: the test this
    // file used to have skipped itself whenever it found extra active admins,
    // which is why a real hole in the guard went unnoticed. app_test holds
    // only what tests create and files run one at a time
    // (vitest.config.ts, fileParallelism: false), so anything still here is
    // debris from a run that crashed.
    await rawDb.user.deleteMany({ where: { role: "PLATFORM_ADMIN" } });
  });

  afterEach(async () => {
    impersonatingMerchantId = null;
    for (const id of createdUserIds.splice(0)) await rawDb.user.delete({ where: { id } }).catch(() => undefined);
  });

  async function makeAdmin(options: { twoFactorConfirmed?: boolean; status?: "ACTIVE" | "DISABLED" } = {}) {
    const id = (
      await rawDb.user.create({
        data: { email: `admin-${Date.now()}-${Math.random()}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN", status: options.status ?? "ACTIVE" },
      })
    ).id;
    createdUserIds.push(id);
    if (options.twoFactorConfirmed) {
      await rawDb.twoFactorSecret.create({ data: { userId: id, secret: "AAAAAAAAAAAAAAAA", confirmedAt: new Date() } });
    }
    return id;
  }

  function asUser(id: string) {
    authMock.auth.mockResolvedValue({ user: { id, email: "x@example.com", name: "x", authTime: Date.now() } });
  }

  it("refuses an actor who is not a platform admin", async () => {
    const tenantAdminId = (await rawDb.user.create({ data: { email: `tadmin-${Date.now()}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    createdUserIds.push(tenantAdminId);
    asUser(tenantAdminId);
    const target = await makeAdmin({ twoFactorConfirmed: true });
    const res = await setAdminActiveAction(target, false);
    expect("error" in res && res.error).toBeTruthy();
  });

  it("refuses while impersonating a merchant", async () => {
    const actor = await makeAdmin({ twoFactorConfirmed: true });
    const target = await makeAdmin({ twoFactorConfirmed: true });
    asUser(actor);
    impersonatingMerchantId = "some-merchant-id";
    const res = await setAdminActiveAction(target, false);
    expect("error" in res && res.error).toMatch(/impersonating/i);
  });

  it("refuses an admin who hasn't confirmed two-factor yet", async () => {
    const actor = await makeAdmin({ twoFactorConfirmed: false });
    const target = await makeAdmin({ twoFactorConfirmed: true });
    asUser(actor);
    const res = await setAdminActiveAction(target, false);
    expect("error" in res && res.error).toMatch(/two-factor/i);
  });

  it("refuses to deactivate your own account", async () => {
    const actor = await makeAdmin({ twoFactorConfirmed: true });
    await makeAdmin({ twoFactorConfirmed: true }); // keep a second active admin around so this isn't also the last-admin case
    asUser(actor);
    const res = await setAdminActiveAction(actor, false);
    expect("error" in res && res.error).toMatch(/own account/i);
    expect((await rawDb.user.findUnique({ where: { id: actor } }))!.status).toBe("ACTIVE");
  });

  it("cannot be talked into leaving no admin at all, one call at a time", async () => {
    // Reaching the last-admin check by hand is impossible, and that is the
    // point rather than an oversight: an actor has to be an active admin to
    // act at all, so deactivating somebody else always leaves at least the
    // actor — and deactivating yourself is refused before the count is even
    // looked at. Both doors shut, in that order.
    const actor = await makeAdmin({ twoFactorConfirmed: true });
    const other = await makeAdmin({ twoFactorConfirmed: true });
    asUser(actor);

    expect("ok" in (await setAdminActiveAction(other, false))).toBe(true);
    expect(await rawDb.user.count({ where: { role: "PLATFORM_ADMIN", status: "ACTIVE" } })).toBeGreaterThanOrEqual(1);

    const self = await setAdminActiveAction(actor, false);
    expect("error" in self && self.error).toMatch(/own account/i);
    expect((await rawDb.user.findUnique({ where: { id: actor } }))!.status).toBe("ACTIVE");
  });

  it("holds when two admins deactivate each other at the same moment", async () => {
    // The one case the count check is really for. Both read "one will be
    // left" and both would be right on their own; Serializable makes one of
    // them lose, whether that surfaces as the refusal or as a write conflict.
    const a = await makeAdmin({ twoFactorConfirmed: true });
    const b = await makeAdmin({ twoFactorConfirmed: true });
    const actors = [a, b];
    authMock.auth.mockImplementation(async () => ({ user: { id: actors.shift() ?? a, email: "x@example.com", name: "x", authTime: Date.now() } }));

    const results = await Promise.all([setAdminActiveAction(b, false), setAdminActiveAction(a, false)]);
    const disabled = await rawDb.user.count({ where: { id: { in: [a, b] }, status: "DISABLED" } });

    expect(results.filter((r) => "ok" in r).length).toBeLessThanOrEqual(1);
    // Whatever the two calls were told, the invariant is the row count.
    expect(disabled).toBeLessThanOrEqual(1);
  });

  it("deactivates another admin, signs them out, and audits it", async () => {
    const actor = await makeAdmin({ twoFactorConfirmed: true });
    const target = await makeAdmin({ twoFactorConfirmed: true });
    asUser(actor);

    const before = Date.now();
    const res = await setAdminActiveAction(target, false);
    expect("ok" in res).toBe(true);

    const row = await rawDb.user.findUnique({ where: { id: target } });
    expect(row!.status).toBe("DISABLED");
    expect(row!.sessionsValidAfter).toBeTruthy();
    expect(row!.sessionsValidAfter!.getTime()).toBeGreaterThanOrEqual(before);

    const audit = await rawDb.auditLog.findFirst({ where: { action: "admin.deactivated", entityId: target } });
    expect(audit).toBeTruthy();
    expect(audit!.tenantId).toBeNull();
    expect(audit!.actorUserId).toBe(actor);
  });

  it("reactivates a disabled admin without the last-admin check, and audits it", async () => {
    const actor = await makeAdmin({ twoFactorConfirmed: true });
    const target = await makeAdmin({ twoFactorConfirmed: true, status: "DISABLED" });
    asUser(actor);

    const res = await setAdminActiveAction(target, true);
    expect("ok" in res).toBe(true);

    const row = await rawDb.user.findUnique({ where: { id: target } });
    expect(row!.status).toBe("ACTIVE");

    const audit = await rawDb.auditLog.findFirst({ where: { action: "admin.reactivated", entityId: target } });
    expect(audit).toBeTruthy();
    expect(audit!.actorUserId).toBe(actor);
  });
});
