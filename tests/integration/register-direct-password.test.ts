/**
 * REGISTRATION_SET_PASSWORD_DIRECTLY: the temporary mode where someone picks
 * their password on the register form and the account works immediately.
 *
 * What matters here is the two halves of the switch. With it off, a password
 * posted anyway is ignored — a stale page must not be able to activate an
 * account that was meant to be invited. With it on, the account is active, the
 * password is really theirs, and no one-time link is left lying around as a
 * second way in.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import en from "@/messages/en.json";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.95" }) }));
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

const { registerClinicAction, registerPlatformAdminAction } = await import("@/lib/actions/register");
const { REGISTRATION_MIN_PASSWORD_LENGTH } = await import("@/lib/registration-constants");

const CODE = "081946";
const PASSWORD = "a-password-of-real-length";
const stamp = Date.now();
let n = 0;
/** A fresh address per case, so nothing collides with an account an earlier one made. */
const freshEmail = (what: string) => `rdp-${what}-${stamp}-${n++}@example.com`;

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const clinic = (over: Record<string, string> = {}) =>
  registerClinicAction(undefined, form({ name: `Direct ${stamp}-${n}`, ownerName: "Pat Owner", email: freshEmail("clinic"), locale: "nl", currency: "EUR", code: CODE, ...over }));
const admin = (over: Record<string, string> = {}) =>
  registerPlatformAdminAction(undefined, form({ name: "Nina New", email: freshEmail("admin"), code: CODE, ...over }));
const clearLimits = () => rawDb.rateLimitBucket.deleteMany({ where: { key: { startsWith: "register-code:" } } });
const ok = <T,>(result: T) => {
  if (!result || typeof result !== "object" || !("ok" in result)) throw new Error(`expected success, got ${JSON.stringify(result)}`);
  return result as T & { ok: true; email: string; loginUrl: string; readyToSignIn: boolean };
};

