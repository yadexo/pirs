import { describe, it, expect } from "vitest";
import { MockPaymentProvider } from "@/lib/providers/payments/mock";

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
