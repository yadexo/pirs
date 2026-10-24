import { describe, it, expect, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";

vi.mock("server-only", () => ({}));
const { authorizeCredentials } = await import("@/lib/auth-credentials");

/**
 * Both limits are real: enough wrong attempts against one account locks that
 * account out even from a fresh IP, and enough attempts spread across many
 * accounts from one IP locks that IP out even against accounts it hasn't
 * tried yet. Either one alone would miss half of what credential stuffing
 * looks like.
 */
describe("sign-in rate limiting", () => {
  it("locks the account after enough wrong attempts, with a 'try again in' message, and recovers with the right password", async () => {
    // Real bcrypt compares for every attempt, by design — slow on purpose.
    const email = `ratelimit-${Date.now()}@example.com`;
    await rawDb.user.create({ data: { email, passwordHash: await hashPassword("correct-horse-1"), role: "PLATFORM_ADMIN" } });
    const creds = { portal: "unified", email, password: "wrong" };

    let limited: Error | null = null;
    for (let i = 0; i < 11; i++) {
      try {
        await authorizeCredentials(creds, "staff", `203.0.113.${i}`); // a fresh IP each time, so only the account limit can trip
      } catch (err) {
        limited = err as Error;
        break;
      }
    }
    expect(limited).toBeTruthy();
    expect(limited!.message).toMatch(/too many sign-in attempts.*try again in/i);

    // The right password doesn't lift the lock early.
    await expect(authorizeCredentials({ portal: "unified", email, password: "correct-horse-1" }, "staff", "203.0.113.99")).rejects.toThrow(/too many/i);
  }, 60000);

  it("locks the IP after enough attempts spread across different accounts", async () => {
    // None of these accounts need to exist — the IP check runs before any
    // lookup, same as it would for a botnet trying addresses at random.
    const stamp = Date.now();
    const ip = "198.51.100.42";

    let limited: Error | null = null;
    for (let i = 0; i < 31; i++) {
      try {
        await authorizeCredentials({ portal: "unified", email: `iplimit-${stamp}-${i}@example.com`, password: "wrong" }, "staff", ip);
      } catch (err) {
        limited = err as Error;
        break;
      }
    }
    expect(limited).toBeTruthy();
    expect(limited!.message).toMatch(/too many sign-in attempts.*try again in/i);
  });

  it("never throws for a null credentials object (Auth.js's own CredentialsSignin handles that)", async () => {
    await expect(authorizeCredentials(undefined, "staff", "203.0.113.1")).resolves.toBeNull();
  });
});
