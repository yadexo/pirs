import { nanoid } from "nanoid";
import type { PaymentIntentResult, PaymentProvider, RefundResult, SubscriptionResult } from "./types";

/**
 * Deterministic in-process payment provider used when PAYMENT_PROVIDER=mock
 * (the default). No card data is ever collected or stored — checkout simply
 * asks whether to simulate a decline, which is how the failed-payment path
 * is exercised without a real processor.
 */
export class MockPaymentProvider implements PaymentProvider {
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