describe("choosing a password on the register form", () => {
  beforeEach(async () => {
    process.env.REGISTRATION_CODE = CODE;
    sentEmails.length = 0;
    await clearLimits();
  });

  afterEach(async () => {
    delete process.env.REGISTRATION_CODE;
    delete process.env.REGISTRATION_SET_PASSWORD_DIRECTLY;
    const made = await rawDb.user.findMany({ where: { email: { contains: `-${stamp}-` } }, select: { tenantId: true } });
    for (const tenantId of new Set(made.map((u) => u.tenantId).filter((id): id is string => !!id))) {
      await deleteTenantCompletely(tenantId).catch(() => undefined);
    }
    await rawDb.user.deleteMany({ where: { email: { contains: `-${stamp}-` } } });
    await clearLimits();
  });

  describe("with the flag off, which is the default", () => {
    it("ignores a password posted anyway, and still invites", async () => {
      const result = ok(await clinic({ password: PASSWORD, confirm: PASSWORD }));
      const owner = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });

      expect(result.readyToSignIn).toBe(false);
      expect(owner.status).toBe("INVITED");
      expect(owner.passwordHash).toBe("!invited");
      // And emphatically not the password that was posted.
      expect(await verifyPassword(PASSWORD, owner.passwordHash)).toBe(false);
      expect(result.loginUrl).toContain("/set-password?token=");
    });

    it("ignores it on the admin page too", async () => {
      const result = ok(await admin({ password: PASSWORD, confirm: PASSWORD }));
      const account = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
      expect(account).toMatchObject({ status: "INVITED", passwordHash: "!invited" });
      expect(result.readyToSignIn).toBe(false);
    });

    it("is off for anything other than exactly 1", async () => {
      for (const value of ["", "0", "true", "yes", " 1x"]) {
        process.env.REGISTRATION_SET_PASSWORD_DIRECTLY = value;
        await clearLimits();
        const result = ok(await clinic({ password: PASSWORD, confirm: PASSWORD }));
        expect(result.readyToSignIn, `for ${JSON.stringify(value)}`).toBe(false);
      }
    });
  });

  describe("with the flag on", () => {
    beforeEach(() => {
      process.env.REGISTRATION_SET_PASSWORD_DIRECTLY = "1";
    });

    it("creates a clinic owner who can sign in right away, with the password they chose", async () => {
      const result = ok(await clinic({ password: PASSWORD, confirm: PASSWORD }));
      const owner = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });

      expect(result.readyToSignIn).toBe(true);
      expect(owner.status).toBe("ACTIVE");
      expect(await verifyPassword(PASSWORD, owner.passwordHash)).toBe(true);
    });

    it("creates a platform admin the same way", async () => {
      const result = ok(await admin({ password: PASSWORD, confirm: PASSWORD }));
      const account = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
      expect(account.status).toBe("ACTIVE");
      expect(await verifyPassword(PASSWORD, account.passwordHash)).toBe(true);
    });

    it("issues no one-time link, which would be a second way in", async () => {
      const result = ok(await clinic({ password: PASSWORD, confirm: PASSWORD }));
      const owner = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
      expect(await rawDb.passwordResetToken.count({ where: { userId: owner.id } })).toBe(0);
      expect(result.loginUrl).not.toContain("set-password");
      expect(result.loginUrl).toMatch(/\/login$/);
    });

    it("sends the welcome email pointing at sign-in, and never the password", async () => {
      const result = ok(await clinic({ password: PASSWORD, confirm: PASSWORD }));
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.to).toBe(result.email);
      expect(sentEmails[0]!.body).not.toContain(PASSWORD);
      expect(sentEmails[0]!.body).not.toContain("/set-password");
    });

    it("leaves two-factor still to be set up — the flag does not touch that", async () => {
      const result = ok(await admin({ password: PASSWORD, confirm: PASSWORD }));
      const account = await rawDb.user.findFirstOrThrow({ where: { email: result.email } });
      // requireAgencyContext checks this fresh on every request into /agency.
      expect(await rawDb.twoFactorSecret.findUnique({ where: { userId: account.id } })).toBeNull();
    });

    it("records which way the account was opened", async () => {
      const result = ok(await clinic({ password: PASSWORD, confirm: PASSWORD }));
      const tenant = await rawDb.tenant.findFirstOrThrow({ where: { branding: { contactEmail: result.email } } });
      const audit = await rawDb.auditLog.findFirstOrThrow({ where: { action: "clinic.self_registered", entityId: tenant.id } });
      expect(audit.metadata).toMatchObject({ passwordSetOnForm: true });
    });

    it("still needs the registration code", async () => {
      expect(await clinic({ password: PASSWORD, confirm: PASSWORD, code: "081945" })).toEqual({ error: en.register.errors.invalidCode });
    });

    describe("what it refuses, without creating anything", () => {
      const nothingCreated = async (email: string) => expect(await rawDb.user.count({ where: { email } })).toBe(0);

      it("a password under the minimum", async () => {
        const email = freshEmail("short");
        const short = "x".repeat(REGISTRATION_MIN_PASSWORD_LENGTH - 1);
        const result = await clinic({ email, password: short, confirm: short });
        expect(result).toMatchObject({ error: en.register.errors.checkTheForm, fieldErrors: { password: expect.stringContaining(String(REGISTRATION_MIN_PASSWORD_LENGTH)) } });
        await nothingCreated(email);
      });

      it("two that do not match", async () => {
        const email = freshEmail("mismatch");
        const result = await clinic({ email, password: PASSWORD, confirm: `${PASSWORD}x` });
        expect(result).toMatchObject({ fieldErrors: { confirm: expect.stringMatching(/don't match/i) } });
        await nothingCreated(email);
      });

      it("no password at all", async () => {
        const email = freshEmail("missing");
        expect(await clinic({ email })).toMatchObject({ error: en.register.errors.checkTheForm });
        await nothingCreated(email);
      });
    });

    it("never writes the password into a log line", async () => {
      const lines: string[] = [];
      const record = (...args: unknown[]) => String(args[0]).startsWith("[register]") && lines.push(String(args[0]));
      vi.spyOn(console, "warn").mockImplementation(record);
      vi.spyOn(console, "info").mockImplementation(record);

      await clinic({ password: "short", confirm: "short" });
      await clearLimits();
      ok(await clinic({ password: PASSWORD, confirm: PASSWORD }));

      const all = lines.join("\n");
      expect(all).not.toContain(PASSWORD);
      expect(all).not.toContain("short");
      expect(all).toContain("[register] outcome=invalid_input portal=clinic");
      vi.restoreAllMocks();
    });

    it("keeps the password out of what the browser gets back", async () => {
      const result = ok(await clinic({ password: PASSWORD, confirm: PASSWORD }));
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
      expect(Object.keys(result).sort()).toEqual(["email", "emailed", "loginUrl", "ok", "readyToSignIn"]);
    });
  });
});
