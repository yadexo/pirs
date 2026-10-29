import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
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

const { inviteAdminAction } = await import("@/lib/actions/platform-admins");
const { consumePasswordToken } = await import("@/lib/password-tokens");

/**
 * Inviting another platform admin: no password ever typed or emailed, a
 * one-time 24-hour link, and the full set of server-side refusals (role,
 * impersonation, 2FA, rate limit) that a hidden button alone can't provide.
 */
describe("inviteAdminAction", () => {
  const createdUserIds: string[] = [];

  // The limiter's bucket lives in Postgres and outlives a single test run; the
  // mocked headers() always resolves to the same "unknown" IP, so every test
  // here would otherwise share one global bucket across repeated runs.
  beforeAll(async () => {
    await rawDb.rateLimitBucket.deleteMany({ where: { key: { startsWith: "admin-invite:" } } });
  });

  afterEach(async () => {
    impersonatingMerchantId = null;
    for (const id of createdUserIds.splice(0)) await rawDb.user.delete({ where: { id } }).catch(() => undefined);
  });

  async function makeAdmin(options: { twoFactorConfirmed?: boolean } = {}) {
    const id = (await rawDb.user.create({ data: { email: `admin-${Date.now()}-${Math.random()}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
    createdUserIds.push(id);
    if (options.twoFactorConfirmed) {
      await rawDb.twoFactorSecret.create({ data: { userId: id, secret: "AAAAAAAAAAAAAAAA", confirmedAt: new Date() } });
    }
    return id;
  }

  function asUser(id: string) {
    authMock.auth.mockResolvedValue({ user: { id, email: "x@example.com", name: "x", authTime: Date.now() } });
  }

  function fd(fields: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  }

  it("refuses an actor who is not a platform admin", async () => {
    const tenantAdminId = (await rawDb.user.create({ data: { email: `tadmin-${Date.now()}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    createdUserIds.push(tenantAdminId);
    asUser(tenantAdminId);
    const res = await inviteAdminAction(fd({ firstName: "A", lastName: "B", email: `new-${Date.now()}@x.com` }));
    expect("error" in res && res.error).toBeTruthy();
  });

  it("refuses while impersonating a merchant", async () => {
    const adminId = await makeAdmin({ twoFactorConfirmed: true });
    asUser(adminId);
    impersonatingMerchantId = "some-merchant-id";
    const res = await inviteAdminAction(fd({ firstName: "A", lastName: "B", email: `new-${Date.now()}@x.com` }));
    expect("error" in res && res.error).toMatch(/impersonating/i);
  });

  it("refuses an admin who hasn't confirmed two-factor yet", async () => {
    const adminId = await makeAdmin({ twoFactorConfirmed: false });
    asUser(adminId);
    const res = await inviteAdminAction(fd({ firstName: "A", lastName: "B", email: `new-${Date.now()}@x.com` }));
    expect("error" in res && res.error).toMatch(/two-factor/i);
  });

  it("trips the rate limit after enough invites in a window", async () => {
    const adminId = await makeAdmin({ twoFactorConfirmed: true });
    asUser(adminId);
    const stamp = Date.now();
    let lastRes: Awaited<ReturnType<typeof inviteAdminAction>> | null = null;
    for (let i = 0; i < 6; i++) {
      lastRes = await inviteAdminAction(fd({ firstName: "A", lastName: "B", email: `flood-${stamp}-${i}@x.com` }));
    }
    expect(lastRes && "error" in lastRes && lastRes.error).toMatch(/too many/i);
    // Clean up whatever invites did land before the limit tripped.
    await rawDb.user.deleteMany({ where: { email: { contains: `flood-${stamp}-` } } });
  });

  it("creates an INVITED admin with a 24-hour one-time link, never a password, and audits the invite", async () => {
    const adminId = await makeAdmin({ twoFactorConfirmed: true });
    asUser(adminId);
    const email = `new-${Date.now()}@x.com`;
    const before = Date.now();
    const result = await inviteAdminAction(fd({ firstName: "Nina", lastName: "New", email }));
    expect(result).not.toHaveProperty("tempPassword");
    expect("ok" in result && result.ok).toBe(true);
    const typed = result as { ok: true; email: string; loginUrl: string; emailed: boolean };
    expect(typed.loginUrl).toMatch(/\/set-password\?token=/);

    const created = await rawDb.user.findFirst({ where: { email } });
    expect(created).toBeTruthy();
    createdUserIds.push(created!.id);
    expect(created!.status).toBe("INVITED");
    expect(created!.passwordHash).toBe("!invited");
    expect(created!.role).toBe("PLATFORM_ADMIN");
    expect(created!.tenantId).toBeNull();
    expect(created!.firstName).toBe("Nina");
    expect(created!.lastName).toBe("New");

    const token = await rawDb.passwordResetToken.findFirst({ where: { userId: created!.id }, orderBy: { createdAt: "desc" } });
    expect(token).toBeTruthy();
    expect(token!.usedAt).toBeNull();
    const ttlMs = token!.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThan(25 * 60 * 60 * 1000);

    const audit = await rawDb.auditLog.findFirst({ where: { action: "admin.invited", entityId: created!.id } });
    expect(audit).toBeTruthy();
    expect(audit!.tenantId).toBeNull();
    expect(audit!.actorUserId).toBe(adminId);
  });

  it("refuses an email that already has an account", async () => {
    const adminId = await makeAdmin({ twoFactorConfirmed: true });
    asUser(adminId);
    const existing = await rawDb.user.create({ data: { email: `existing-${Date.now()}@x.com`, passwordHash: "x", role: "STAFF" } });
    createdUserIds.push(existing.id);
    const res = await inviteAdminAction(fd({ firstName: "A", lastName: "B", email: existing.email }));
    expect("error" in res && res.error).toBeTruthy();
  });
});

describe("the admin invite link itself", () => {
  const createdUserIds: string[] = [];
  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) await rawDb.user.delete({ where: { id } }).catch(() => undefined);
  });

  it("rejects an expired link", async () => {
    const user = await rawDb.user.create({ data: { email: `exp-${Date.now()}@x.com`, passwordHash: "!invited", role: "PLATFORM_ADMIN", status: "INVITED" } });
    createdUserIds.push(user.id);
    const raw = "a-raw-test-token-value-0123456789";
    const { createHash } = await import("node:crypto");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    await rawDb.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() - 1000) } });

    const result = await consumePasswordToken(raw, "a-perfectly-fine-password");
    expect(result.ok).toBe(false);
  });

  it("rejects a link that has already been used", async () => {
    const user = await rawDb.user.create({ data: { email: `used-${Date.now()}@x.com`, passwordHash: "!invited", role: "PLATFORM_ADMIN", status: "INVITED" } });
    createdUserIds.push(user.id);
    const raw = "another-raw-test-token-value-9876543210";
    const { createHash } = await import("node:crypto");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    await rawDb.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) } });

    const first = await consumePasswordToken(raw, "a-perfectly-fine-password");
    expect(first.ok).toBe(true);

    const second = await consumePasswordToken(raw, "a-different-fine-password");
    expect(second.ok).toBe(false);
  });
});
