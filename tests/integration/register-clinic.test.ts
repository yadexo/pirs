/**
 * The clinic register page's action: the code is checked first, then a clinic
 * and its owner come into being exactly as they do when a platform admin adds
 * one — same code, so the two cannot drift apart.
 *
 * No password is ever accepted or returned, and the owner stays unable to sign
 * in until they have used the one-time link.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import en from "@/messages/en.json";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.90" }) }));
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

const { registerClinicAction } = await import("@/lib/actions/register");

const CODE = "081946";
const stamp = Date.now();
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const valid = (over: Record<string, string> = {}) => ({
  name: `Register Clinic ${stamp}`,
  ownerName: "Pat Owner",
  email: `rc-owner-${stamp}@example.com`,
  locale: "nl",
  currency: "EUR",
  code: CODE,
  ...over,
});
const register = (over: Record<string, string> = {}) => registerClinicAction(undefined, form(valid(over)));
const clearLimits = () => rawDb.rateLimitBucket.deleteMany({ where: { key: { startsWith: "register-code:" } } });

describe("registerClinicAction", () => {
  beforeEach(async () => {
    process.env.REGISTRATION_CODE = CODE;
    authMock.auth.mockResolvedValue(null);
    sentEmails.length = 0;
    await clearLimits();
  });

  afterEach(async () => {
    delete process.env.REGISTRATION_CODE;
    for (const id of createdTenantIds.splice(0)) await deleteTenantCompletely(id).catch(() => undefined);
    for (const id of createdUserIds.splice(0)) await rawDb.user.delete({ where: { id } }).catch(() => undefined);
    await clearLimits();
    vi.restoreAllMocks();
  });

  const ok = (result: Awaited<ReturnType<typeof registerClinicAction>>) => {
    if (!("ok" in result)) throw new Error(`expected success, got ${JSON.stringify(result)}`);
    return result;
  };

  it("creates the clinic, its owner and the things App Builder needs", async () => {
    const result = ok(await register({ name: `Riverside ${stamp}` }));
    const tenant = await rawDb.tenant.findFirstOrThrow({
      where: { branding: { contactEmail: result.email } },
      include: { branding: true, settings: true, locations: true, loyaltyProgramme: true, users: { include: { staffProfile: true } } },
    });
    createdTenantIds.push(tenant.id);

    expect(tenant).toMatchObject({ status: "ACTIVE", subscriptionStatus: "TRIAL", name: `Riverside ${stamp}` });
    expect(tenant.slug).toBe(`riverside-${stamp}`);
    expect(tenant.branding).toMatchObject({ businessName: `Riverside ${stamp}`, currency: "EUR" });
    expect(tenant.settings).toMatchObject({ publiclyListed: true, defaultClientLocale: "nl" });
    expect(tenant.locations).toHaveLength(1);
    expect(tenant.locations[0]!.isPrimary).toBe(true);
    expect(tenant.loyaltyProgramme).not.toBeNull();

    const owner = tenant.users[0]!;
    expect(owner).toMatchObject({ role: "TENANT_ADMIN", status: "INVITED", locale: "nl" });
    expect(owner.staffProfile).toMatchObject({ firstName: "Pat", lastName: "Owner", active: true });
  });

  it("never takes a password, never returns one, and leaves the owner unable to sign in yet", async () => {
    const result = ok(await register({ email: `rc-nopass-${stamp}@example.com` }));
    const owner = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
    createdTenantIds.push(owner.tenantId!);

    // The only "password" anywhere in the answer is the path of the link the
    // owner uses to choose one; no field carries a password or a hash.
    expect(Object.keys(result).sort()).toEqual(["email", "emailed", "loginUrl", "ok", "readyToSignIn"]);
    expect(result.readyToSignIn).toBe(false);
    expect(result.loginUrl).toMatch(/^https?:\/\/[^\s]+\/set-password\?token=[\w-]+$/);
    // Not a hash anything can match, so no password works until the link is used.
    expect(owner.passwordHash).toBe("!invited");
    const token = await rawDb.passwordResetToken.findFirst({ where: { userId: owner.id, usedAt: null } });
    expect(token).toBeTruthy();
    expect(token!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("emails the owner the link, and nothing else", async () => {
    const result = ok(await register({ email: `rc-mail-${stamp}@example.com` }));
    const owner = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
    createdTenantIds.push(owner.tenantId!);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe(result.email);
    expect(sentEmails[0]!.body).toContain("/set-password?token=");
    expect(result.emailed).toBe(true);
  });

  it("applies the language it was given to the owner, the clients' default and the email", async () => {
    const result = ok(await register({ email: `rc-en-${stamp}@example.com`, locale: "en" }));
    const owner = await rawDb.user.findFirstOrThrow({ where: { email: result.email }, include: { tenant: { include: { settings: true } } } });
    createdTenantIds.push(owner.tenantId!);
    expect(owner.locale).toBe("en");
    expect(owner.tenant!.settings!.defaultClientLocale).toBe("en");
  });

  it("records no creator for a self-registration, and logs it against the platform", async () => {
    const result = ok(await register({ email: `rc-self-${stamp}@example.com` }));
    const tenant = await rawDb.tenant.findFirstOrThrow({ where: { branding: { contactEmail: result.email } } });
    createdTenantIds.push(tenant.id);

    expect(tenant.createdByUserId).toBeNull();
    const audit = await rawDb.auditLog.findFirstOrThrow({ where: { action: "clinic.self_registered", entityId: tenant.id } });
    expect(audit).toMatchObject({ actorType: "SYSTEM", actorUserId: null, tenantId: tenant.id });
    expect(audit.metadata).toMatchObject({ byPlatformAdmin: false, slug: tenant.slug });
  });

  it("records the platform admin as the creator when a signed-in one registers it", async () => {
    const admin = await rawDb.user.create({ data: { email: `rc-admin-${stamp}@example.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } });
    createdUserIds.push(admin.id);
    authMock.auth.mockResolvedValue({ user: { id: admin.id, email: admin.email, role: "PLATFORM_ADMIN", permissions: "ALL", authTime: Date.now() } });

    const result = ok(await register({ email: `rc-byadmin-${stamp}@example.com` }));
    const tenant = await rawDb.tenant.findFirstOrThrow({ where: { branding: { contactEmail: result.email } } });
    createdTenantIds.push(tenant.id);

    expect(tenant.createdByUserId).toBe(admin.id);
    const audit = await rawDb.auditLog.findFirstOrThrow({ where: { action: "clinic.self_registered", entityId: tenant.id } });
    expect(audit).toMatchObject({ actorType: "PLATFORM_ADMIN", actorUserId: admin.id });
  });

  it("ignores a signed-in account that is not a platform admin", async () => {
    // A clinic owner registering a second clinic is not that clinic's creator
    // in the sense this column means, and must not be recorded as one.
    const owner = await rawDb.user.create({ data: { email: `rc-other-${stamp}@example.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    createdUserIds.push(owner.id);
    authMock.auth.mockResolvedValue({ user: { id: owner.id, email: owner.email, role: "TENANT_ADMIN", permissions: "ALL", authTime: Date.now() } });

    const result = ok(await register({ email: `rc-byowner-${stamp}@example.com` }));
    const tenant = await rawDb.tenant.findFirstOrThrow({ where: { branding: { contactEmail: result.email } } });
    createdTenantIds.push(tenant.id);
    expect(tenant.createdByUserId).toBeNull();
  });

  it("gives a clinic whose name collides with one of the app's own routes a usable address", async () => {
    // "app" is a reserved first segment: a clinic there would be unreachable
    // on the client host, where the first segment *is* the clinic.
    const result = ok(await register({ name: "App", email: `rc-app-${stamp}@example.com` }));
    const tenant = await rawDb.tenant.findFirstOrThrow({ where: { branding: { contactEmail: result.email } } });
    createdTenantIds.push(tenant.id);
    expect(tenant.slug).not.toBe("app");
    expect(tenant.slug).toMatch(/^app-[0-9a-f]{6}$/);
  });

  describe("what it refuses", () => {
    const noClinicCreated = async (email: string) => {
      expect(await rawDb.user.count({ where: { email } })).toBe(0);
      expect(await rawDb.tenant.count({ where: { branding: { contactEmail: email } } })).toBe(0);
    };

    it("a wrong code, creating nothing", async () => {
      const email = `rc-wrong-${stamp}@example.com`;
      const result = await register({ email, code: "081945" });
      expect(result).toEqual({ error: en.register.errors.invalidCode });
      await noClinicCreated(email);
    });

    it("any submission at all when registration is closed", async () => {
      delete process.env.REGISTRATION_CODE;
      const email = `rc-closed-${stamp}@example.com`;
      expect(await register({ email })).toEqual({ error: en.register.errors.closed });
      await noClinicCreated(email);
    });

    it("an address that already owns or works at a clinic", async () => {
      const first = ok(await register({ email: `rc-dup-${stamp}@example.com`, name: `First ${stamp}` }));
      const tenant = await rawDb.tenant.findFirstOrThrow({ where: { branding: { contactEmail: first.email } } });
      createdTenantIds.push(tenant.id);

      await clearLimits();
      const again = await register({ email: first.email, name: `Second ${stamp}` });
      expect(again).toMatchObject({ error: en.register.errors.clinicEmailTaken, fieldErrors: { email: en.register.errors.clinicEmailTaken } });
      expect(await rawDb.tenant.count({ where: { name: `Second ${stamp}` } })).toBe(0);
    });

    it("but allows an address that is a platform admin or a client somewhere", async () => {
      // One person, several kinds of account: that is the point of scoping
      // sign-in by door (lib/portal-scope.ts).
      const email = `rc-shared-${stamp}@example.com`;
      const admin = await rawDb.user.create({ data: { email, passwordHash: "x", role: "PLATFORM_ADMIN" } });
      createdUserIds.push(admin.id);

      const result = ok(await register({ email, name: `Shared ${stamp}` }));
      const tenant = await rawDb.tenant.findFirstOrThrow({ where: { branding: { contactEmail: result.email } } });
      createdTenantIds.push(tenant.id);
      expect(await rawDb.user.count({ where: { email } })).toBe(2);
    });

    it("a form that is missing things, naming the fields, without touching the database", async () => {
      const result = await register({ name: "x", ownerName: "", email: "not-an-email" });
      expect(result).toMatchObject({ error: en.register.errors.checkTheForm });
      const fieldErrors = (result as { fieldErrors: Record<string, string> }).fieldErrors;
      expect(Object.keys(fieldErrors).sort()).toEqual(["email", "name", "ownerName"]);
      expect(await rawDb.tenant.count({ where: { name: "x" } })).toBe(0);
    });

    it("a language or currency it does not support", async () => {
      expect(await register({ locale: "de", email: `rc-de-${stamp}@example.com` })).toMatchObject({ error: en.register.errors.checkTheForm });
      await clearLimits();
      expect(await register({ currency: "CHF", email: `rc-chf-${stamp}@example.com` })).toMatchObject({ error: en.register.errors.checkTheForm });
    });
  });
});
