import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { alreadyProcessed, forgetProcessed, handleStripeEvent, markProcessed } from "@/lib/stripe-webhook";
import { verifyWithAnySecret, webhookSecrets } from "@/lib/stripe-webhook-secrets";

/**
 * Stripe webhook receiver, for two endpoints at one URL: one registered in
 * Stripe to listen to events on **connected accounts** (the clinics' own
 * accounts, where clients' payments are charged), and one for events on the
 * **platform account** itself. Stripe signs each with that endpoint's own
 * secret, so both STRIPE_CONNECT_WEBHOOK_SECRET and STRIPE_WEBHOOK_SECRET are
 * tried and the request is refused only if neither verifies.
 *
 * Handled: account.updated, account.application.deauthorized,
 * payment_intent.succeeded, payment_intent.payment_failed, charge.refunded,
 * charge.dispute.created, and membership subscription changes.
 * See lib/stripe-webhook.ts.
 */
export async function POST(req: NextRequest) {
  const secrets = webhookSecrets();
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (secrets.length === 0 || !stripeKey) {
    return NextResponse.json({ error: "Stripe is not configured on this instance." }, { status: 501 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const body = await req.text();
  const stripe = new Stripe(stripeKey);

  const verified = verifyWithAnySecret(body, signature, secrets, (payload, sig, secret) =>
    stripe.webhooks.constructEvent(payload, sig, secret),
  );
  if (!verified) return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  const { event } = verified;

  // Stripe retries until it gets a 2xx, so the same event can arrive twice.
  if (await alreadyProcessed(event)) return NextResponse.json({ received: true, duplicate: true });

  try {
    await handleStripeEvent(event);
    // Only now is the event finished. A claim left unstamped is picked up by a
    // later retry, so an instance killed on the line above loses nothing.
    await markProcessed(event.id);
  } catch (err) {
    // Tell Stripe to retry rather than swallowing a half-applied change.
    await forgetProcessed(event.id);
    console.error(`[stripe-webhook] ${event.type} (${event.id}) failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not process this event." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
