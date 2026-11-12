/**
 * What sign-in and sign-up give away about who has an account.
 *
 * Sign-in always said the same thing for a wrong password and an unknown
 * address — and took a third of a second for one and a few hundredths for the
 * other, which says it anyway. Sign-up simply said "an account with this
 * email already exists" (docs/security/review-2026-11.md, A-3 and A-4).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("server-only", () => ({}));

/** Counts the two kinds of password work, and otherwise leaves them real. */
const work = vi.hoisted(() => ({ verify: 0, spend: 0 }));
vi.mock("@/lib/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/password")>();
  return {
    ...actual,
    verifyPassword: async (plain: string, hash: string) => {
      work.verify += 1;
      return actual.verifyPassword(plain, hash);
    },
    spendPasswordCheck: async (plain: string) => {
      work.spend += 1;
      return actual.spendPasswordCheck(plain);
    },
  };
});

const emails = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; body: string; html: string }[] }));
vi.mock("@/lib/providers/notifications", () => ({
  getEmailProvider: () => ({
    send: async (message: { to: string; subject: string; body: string; html: string }) => {
      emails.sent.push(message);
      return { status: "SENT" };
    },
  }),
}));

const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn() }));
vi.mock("@/client-auth", () => clientAuthMock);
// lib/actions/auth.ts needs only the error class from here, not the framework.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", host: "login.deza.ai" }),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const { authorizeCredentials } = await import("@/lib/auth-credentials");
const { hashPassword, spendPasswordCheck } = await vi.importActual<typeof import("@/lib/password")>("@/lib/password");
const { customerRegisterAction } = await import("@/lib/actions/auth");

const PASSWORD = "enumeration-Password-1!";

