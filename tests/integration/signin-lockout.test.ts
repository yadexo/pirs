/**
 * Who a failed sign-in is counted against.
 *
 * It used to be the account, whoever was failing: ten requests every ten
 * minutes from a stranger kept an owner locked out indefinitely, and the
 * owner's own successful sign-ins counted towards it
 * (docs/security/review-2026-11.md, A-5). Failures now count against the
 * address they came from, with a much higher cap on the account as a whole.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { generateTotpSecret, totpCode } from "@/lib/totp";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import {
  describeLoginKey,
  LOGIN_ACCOUNT_WINDOW_MS,
  LOGIN_ATTEMPTS_PER_IP,
  LOGIN_FAILURES_PER_ACCOUNT,
  LOGIN_FAILURES_PER_ACCOUNT_AND_SOURCE,
  LOGIN_WINDOW_MS,
  loginAccountKey,
  loginCounterLocked,
  loginIpKey,
  loginSourceKey,
} from "@/lib/login-limits";

vi.mock("server-only", () => ({}));
const { authorizeCredentials } = await import("@/lib/auth-credentials");

const PASSWORD = "lockout-Password-123!";
const WRONG = "not-the-password-at-all-1";

describe("the counter keys", () => {
  it("say what they count, and by which limit", () => {
    expect(describeLoginKey(loginIpKey("203.0.113.7"))).toMatchObject({ kind: "ip", subject: "203.0.113.7", limit: LOGIN_ATTEMPTS_PER_IP, windowMs: LOGIN_WINDOW_MS });
    expect(describeLoginKey(loginAccountKey("admin", "a@example.com"))).toMatchObject({
      kind: "account",
      portal: "admin",
      subject: "a@example.com",
      limit: LOGIN_FAILURES_PER_ACCOUNT,
      windowMs: LOGIN_ACCOUNT_WINDOW_MS,
    });
    expect(describeLoginKey(loginSourceKey("staff", "a@example.com", "203.0.113.7"))).toMatchObject({
      kind: "account-from-address",
      portal: "staff",
      subject: "a@example.com",
      from: "203.0.113.7",
      limit: LOGIN_FAILURES_PER_ACCOUNT_AND_SOURCE,
    });
  });

  it("survive an IPv6 address, which is made of the separator", () => {
    const key = loginSourceKey("customer", "c@example.com", "2001:db8::1");
    expect(describeLoginKey(key)).toMatchObject({ kind: "account-from-address", portal: "customer", subject: "c@example.com", from: "2001:db8::1" });
  });

  it("both account keys end with the address, which is how a lockout is cleared for one person", () => {
    // prisma/reset-platform-admin-password.ts deletes keys that start "login:"
    // and end ":<email>".
    for (const key of [loginAccountKey("admin", "a@example.com"), loginSourceKey("admin", "a@example.com", "203.0.113.7")]) {
      expect(key.startsWith("login:")).toBe(true);
      expect(key.endsWith(":a@example.com")).toBe(true);
    }
  });

  it("ignore anything that is not a sign-in counter", () => {
    expect(describeLoginKey("register-code:ip:203.0.113.7")).toBeNull();
    expect(describeLoginKey("login:")).toBeNull();
    expect(describeLoginKey("login:src:only-an-address")).toBeNull();
  });

  it("a failure counter locks on reaching its limit; the address counter on passing it", () => {
    expect(loginCounterLocked({ kind: "account", limit: 100 }, 99)).toBe(false);
    expect(loginCounterLocked({ kind: "account", limit: 100 }, 100)).toBe(true);
    expect(loginCounterLocked({ kind: "account-from-address", limit: 10 }, 10)).toBe(true);
    expect(loginCounterLocked({ kind: "ip", limit: 30 }, 30)).toBe(false);
    expect(loginCounterLocked({ kind: "ip", limit: 30 }, 31)).toBe(true);
  });
});

describe("failed sign-ins and who they lock out", () => {
  const stamp = Date.now();
  const owner = `lock-owner-${stamp}@example.com`;
  const withCode = `lock-2fa-${stamp}@example.com`;
  const nobody = `lock-nobody-${stamp}@example.com`;
  const secret = generateTotpSecret();
  let clinic: string;

  const STRANGER = "198.51.100.200";
  const HOME = "203.0.113.50";
  const ELSEWHERE = "203.0.113.51";

  const attempt = (email: string, password: string, ip: string, extra: Record<string, unknown> = {}) =>
    authorizeCredentials({ portal: "staff", email, password, ...extra }, "staff", ip).then(
      (user) => ({ user, limited: false }),
      (error: Error) => ({ user: null, limited: /^__rate_limited__/.test(error.message), error }),
    );
  const count = async (key: string) => (await rawDb.rateLimitBucket.findUnique({ where: { key } }))?.count ?? 0;
  const clearCounters = () => rawDb.rateLimitBucket.deleteMany({ where: { OR: [{ key: { contains: `${stamp}` } }, { key: { in: [STRANGER, HOME, ELSEWHERE].map(loginIpKey) } }] } });

  beforeAll(async () => {
    clinic = (await rawDb.tenant.create({ data: { slug: `lock-${stamp}`, name: "Lockout Clinic" } })).id;
    const passwordHash = await hashPassword(PASSWORD);
    await rawDb.user.create({ data: { tenantId: clinic, email: owner, passwordHash, role: "TENANT_ADMIN" } });
    const second = await rawDb.user.create({ data: { tenantId: clinic, email: withCode, passwordHash, role: "TENANT_ADMIN" } });
    await rawDb.twoFactorSecret.create({ data: { userId: second.id, secret, confirmedAt: new Date() } });
  });

  afterAll(async () => {
    await clearCounters();
    await deleteTenantCompletely(clinic);
  });

  beforeEach(clearCounters);

  it("a stranger failing on someone's account does not lock its owner out", async () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_ACCOUNT_AND_SOURCE; i++) expect((await attempt(owner, WRONG, STRANGER)).user).toBeNull();

    // The stranger's address is now refused, even with the right password...
    const again = await attempt(owner, PASSWORD, STRANGER);
    expect(again.limited).toBe(true);
    // ...and the owner, from their own address, signs in as if nothing happened.
    expect((await attempt(owner, PASSWORD, HOME)).user).toMatchObject({ email: owner });
    expect((await attempt(owner, PASSWORD, ELSEWHERE)).user).toMatchObject({ email: owner });
  }, 60000);

  it("signing in successfully is not counted against anybody", async () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_ACCOUNT_AND_SOURCE + 3; i++) expect((await attempt(owner, PASSWORD, HOME)).user).not.toBeNull();
    expect(await count(loginSourceKey("staff", owner, HOME))).toBe(0);
    expect(await count(loginAccountKey("staff", owner))).toBe(0);
  }, 60000);

  it("each failure is counted twice: against the address, and against the account", async () => {
    await attempt(owner, WRONG, STRANGER);
    await attempt(owner, WRONG, STRANGER);
    await attempt(owner, WRONG, ELSEWHERE);
    expect(await count(loginSourceKey("staff", owner, STRANGER))).toBe(2);
    expect(await count(loginSourceKey("staff", owner, ELSEWHERE))).toBe(1);
    expect(await count(loginAccountKey("staff", owner))).toBe(3);
  });

  it("the account as a whole locks at its own, much higher limit, for everyone", async () => {
    // A hundred failures, each from somewhere new, is what this stands for.
    // Seeded rather than performed: that is a hundred password checks.
    await rawDb.rateLimitBucket.create({ data: { key: loginAccountKey("staff", owner), count: LOGIN_FAILURES_PER_ACCOUNT - 1, resetAt: new Date(Date.now() + LOGIN_ACCOUNT_WINDOW_MS) } });

    // One short of it: still open.
    expect((await attempt(owner, PASSWORD, HOME)).user).toMatchObject({ email: owner });
    // The failure that reaches it...
    expect((await attempt(owner, WRONG, STRANGER)).limited).toBe(false);
    // ...closes it, from anywhere, right password or not.
    expect((await attempt(owner, PASSWORD, HOME)).limited).toBe(true);
    expect((await attempt(owner, PASSWORD, ELSEWHERE)).limited).toBe(true);

    // And it opens again when its hour is up.
    await rawDb.rateLimitBucket.updateMany({ where: { key: loginAccountKey("staff", owner) }, data: { resetAt: new Date(Date.now() - 1000) } });
    expect((await attempt(owner, PASSWORD, HOME)).user).toMatchObject({ email: owner });
  }, 60000);

  it("an address that has no account is limited exactly as one that has", async () => {
    // If only real accounts could be locked, being locked would say so.
    for (let i = 0; i < LOGIN_FAILURES_PER_ACCOUNT_AND_SOURCE; i++) {
      const real = await attempt(owner, WRONG, STRANGER);
      const fake = await attempt(nobody, WRONG, ELSEWHERE);
      expect([real.limited, fake.limited]).toEqual([false, false]);
    }
    expect((await attempt(owner, WRONG, STRANGER)).limited).toBe(true);
    expect((await attempt(nobody, WRONG, ELSEWHERE)).limited).toBe(true);
    expect(await count(loginSourceKey("staff", nobody, ELSEWHERE))).toBe(await count(loginSourceKey("staff", owner, STRANGER)));
  }, 90000);

  it("a wrong second-factor code is a failure like a wrong password", async () => {
    const wrongCode = totpCode(secret) === "000000" ? "111111" : "000000";
    for (let i = 0; i < LOGIN_FAILURES_PER_ACCOUNT_AND_SOURCE; i++) await attempt(withCode, PASSWORD, STRANGER, { totpCode: wrongCode });
    expect(await count(loginSourceKey("staff", withCode, STRANGER))).toBe(LOGIN_FAILURES_PER_ACCOUNT_AND_SOURCE);
    // Right password, right code — but this address has used up its guesses.
    expect((await attempt(withCode, PASSWORD, STRANGER, { totpCode: totpCode(secret) })).limited).toBe(true);
    // Being asked for the code is not a failure: nothing was wrong yet.
    await clearCounters();
    await attempt(withCode, PASSWORD, HOME);
    expect(await count(loginSourceKey("staff", withCode, HOME))).toBe(0);
  }, 90000);
});
