import "server-only";
import Stripe from "stripe";
import { rawDb } from "@/lib/db";
import { applicationFeeCents } from "@/lib/platform-fee";
import { isStripeConfigured, StripeNotConfiguredError } from "@/lib/stripe-connect";

/**
 * Client payments as *direct charges* on the clinic's own connected account:
 * the money lands in the clinic's balance, the clinic is the merchant of
 * record, and the platform takes its cut as an application fee.
 *
 * Nothing here completes a payment. The client confirms it in the browser with
 * the Payment Element, and the webhook is what marks an order paid — a browser
 * can be closed mid-payment, and bank methods finish minutes later.
 */

export class ClinicNotAcceptingPaymentsError extends Error {
  constructor(message = "This clinic can't take card payments yet. Please pay at the clinic, or try again later.") {
    super(message);
  }
}

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  return new Stripe(key);
}

/**
 * Whether real card payments should run for this clinic.
 *
 * With no Stripe keys (local development and the demo) checkout keeps using the
 * mock provider, so the app stays usable. Once Stripe is configured, a clinic
 * can only take payments when Stripe has actually enabled charges on its
 * account — ONBOARDING or PENDING_VERIFICATION is not enough.
 */
export async function clinicPaymentMode(tenantId: string): Promise<
  { mode: "mock" } | { mode: "stripe"; stripeAccountId: string } | { mode: "blocked"; reason: string }
> {
  if (!isStripeConfigured()) return { mode: "mock" };
  const clinic = await rawDb.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeAccountId: true, stripeStatus: true, stripeChargesEnabled: true },
  });
  if (!clinic?.stripeAccountId || clinic.stripeStatus !== "ACTIVE" || !clinic.stripeChargesEnabled) {
    return {
      mode: "blocked",
      reason:
        clinic?.stripeAccountId && clinic.stripeStatus === "PENDING_VERIFICATION"
          ? "This clinic is still being verified by Stripe, so it can't take card payments yet."
          : "This clinic can't take card payments yet.",
    };
  }
  return { mode: "stripe", stripeAccountId: clinic.stripeAccountId };
}

export interface DirectChargeResult {
  paymentIntentId: string;
  clientSecret: string;
  applicationFeeCents: number;
  publishableKey: string | null;
  stripeAccountId: string;
}

/**
 * A PaymentIntent on the clinic's account. `idempotencyKey` (the order id)
 * means a double-submitted checkout reuses the same intent instead of charging
 * twice.
 */
export async function createDirectCharge(params: {
  stripeAccountId: string;
  amountCents: number;
  subtotalCents: number;
  currency: string;
  description: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}): Promise<DirectChargeResult> {
  const fee = applicationFeeCents({ subtotalCents: params.subtotalCents, chargedCents: params.amountCents });
  const intent = await stripe().paymentIntents.create(
    {
      amount: params.amountCents,
      currency: params.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: params.description,
      metadata: params.metadata,
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
    },
    { stripeAccount: params.stripeAccountId, idempotencyKey: params.idempotencyKey },
  );
  if (!intent.client_secret) throw new Error("Stripe returned a payment without a client secret.");
  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    applicationFeeCents: fee,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
    stripeAccountId: params.stripeAccountId,
  };
}

/**
 * Refunds a charge on the clinic's account, giving back the platform's fee in
 * proportion. Without `refund_application_fee` the clinic would refund the
 * client in full while the platform kept its cut.
 */
export async function refundDirectCharge(params: {
  stripeAccountId: string;
  paymentIntentId: string;
  amountCents: number;
  reason?: string;
  hasApplicationFee: boolean;
}): Promise<{ providerRefundId: string; status: "PENDING" | "SUCCEEDED" | "FAILED" }> {
  const refund = await stripe().refunds.create(
    {
      payment_intent: params.paymentIntentId,
      amount: params.amountCents,
      ...(params.hasApplicationFee ? { refund_application_fee: true } : {}),
      ...(params.reason ? { metadata: { reason: params.reason } } : {}),
    },
    { stripeAccount: params.stripeAccountId },
  );
  return {
    providerRefundId: refund.id,
    status: refund.status === "succeeded" ? "SUCCEEDED" : refund.status === "failed" ? "FAILED" : "PENDING",
  };
}
