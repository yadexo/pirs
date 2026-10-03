import { describe, it, expect } from "vitest";
import { MockPaymentProvider, mockDeclineRequested } from "@/lib/providers/payments/mock";

/**
 * Who gets to say a payment failed. Not the client: checkout is a live
 * endpoint, so a decline has to be asked for by whoever runs the deployment,
 * and cannot be asked for at all in production.
 */
describe("asking for a simulated decline", () => {
  it("is off unless the environment asks for it", () => {
    expect(mockDeclineRequested({})).toBe(false);
    expect(mockDeclineRequested({ MOCK_PAYMENTS_DECLINE: "0" })).toBe(false);
    expect(mockDeclineRequested({ MOCK_PAYMENTS_DECLINE: "true" })).toBe(false);
  });

  it("is honoured in development", () => {
    expect(mockDeclineRequested({ MOCK_PAYMENTS_DECLINE: "1" })).toBe(true);
    expect(mockDeclineRequested({ MOCK_PAYMENTS_DECLINE: "1", NODE_ENV: "test" })).toBe(true);
  });

  it("is ignored in production, whatever is set", () => {
    expect(mockDeclineRequested({ MOCK_PAYMENTS_DECLINE: "1", NODE_ENV: "production" })).toBe(false);
  });
});

describe("MockPaymentProvider", () => {
  const provider = new MockPaymentProvider();

  it("succeeds by default and never stores card data", async () => {
    const result = await provider.createIntent({
      amountCents: 5000,
      currency: "USD",
      customerRef: "cust_1",
      description: "Test order",
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.providerPaymentId).toMatch(/^mock_pi_/);
    expect(result).not.toHaveProperty("card");
  });

  it("simulates a decline when asked, with a failure reason", async () => {
    const result = await provider.createIntent({
      amountCents: 5000,
      currency: "USD",
      customerRef: "cust_1",
      description: "Test order",
      simulateFailure: true,
    });
    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toBeTruthy();
  });

  it("creates and cancels a subscription", async () => {
    const sub = await provider.createSubscription({
      customerRef: "cust_1",
      planRef: "Wellness Essentials",
      amountCents: 4900,
      currency: "USD",
      intervalMonths: 1,
    });
    expect(sub.status).toBe("ACTIVE");

    const cancelled = await provider.cancelSubscription();
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("refunds a payment", async () => {
    const refund = await provider.refund({ providerPaymentId: "mock_pi_abc", amountCents: 2000, reason: "Customer request" });
    expect(refund.status).toBe("SUCCEEDED");
    expect(refund.providerRefundId).toMatch(/^mock_re_/);
  });
});
