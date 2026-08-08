export type PaymentIntentResult = {
  providerPaymentId: string;
  status: "REQUIRES_ACTION" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  clientSecret?: string;
  failureReason?: string;
};

export type SubscriptionResult = {
  providerSubscriptionId: string;
  status: "ACTIVE" | "TRIAL" | "PAST_DUE" | "CANCELLED";
};

export type RefundResult = {
  providerRefundId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
};

export interface PaymentProvider {
  /** Charge a one-off amount (order checkout). */
  createIntent(params: {
    amountCents: number;
    currency: string;
    customerRef: string;
    description: string;
    /** Demo-only: force a failed outcome so the failure path is testable. */
    simulateFailure?: boolean;
  }): Promise<PaymentIntentResult>;

  /** Start a recurring membership charge. */
  createSubscription(params: {
    customerRef: string;
    planRef: string;
    amountCents: number;
    currency: string;
    intervalMonths: number;
  }): Promise<SubscriptionResult>;

  cancelSubscription(providerSubscriptionId: string): Promise<{ status: "CANCELLED" }>;

  refund(params: { providerPaymentId: string; amountCents: number; reason?: string }): Promise<RefundResult>;

  /** Returns a provider-hosted URL (or no-op for mock) to update a stored payment method. */
  updatePaymentMethodUrl(customerRef: string): Promise<{ url: string }>;
}
