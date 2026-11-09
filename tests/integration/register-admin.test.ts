/**
 * The admin register page's action. The registration code stands in for an
 * inviter, and what it creates is the same account an invite from the console
 * creates — same code (lib/platform-admin-create.ts), so an admin made either
 * way is the same admin.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import en from "@/messages/en.json";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.91" }) }));
vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  const get = (path: string) => path.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);
  return {
    getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) => {
      const value = get(`${namespace}.${key}`);
      if (typeof value !== "string") throw new Error(`missing message ${namespace}.${key}`);
      return value.replace(/\{(\w+)[^}]*\}/g, (_, name) => String(values?.[name] ?? `{${name}}`));
    },
  };
});
const sentEmails: { to: string; body?: string }[] = [];
vi.mock("@/lib/providers/notifications", () => ({
  getEmailProvider: () => ({
    send: async (message: { to: string; body?: string }) => {
      sentEmails.push(message);
      return { status: "SENT" };
    },
  }),
}));

const { registerPlatformAdminAction } = await import("@/lib/actions/register");

const CODE = "081946";
const stamp = Date.now();
const email = `ra-new-${stamp}@example.com`;

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const register = (over: Record<string, string> = {}) =>
  registerPlatformAdminAction(undefined, form({ name: "Nina New", email, code: CODE, ...over }));
const clearLimits = () => rawDb.rateLimitBucket.deleteMany({ where: { key: { startsWith: "register-code:" } } });
const ok = (result: Awaited<ReturnType<typeof registerPlatformAdminAction>>) => {
  if (!("ok" in result)) throw new Error(`expected success, got ${JSON.stringify(result)}`);
  return result;
};

describe("registerPlatformAdminAction", () => {
  beforeEach(async () => {
    process.env.REGISTRATION_CODE = CODE;
    sentEmails.length = 0;
    await clearLimits();
  });

  afterEach(async () => {
    delete process.env.REGISTRATION_CODE;
    await rawDb.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await clearLimits();
  });

  it("creates a full platform admin with no clinic of its own", async () => {
    const result = ok(await register());
    const admin = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
    expect(admin).toMatchObject({ role: "PLATFORM_ADMIN", tenantId: null, status: "INVITED", firstName: "Nina", lastName: "New" });
  });

  it("takes no password, returns none, and leaves the account unusable until the link is used", async () => {
    const result = ok(await register());
    const admin = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
    expect(Object.keys(result).sort()).toEqual(["email", "emailed", "loginUrl", "ok", "readyToSignIn"]);
    expect(result.readyToSignIn).toBe(false);
    expect(admin.passwordHash).toBe("!invited");
    const token = await rawDb.passwordResetToken.findFirstOrThrow({ where: { userId: admin.id, usedAt: null } });
    // A platform admin is higher-privilege than a clinic invite, so 24 hours.
    const ttl = token.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("has no two-factor secret yet — requireAgencyContext makes them set one up", async () => {
    const result = ok(await register());
    const admin = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
    expect(await rawDb.twoFactorSecret.findUnique({ where: { userId: admin.id } })).toBeNull();
  });

  it("emails the link to the address given, and nothing else", async () => {
    const result = ok(await register());
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe(result.email);
    expect(sentEmails[0]!.body).toContain("/set-password?token=");
  });

  it("logs it against the platform, since nobody is signed in", async () => {
    const result = ok(await register());
    const admin = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
    const audit = await rawDb.auditLog.findFirstOrThrow({ where: { action: "admin.self_registered", entityId: admin.id } });
    expect(audit).toMatchObject({ actorType: "SYSTEM", actorUserId: null, tenantId: null });
    expect(audit.metadata).toMatchObject({ scope: "ALL" });
  });

  describe("what it refuses", () => {
    it("a wrong code, creating nothing", async () => {
      expect(await register({ code: "081945" })).toEqual({ error: en.register.errors.invalidCode });
      expect(await rawDb.user.count({ where: { email } })).toBe(0);
    });

    it("anything at all when registration is closed", async () => {
      delete process.env.REGISTRATION_CODE;
      expect(await register()).toEqual({ error: en.register.errors.closed });
      expect(await rawDb.user.count({ where: { email } })).toBe(0);
    });

    it("an address that is already a platform admin", async () => {
      ok(await register());
      await clearLimits();
      const again = await register();
      expect(again).toMatchObject({ error: en.register.errors.adminEmailTaken, fieldErrors: { email: en.register.errors.adminEmailTaken } });
      expect(await rawDb.user.count({ where: { email, role: "PLATFORM_ADMIN" } })).toBe(1);
    });

    it("a name or email that makes no sense, naming the fields", async () => {
      const result = await register({ name: "x", email: "nope" });
      expect(result).toMatchObject({ error: en.register.errors.checkTheForm });
      expect(Object.keys((result as { fieldErrors: Record<string, string> }).fieldErrors).sort()).toEqual(["email", "name"]);
    });
  });

  it("allows an address that owns a clinic or is a client — each door signs in its own account", async () => {
    const tenantId = (await rawDb.tenant.create({ data: { slug: `ra-${stamp}`, name: "Admin Register Clinic" } })).id;
    try {
      await rawDb.user.create({ data: { tenantId, email, passwordHash: "x", role: "TENANT_ADMIN" } });
      const result = ok(await register());
      expect(result.email).toBe(email);
      expect(await rawDb.user.count({ where: { email } })).toBe(2);
    } finally {
      await rawDb.user.deleteMany({ where: { email } });
      await deleteTenantCompletely(tenantId);
    }
  });
});
