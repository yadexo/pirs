import { describe, it, expect, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { generateTotpSecret, totpCode, generateBackupCodes, hashBackupCode } from "@/lib/totp";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

vi.mock("server-only", () => ({}));
const { authorizeCredentials, TwoFactorRequiredSignIn } = await import("@/lib/auth-credentials");

/**
 * The one place a confirmed 2FA secret actually has teeth: authorizeCredentials
 * itself, called from Auth.js on every sign-in. Correct password alone is
 * never enough for an account that has this confirmed — not "returns null"
 * (indistinguishable from a wrong password, the general case), but a
 * specific thrown signal the login form reads to show the code field.
 */
describe("sign-in with two-factor authentication", () => {
  const stamp = Date.now();
  let tenant: { id: string };
  const password = "correct-horse-battery-1";

  async function makeUser(email: string) {
    const u = await rawDb.user.create({ data: { tenantId: tenant.id, email, passwordHash: await hashPassword(password), role: "TENANT_ADMIN" } });
    await rawDb.staffProfile.create({ data: { tenantId: tenant.id, userId: u.id, firstName: "Owner", lastName: "T", active: true } });
    return u;
  }

  async function setUp() {
    tenant = await rawDb.tenant.create({ data: { slug: `2fa-${stamp}-${Math.random().toString(36).slice(2)}`, name: "2FA Test", status: "ACTIVE" } });
  }

  afterAll(async () => {
    if (tenant) await deleteTenantCompletely(tenant.id).catch(() => undefined);
  });

  it("an account with no 2FA signs in on password alone, same as always", async () => {
    await setUp();
    const email = `plain-${stamp}@x.com`;
    await makeUser(email);
    const result = await authorizeCredentials({ portal: "unified", email, password }, "staff", "203.0.113.1");
    expect(result?.email).toBe(email);
  });

  it("an unconfirmed (mid-setup) secret does not gate login — abandoning setup can't lock anyone out", async () => {
    const email = `midsetup-${stamp}@x.com`;
    const u = await makeUser(email);
    await rawDb.twoFactorSecret.create({ data: { userId: u.id, secret: generateTotpSecret() } }); // no confirmedAt
    const result = await authorizeCredentials({ portal: "unified", email, password }, "staff", "203.0.113.2");
    expect(result?.email).toBe(email);
  });

  it("asks for a code when the account has one confirmed, and gives no other signal", async () => {
    const email = `confirmed-${stamp}@x.com`;
    const u = await makeUser(email);
    const secret = generateTotpSecret();
    await rawDb.twoFactorSecret.create({ data: { userId: u.id, secret, confirmedAt: new Date() } });

    await expect(authorizeCredentials({ portal: "unified", email, password }, "staff", "203.0.113.3")).rejects.toBeInstanceOf(TwoFactorRequiredSignIn);
  });

  it("refuses a wrong code with its own message, and signs in with the right one", async () => {
    const email = `code-${stamp}@x.com`;
    const u = await makeUser(email);
    const secret = generateTotpSecret();
    await rawDb.twoFactorSecret.create({ data: { userId: u.id, secret, confirmedAt: new Date() } });

    // authorizeCredentials throws a sentinel here, not the English text —
    // translation happens one level up (lib/actions/auth.ts's signInOrError).
    await expect(authorizeCredentials({ portal: "unified", email, password, totpCode: "000000" }, "staff", "203.0.113.4")).rejects.toThrow(
      /__2fa_invalid_code__/,
    );

    const result = await authorizeCredentials({ portal: "unified", email, password, totpCode: totpCode(secret) }, "staff", "203.0.113.4");
    expect(result?.email).toBe(email);
  });

  it("a backup code signs in once, and is refused the second time", async () => {
    const email = `backup-${stamp}@x.com`;
    const u = await makeUser(email);
    const secret = generateTotpSecret();
    await rawDb.twoFactorSecret.create({ data: { userId: u.id, secret, confirmedAt: new Date() } });
    const [code] = generateBackupCodes(1);
    await rawDb.twoFactorBackupCode.create({ data: { userId: u.id, codeHash: hashBackupCode(code!) } });

    const result = await authorizeCredentials({ portal: "unified", email, password, totpCode: code }, "staff", "203.0.113.5");
    expect(result?.email).toBe(email);

    await expect(authorizeCredentials({ portal: "unified", email, password, totpCode: code }, "staff", "203.0.113.5")).rejects.toThrow(
      /__2fa_invalid_code__/,
    );
  });

  it("the last backup code goes to exactly one of two people asking at once", async () => {
    const email = `race-${stamp}@x.com`;
    const u = await makeUser(email);
    const secret = generateTotpSecret();
    await rawDb.twoFactorSecret.create({ data: { userId: u.id, secret, confirmedAt: new Date() } });
    const [code] = generateBackupCodes(1);
    await rawDb.twoFactorBackupCode.create({ data: { userId: u.id, codeHash: hashBackupCode(code!) } });

    const attempts = await Promise.allSettled([
      authorizeCredentials({ portal: "unified", email, password, totpCode: code }, "staff", "203.0.113.6"),
      authorizeCredentials({ portal: "unified", email, password, totpCode: code }, "staff", "203.0.113.7"),
    ]);
    const wins = attempts.filter((a) => a.status === "fulfilled");
    expect(wins).toHaveLength(1);

    const row = await rawDb.twoFactorBackupCode.findFirst({ where: { userId: u.id } });
    expect(row?.usedAt).not.toBeNull();
  });
});
