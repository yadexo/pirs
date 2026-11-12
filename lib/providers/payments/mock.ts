import { nanoid } from "nanoid";
import type { PaymentIntentResult, PaymentProvider, RefundResult, SubscriptionResult } from "./types";
import { isRealProduction } from "@/lib/deploy-env";

/**
 * Thrown when the mock provider is asked to take money in real production.
 *
 * The mock approves every payment without moving a cent. It is the default
 * whenever Stripe is not configured, so a missing key in production used to
 * mean every order was "paid" (docs/security/review-2026-11.md, P-2).
 * clinicPaymentMode() now refuses first; this is the same refusal one layer
 * down, for any caller that reaches the provider another way.
 */
export class MockPaymentsInProductionError extends Error {
  constructor() {
    super("Mock payments cannot take money in production. Stripe is not configured.");
    this.name = "MockPaymentsInProductionError";
  }
}

/**
 * Whether this deployment should decline mock payments, for exercising the
 * failed-payment path without a real processor.
 *
 * It is an environment setting, not something a caller passes in: a server
 * action is a live HTTP endpoint, so a "fail this payment" argument on one is
 * a switch the client holds. Ignored outright in production, where a decline
 * is Stripe's to report.
 */
export function mockDeclineRequested(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  return env.MOCK_PAYMENTS_DECLINE === "1";
}

/**
 * Deterministic in-process payment provider used when PAYMENT_PROVIDER=mock
 * (the default). No card data is ever collected or stored — a decline is
 * simulated on request, which is how the failed-payment path is exercised
 * without a real processor.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "MOCK" as const;

  async createIntent(params: {
    amountCents: number;
    currency: string;
    customerRef: string;
    description: string;
    simulateFailure?: boolean;
  }): Promise<PaymentIntentResult> {
    // A decline, not an exception: checkout already knows how to give back
    // what it was holding when a payment fails, and that is what must happen.
    if (isRealProduction()) {
      console.error("[payments] the mock provider was asked to charge in production; refused.");
      return { providerPaymentId: `refused_${nanoid(10)}`, status: "FAILED", failureReason: "Payments aren't available right now. Please try again later." };
    }
    if (params.simulateFailure) {
      return {
        providerPaymentId: `mock_pi_${nanoid(10)}`,
        status: "FAILED",
        failureReason: "Your card was declined (simulated).",
      };
    }
    return { providerPaymentId: `mock_pi_${nanoid(10)}`, status: "SUCCEEDED" };
  }

  async createSubscription(_params: {
    customerRef: string;
    planRef: string;
    amountCents: number;
    currency: string;
    intervalMonths: number;
  }): Promise<SubscriptionResult> {
    if (isRealProduction()) throw new MockPaymentsInProductionError();
    return { providerSubscriptionId: `mock_sub_${nanoid(10)}`, status: "ACTIVE" };
  }

  async cancelSubscription(): Promise<{ status: "CANCELLED" }> {
    return { status: "CANCELLED" };
  }

  async refund(_params: { providerPaymentId: string; amountCents: number; reason?: string }): Promise<RefundResult> {
    return { providerRefundId: `mock_re_${nanoid(10)}`, status: "SUCCEEDED" };
  }

  async updatePaymentMethodUrl(): Promise<{ url: string }> {
    return { url: "/customer/settings/payment-method?mock=1" };
  }
}
