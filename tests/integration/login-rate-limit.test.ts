import { describe, it, expect, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";

vi.mock("server-only", () => ({}));
const { authorizeCredentials } = await import("@/lib/auth-credentials");

/**
 * The limits are real: enough wrong attempts at one account from one address
 * locks that address out of that account, and enough attempts spread across
 * many accounts from one address locks the address out of all of them.
 *
 * What it deliberately no longer does is lock the *account* after ten tries
 * from anywhere — that let any stranger keep an owner out indefinitely. Who a
 * failure counts against, and the higher cap on the account as a whole, are
 * tested in signin-lockout.test.ts.
 */
describe("sign-in rate limiting", () => {
  it("locks an address out of an account after enough wrong attempts, with a 'try again in' message, and the right password does not lift it early", async () => {
    // Real bcrypt compares for every attempt, by design — slow on purpose.
    const email = `ratelimit-${Date.now()}@example.com`;
    const user = await rawDb.user.create({ data: { email, passwordHash: await hashPassword("correct-horse-1"), role: "PLATFORM_ADMIN" } });
    const creds = { portal: "staff", email, password: "wrong" };
    const guesser = "203.0.113.7";

    try {
      let limited: Error | null = null;
      for (let i = 0; i < 11; i++) {
        try {
          await authorizeCredentials(creds, "staff", guesser);
        } catch (err) {
          limited = err as Error;
          break;
        }
      }
      expect(limited).toBeTruthy();
      // authorizeCredentials itself throws a sentinel, not the English text —
      // translating it happens one level up, in signInOrError (lib/actions/auth.ts),
      // which runs in a real server-action context; see lib/auth-credentials.ts's
      // comment on why this one can't call next-intl directly.
      expect(limited!.message).toMatch(/^__rate_limited__:\d+/);

      // The right password doesn't lift the lock early — from the address that earned it.
      await expect(authorizeCredentials({ portal: "staff", email, password: "correct-horse-1" }, "staff", guesser)).rejects.toThrow(/__rate_limited__:/);
      // From anywhere else, the account's owner is not locked out by it.
      await expect(authorizeCredentials({ portal: "staff", email, password: "correct-horse-1" }, "staff", "203.0.113.99")).resolves.toMatchObject({ email });
    } finally {
      await rawDb.user.delete({ where: { id: user.id } });
      await rawDb.rateLimitBucket.deleteMany({ where: { key: { endsWith: `:${email}` } } });
    }
  }, 60000);

  it("locks the IP after enough attempts spread across different accounts", async () => {
    // None of these accounts need to exist — the IP check runs before any
    // lookup, same as it would for a botnet trying addresses at random.
    const stamp = Date.now();
    const ip = "198.51.100.42";

    let limited: Error | null = null;
    for (let i = 0; i < 31; i++) {
      try {
        await authorizeCredentials({ portal: "staff", email: `iplimit-${stamp}-${i}@example.com`, password: "wrong" }, "staff", ip);
      } catch (err) {
        limited = err as Error;
        break;
      }
    }
    expect(limited).toBeTruthy();
    expect(limited!.message).toMatch(/^__rate_limited__:\d+/);
  });

  it("never throws for a null credentials object (Auth.js's own CredentialsSignin handles that)", async () => {
    await expect(authorizeCredentials(undefined, "staff", "203.0.113.1")).resolves.toBeNull();
  });
});
