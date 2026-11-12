/**
 * What "no Stripe key" means, depending on where the code is running.
 *
 * On a developer's machine and on staging it means the mock provider, which
 * approves everything. In real production it used to mean the same thing —
 * a missing or mistyped key turned every checkout into a completed sale with
 * no money behind it (docs/security/review-2026-11.md, P-2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  rawDb: {
    tenant: {
      findUnique: async () => {
        throw new Error("the database must not be needed to decide this");
      },
    },
  },
}));

const { clinicPaymentMode } = await import("@/lib/stripe-payments");
const { MockPaymentProvider, MockPaymentsInProductionError } = await import("@/lib/providers/payments/mock");

const KEYS = ["STRIPE_SECRET_KEY", "VERCEL_ENV", "APP_ENV"] as const;

describe("payments without a Stripe key", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  const intent = () => new MockPaymentProvider().createIntent({ amountCents: 15_000, currency: "EUR", customerRef: "c", description: "Order" });
  const subscription = () => new MockPaymentProvider().createSubscription({ customerRef: "c", planRef: "p", amountCents: 4_900, currency: "EUR", intervalMonths: 1 });

  describe("on a developer's machine or on staging", () => {
    it("uses the mock provider, which approves", async () => {
      for (const env of [undefined, "preview", "development"]) {
        if (env) process.env.VERCEL_ENV = env;
        expect(await clinicPaymentMode("any-clinic"), String(env)).toEqual({ mode: "mock" });
        expect((await intent()).status).toBe("SUCCEEDED");
        expect((await subscription()).status).toBe("ACTIVE");
      }
    });
  });

  describe("in real production", () => {
    for (const [name, set] of [
      ["Vercel's production environment", () => (process.env.VERCEL_ENV = "production")],
      ["APP_ENV=production on any other host", () => (process.env.APP_ENV = "production")],
    ] as const) {
      describe(name, () => {
        beforeEach(() => void set());

        it("refuses card payments outright instead of pretending they went through", async () => {
          const mode = await clinicPaymentMode("any-clinic");
          expect(mode.mode).toBe("blocked");
          // What a client is shown names no key and no provider.
          expect(JSON.stringify(mode)).not.toMatch(/stripe|key|mock/i);
        });

        it("says so in the logs, where someone will see it", async () => {
          await clinicPaymentMode("any-clinic");
          expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain("STRIPE_SECRET_KEY is not set in production");
        });

        it("the mock provider declines a charge even when asked directly", async () => {
          const result = await intent();
          expect(result.status).toBe("FAILED");
          expect(result.failureReason).toBeTruthy();
        });

        it("and will not start a membership", async () => {
          await expect(subscription()).rejects.toBeInstanceOf(MockPaymentsInProductionError);
        });
      });
    }
  });
});
