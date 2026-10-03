import { nanoid } from "nanoid";
import type { PaymentIntentResult, PaymentProvider, RefundResult, SubscriptionResult } from "./types";

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
