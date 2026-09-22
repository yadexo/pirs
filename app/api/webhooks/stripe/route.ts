import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { alreadyProcessed, forgetProcessed, handleStripeEvent } from "@/lib/stripe-webhook";

/**
 * Stripe webhook receiver, registered in Stripe as an endpoint for events on
 * **connected accounts** (the clinics' own accounts, where clients' payments
 * are charged). Active once STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are
 * set; the signature is verified before anything is read.
 *
 * Handled: account.updated, account.application.deauthorized,
 * payment_intent.succeeded, payment_intent.payment_failed, charge.refunded,
 * charge.dispute.created, and membership subscription changes.
 * See lib/stripe-webhook.ts.
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

  // Stripe retries until it gets a 2xx, so the same event can arrive twice.
  if (await alreadyProcessed(event)) return NextResponse.json({ received: true, duplicate: true });

  try {
    await handleStripeEvent(event);
  } catch (err) {
    // Tell Stripe to retry rather than swallowing a half-applied change.
    await forgetProcessed(event.id);
    console.error(`[stripe-webhook] ${event.type} (${event.id}) failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not process this event." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