describe("what sign-in and sign-up give away", () => {
  const stamp = Date.now();
  const slug = `enum-${stamp}`;
  const addr = (name: string) => `enum-${name}-${stamp}@example.com`;
  let clinic: string;
  let suspended: string;
  let n = 0;
  /** A fresh source address each time, so no limit ever shapes a result. */
  const ip = () => `198.51.${100 + (n++ % 100)}.${(stamp % 200) + 1}`;

  beforeAll(async () => {
    clinic = (await rawDb.tenant.create({ data: { slug, name: "Enumeration Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Enumeration Clinic" } });
    suspended = (await rawDb.tenant.create({ data: { slug: `${slug}-susp`, name: "Suspended", status: "SUSPENDED" } })).id;
    const passwordHash = await hashPassword(PASSWORD);
    const user = (name: string, data: Record<string, unknown>) => rawDb.user.create({ data: { email: addr(name), passwordHash, ...data } as never });

    await user("admin", { role: "PLATFORM_ADMIN" });
    await user("owner", { tenantId: clinic, role: "TENANT_ADMIN" });
    await user("disabled", { tenantId: clinic, role: "TENANT_ADMIN", status: "DISABLED" });
    await user("staff-no-profile", { tenantId: clinic, role: "STAFF" });
    await user("susp-owner", { tenantId: suspended, role: "TENANT_ADMIN" });
    const client = await user("client", { tenantId: clinic, role: "CUSTOMER" });
    await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: client.id, firstName: "Cleo", lastName: "Client" } });
  });

  afterAll(async () => {
    await rawDb.user.deleteMany({ where: { email: addr("admin") } });
    for (const id of [clinic, suspended]) await deleteTenantCompletely(id).catch(() => undefined);
    await rawDb.rateLimitBucket.deleteMany({ where: { key: { contains: `${stamp}` } } });
  });

  beforeEach(() => {
    work.verify = 0;
    work.spend = 0;
    emails.sent.length = 0;
  });

  describe("sign-in does one password check's worth of work, whatever the reason for refusing", () => {
    const attempt = (credentials: Record<string, unknown>, audience: "staff" | "client" = "staff") => authorizeCredentials({ password: "not-the-password-1", ...credentials }, audience, ip());

    const refusals: [string, Record<string, unknown>, ("staff" | "client")?][] = [
      ["an address nobody has", { portal: "staff", email: addr("nobody") }],
      ["an address nobody has, at the admin door", { portal: "admin", email: addr("nobody") }],
      ["a clinic owner's address at the admin door", { portal: "admin", email: addr("owner") }],
      ["a switched-off account", { portal: "staff", email: addr("disabled") }],
      ["staff with no profile", { portal: "staff", email: addr("staff-no-profile") }],
      ["an owner of a suspended clinic", { portal: "staff", email: addr("susp-owner") }],
      ["a client door with no such client", { portal: "customer", tenantSlug: slug, email: addr("nobody") }, "client"],
      ["a client door at a clinic that does not exist", { portal: "customer", tenantSlug: "no-such-clinic", email: addr("client") }, "client"],
      ["a client door at a suspended clinic", { portal: "customer", tenantSlug: `${slug}-susp`, email: addr("client") }, "client"],
    ];

    for (const [name, credentials, audience] of refusals) {
      it(name, async () => {
        expect(await attempt(credentials, audience)).toBeNull();
        // Exactly one, of one kind or the other — never none.
        expect(work.verify + work.spend, "password checks performed").toBe(1);
        expect(work.spend).toBe(1);
      });
    }

    it("a real account with the wrong password: the real check, and only that", async () => {
      expect(await attempt({ portal: "staff", email: addr("owner") })).toBeNull();
      expect(work).toEqual({ verify: 1, spend: 0 });
      expect(await attempt({ portal: "customer", tenantSlug: slug, email: addr("client") }, "client")).toBeNull();
      expect(work).toEqual({ verify: 2, spend: 0 });
    });

    it("a right password still signs in, and does no extra work", async () => {
      const user = await authorizeCredentials({ portal: "customer", tenantSlug: slug, email: addr("client"), password: PASSWORD }, "client", ip());
      expect(user).toMatchObject({ role: "CUSTOMER", email: addr("client") });
      expect(work).toEqual({ verify: 1, spend: 0 });
    });

    it("the stand-in check costs what a real one costs, and matches nothing", async () => {
      const time = async (run: () => Promise<unknown>) => {
        const started = performance.now();
        await run();
        return performance.now() - started;
      };
      await spendPasswordCheck("warm-up"); // the first call also makes the hash
      const real = await time(() => attempt({ portal: "staff", email: addr("owner") }));
      const standIn = await time(() => attempt({ portal: "staff", email: addr("nobody") }));
      // Generous on purpose: this is a check for "the same order of
      // magnitude", not a benchmark. Before the fix the ratio was about 15.
      expect(standIn).toBeGreaterThan(real / 3);
      expect(standIn).toBeLessThan(real * 3);
    });
  });

  describe("sign-up with an address that already has an account", () => {
    const form = (email: string) => {
      const fd = new FormData();
      fd.set("firstName", "Someone");
      fd.set("lastName", "Else");
      fd.set("email", email);
      fd.set("password", "a-new-password-123");
      return fd;
    };
    const clearLimits = () => rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: "register:" } }, { key: { startsWith: "register-exists:" } }] } });

    beforeEach(clearLimits);

    it("does not say the address is taken", async () => {
      const result = await customerRegisterAction(slug, undefined, form(addr("client")));
      expect(result).toHaveProperty("error");
      const said = (result as { error: string }).error.toLowerCase();
      expect(said).not.toContain("already exists");
      expect(said).not.toContain("taken");
      // It reads sensibly to the person it is true for.
      expect(said).toContain("sign in or reset your password");
    });

    it("tells the real owner instead, by email, with the way back in and no token", async () => {
      await customerRegisterAction(slug, undefined, form(addr("client").toUpperCase()));
      expect(emails.sent).toHaveLength(1);
      const [mail] = emails.sent;
      expect(mail!.to).toBe(addr("client"));
      expect(mail!.body).toContain("Enumeration Clinic");
      expect(mail!.body).toContain(`/forgot-password?clinic=${slug}`);
      // A link to the reset *page*, not a reset link: nothing in this email
      // can be used to take the account.
      expect(mail!.body).not.toContain("token=");
      expect(await rawDb.passwordResetToken.count({ where: { user: { email: addr("client") } } })).toBe(0);
    });

    it("sends that email at most once a day, however often the form is sent", async () => {
      for (let i = 0; i < 4; i++) await customerRegisterAction(slug, undefined, form(addr("client")));
      expect(emails.sent).toHaveLength(1);
    });

    it("does the same password work a real sign-up does, and changes nothing", async () => {
      const before = await rawDb.user.findFirstOrThrow({ where: { email: addr("client"), tenantId: clinic } });
      await customerRegisterAction(slug, undefined, form(addr("client")));
      expect(work.spend).toBe(1);
      const after = await rawDb.user.findFirstOrThrow({ where: { email: addr("client"), tenantId: clinic } });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(await rawDb.user.count({ where: { email: addr("client"), tenantId: clinic } })).toBe(1);
    });
  });
});
