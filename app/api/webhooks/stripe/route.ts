import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { rawDb } from "@/lib/db";

/**
 * Stripe webhook receiver. Only active when PAYMENT_PROVIDER=stripe and
 * STRIPE_WEBHOOK_SECRET is configured. Verifies the signature, then updates
 * the matching Payment/Order (by providerPaymentId) or CustomerMembership
 * (by stripeSubscriptionId) rows. Register this endpoint
 * (`/api/webhooks/stripe`) in the Stripe dashboard once real keys are added.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!secret || !stripeKey) {
    return NextResponse.json({ error: "Stripe is not configured on this instance." }, { status: 501 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const body = await req.text();
  const stripe = new Stripe(stripeKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const payment = await rawDb.payment.findFirst({ where: { providerPaymentId: intent.id } });
      if (payment) {
        await rawDb.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED" } });
        if (payment.orderId) {
          await rawDb.order.update({ where: { id: payment.orderId }, data: { status: "PAID", paidAt: new Date() } });
        }
      }
      break;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const payment = await rawDb.payment.findFirst({ where: { providerPaymentId: intent.id } });
      if (payment) {
        await rawDb.payment.update({
          where: { id: payment.id },
          data: { status: "FAILED", failureReason: intent.last_payment_error?.message },
        });
        if (payment.orderId) {
          await rawDb.order.update({ where: { id: payment.orderId }, data: { status: "FAILED" } });
        }
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const membership = await rawDb.customerMembership.findFirst({ where: { stripeSubscriptionId: sub.id } });
      if (membership) {
        const status =
          sub.status === "active"
            ? "ACTIVE"
            : sub.status === "trialing"
              ? "TRIAL"
              : sub.status === "past_due"
                ? "PAST_DUE"
                : sub.status === "canceled"
                  ? "CANCELLED"
                  : membership.status;
        await rawDb.customerMembership.update({ where: { id: membership.id }, data: { status } });
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
