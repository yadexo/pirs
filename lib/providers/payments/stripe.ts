import Stripe from "stripe";
import type { PaymentIntentResult, PaymentProvider, RefundResult, SubscriptionResult } from "./types";

function getClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Set PAYMENT_PROVIDER=mock, or configure Stripe keys in .env (see .env.example).",
    );
  }
  return new Stripe(key);
}

const statusMap: Record<string, PaymentIntentResult["status"]> = {
  requires_payment_method: "REQUIRES_ACTION",
  requires_confirmation: "REQUIRES_ACTION",
  requires_action: "REQUIRES_ACTION",
  processing: "PROCESSING",
  succeeded: "SUCCEEDED",
  canceled: "CANCELLED",
};

/**
 * Stripe-backed implementation, enabled via PAYMENT_PROVIDER=stripe. Requires
 * STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for webhook verification —
 * see app/api/webhooks/stripe/route.ts). Card data never touches this
 * codebase: the client collects it directly with Stripe Elements/Checkout
 * and only a token/payment-method id crosses the network to us.
 */
export class StripePaymentProvider implements PaymentProvider {
  async createIntent(params: {
    amountCents: number;
    currency: string;
    customerRef: string;
    description: string;
  }): Promise<PaymentIntentResult> {
    const stripe = getClient();
    const intent = await stripe.paymentIntents.create({
      amount: params.amountCents,
      currency: params.currency.toLowerCase(),
      description: params.description,
      metadata: { customerRef: params.customerRef },
      automatic_payment_methods: { enabled: true },
    });
    return {
      providerPaymentId: intent.id,
      status: statusMap[intent.status] ?? "PROCESSING",
      clientSecret: intent.client_secret ?? undefined,
    };
  }

  async createSubscription(params: {
    customerRef: string;
    planRef: string;
    amountCents: number;
    currency: string;
    intervalMonths: number;
  }): Promise<SubscriptionResult> {
    const stripe = getClient();
    const price = await stripe.prices.create({
      unit_amount: params.amountCents,
      currency: params.currency.toLowerCase(),
      recurring: { interval: params.intervalMonths === 12 ? "year" : "month" },
      product_data: { name: params.planRef },
    });
    const subscription = await stripe.subscriptions.create({
      customer: params.customerRef,
      items: [{ price: price.id }],
      payment_behavior: "default_incomplete",
    });
    return {
      providerSubscriptionId: subscription.id,
      status: subscription.status === "active" ? "ACTIVE" : subscription.status === "trialing" ? "TRIAL" : "PAST_DUE",
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<{ status: "CANCELLED" }> {
    const stripe = getClient();
    await stripe.subscriptions.cancel(providerSubscriptionId);
    return { status: "CANCELLED" };
  }

  async refund(params: { providerPaymentId: string; amountCents: number; reason?: string }): Promise<RefundResult> {
    const stripe = getClient();
    const refund = await stripe.refunds.create({
      payment_intent: params.providerPaymentId,
      amount: params.amountCents,
    });
    return {
      providerRefundId: refund.id,
      status: refund.status === "succeeded" ? "SUCCEEDED" : refund.status === "failed" ? "FAILED" : "PENDING",
    };
  }

  async updatePaymentMethodUrl(customerRef: string): Promise<{ url: string }> {
    const stripe = getClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerRef,
      return_url: `${process.env.APP_URL ?? "http://localhost:3000"}/customer/settings`,
    });
    return { url: session.url };
  }
}
