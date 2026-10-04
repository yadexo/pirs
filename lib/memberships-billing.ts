import "server-only";
import type Stripe from "stripe";
import { rawDb } from "@/lib/db";
import { stripe } from "@/lib/stripe-payments";
import { platformFeePercent } from "@/lib/platform-fee";

/**
 * Memberships billed as Stripe subscriptions on the clinic's own connected
 * account.
 *
 * Everything lives on that account: the customer, the price, the subscription
 * and the invoices. The clinic is the merchant of record for its own members,
 * sees them in its own Stripe dashboard, and Stripe owns the schedule, the
 * invoices and the card retries. The platform takes its cut as an application
 * fee percentage on each invoice.
 *
 * Nothing here activates a membership. The first invoice is created
 * incomplete, the client confirms it in the browser, and invoice.paid is what
 * turns the membership on — a browser can be closed mid-payment, and a card
 * can fail after the client has walked away.
 */

/**
 * The platform's percentage of a clinic's membership invoices.
 *
 * A clinic's own setting wins, including 0 — an agency may well give a clinic
 * memberships for nothing. Only when nothing is set does it fall back to the
 * percentage the clinic's other sales pay, so an agency that never touches
 * this gets one consistent rate. Clamped to Stripe's accepted range.
 */
export function membershipFeePercentFor(
  clinic: { membershipFeePercent: number | null },
  env: NodeJS.ProcessEnv = process.env,
): number {
  const own = clinic.membershipFeePercent;
  const percent = own === null || own === undefined || !Number.isFinite(own) ? platformFeePercent(env) : own;
  if (percent <= 0) return 0;
  // Stripe takes at most two decimal places.
  return Math.min(Math.round(percent * 100) / 100, 100);
}

interface Clinic {
  id: string;
  stripeAccountId: string;
  membershipFeePercent: number | null;
}

/**
 * This client as a customer on the clinic's account, created once and
 * remembered. The id is scoped to that one connected account, which is why it
 * can live on the profile: a profile belongs to exactly one clinic.
 */
export async function ensureStripeCustomer(
  clinic: Clinic,
  profile: { id: string; stripeCustomerId: string | null; firstName: string | null; lastName: string | null; email: string | null },
): Promise<string> {
  if (profile.stripeCustomerId) return profile.stripeCustomerId;

  const customer = await stripe().customers.create(
    {
      name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || undefined,
      email: profile.email ?? undefined,
      metadata: { customerProfileId: profile.id, tenantId: clinic.id },
    },
    // One customer per profile however many times a join is retried.
    { stripeAccount: clinic.stripeAccountId, idempotencyKey: `customer-${profile.id}` },
  );
  await rawDb.customerProfile.updateMany({ where: { id: profile.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/**
 * The recurring price for a plan, on the clinic's account.
 *
 * A Stripe price is immutable, so a plan whose price or interval has changed
 * needs a new one; the stored id is only reused when it still describes what
 * the clinic is charging today. Members already on the old price keep it until
 * their subscription is changed, which is Stripe's behaviour and the honest
 * one — nobody's rate changes without being told.
 */
export async function ensureStripePrice(
  clinic: Clinic,
  plan: { id: string; name: string; priceCents: number; billingFrequency: string; stripeProductId: string | null; stripePriceId: string | null },
  currency: string,
): Promise<string> {
  const interval = plan.billingFrequency === "MONTHLY" ? "month" : "year";

  if (plan.stripePriceId) {
    const existing = await stripe()
      .prices.retrieve(plan.stripePriceId, { stripeAccount: clinic.stripeAccountId })
      .catch(() => null);
    const matches =
      existing?.active &&
      existing.unit_amount === plan.priceCents &&
      existing.currency === currency.toLowerCase() &&
      existing.recurring?.interval === interval;
    if (matches) return existing.id;
  }

  const price = await stripe().prices.create(
    {
      unit_amount: plan.priceCents,
      currency: currency.toLowerCase(),
      recurring: { interval },
      ...(plan.stripeProductId ? { product: plan.stripeProductId } : { product_data: { name: plan.name } }),
      metadata: { membershipPlanId: plan.id },
    },
    { stripeAccount: clinic.stripeAccountId },
  );

  const productId = typeof price.product === "string" ? price.product : price.product?.id;
  await rawDb.membershipPlan.updateMany({
    where: { id: plan.id },
    data: { stripePriceId: price.id, stripeProductId: productId ?? plan.stripeProductId },
  });
  return price.id;
}

export interface SubscriptionHandoff {
  subscriptionId: string;
  /** Null when the first invoice needed no payment (a 0-cost or trial plan). */
  clientSecret: string | null;
  publishableKey: string | null;
  stripeAccountId: string;
  applicationFeePercent: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/**
 * Creates the subscription with its first invoice left incomplete, so nothing
 * is charged until the client confirms it in the Payment Element.
 */
export async function createMembershipSubscription(params: {
  clinic: Clinic;
  stripeCustomerId: string;
  priceId: string;
  membershipId: string;
  planId: string;
  customerProfileId: string;
}): Promise<SubscriptionHandoff> {
  const feePercent = membershipFeePercentFor(params.clinic);

  const subscription = await stripe().subscriptions.create(
    {
      customer: params.stripeCustomerId,
      items: [{ price: params.priceId }],
      // The client confirms the first invoice; until then nothing is charged.
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      ...(feePercent > 0 ? { application_fee_percent: feePercent } : {}),
      metadata: {
        membershipId: params.membershipId,
        membershipPlanId: params.planId,
        customerProfileId: params.customerProfileId,
        tenantId: params.clinic.id,
      },
    },
    // A double-submitted join reuses the subscription rather than making two.
    { stripeAccount: params.clinic.stripeAccountId, idempotencyKey: `membership-${params.membershipId}` },
  );

  const invoice = subscription.latest_invoice as Stripe.Invoice | null;
  const intent = invoice ? ((invoice as { payment_intent?: Stripe.PaymentIntent | string }).payment_intent ?? null) : null;
  const clientSecret = typeof intent === "string" ? null : (intent?.client_secret ?? null);

  return {
    subscriptionId: subscription.id,
    clientSecret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
    stripeAccountId: params.clinic.stripeAccountId,
    applicationFeePercent: feePercent,
    currentPeriodStart: periodDate(subscription, "current_period_start"),
    currentPeriodEnd: periodDate(subscription, "current_period_end"),
  };
}

/** Ends a subscription on the clinic's account. */
export async function cancelMembershipSubscription(stripeAccountId: string, subscriptionId: string): Promise<void> {
  await stripe().subscriptions.cancel(subscriptionId, undefined, { stripeAccount: stripeAccountId });
}

/**
 * Stripe moved these onto the subscription's items in a later API version, so
 * read either shape rather than assuming one. A subscription with no dates yet
 * (the first invoice is still unpaid) falls back to now.
 */
function periodDate(subscription: Stripe.Subscription, field: "current_period_start" | "current_period_end"): Date {
  const onSubscription = (subscription as unknown as Record<string, unknown>)[field];
  if (typeof onSubscription === "number") return new Date(onSubscription * 1000);
  const onItem = subscription.items?.data?.[0] as unknown as Record<string, unknown> | undefined;
  const fromItem = onItem?.[field];
  if (typeof fromItem === "number") return new Date(fromItem * 1000);
  return new Date();
}

/**
 * Changing a subscription that already exists.
 *
 * Every one of these asks Stripe first and lets the webhook write our side:
 * Stripe owns the schedule and the money, so our row is a copy of its answer
 * rather than a second opinion. The actions below still write what they know
 * immediately, because a clinic should see the result of its own click — but
 * if the two ever disagree, the webhook's version is the one that stands.
 */

/** The subscription as Stripe has it, or null when it is gone. */
export async function readSubscription(stripeAccountId: string, subscriptionId: string): Promise<Stripe.Subscription | null> {
  return stripe()
    .subscriptions.retrieve(subscriptionId, { stripeAccount: stripeAccountId })
    .catch(() => null);
}

/**
 * Ends the membership when the period the client has paid for runs out,
 * rather than taking away something they are still paying for.
 */
export async function cancelAtPeriodEnd(stripeAccountId: string, subscriptionId: string, cancel: boolean): Promise<Stripe.Subscription> {
  return stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancel }, { stripeAccount: stripeAccountId });
}

/**
 * Stops the invoices without ending the membership.
 *
 * `void` is the behaviour that matters: invoices raised while paused are
 * voided rather than piling up to be collected when it resumes, which is what
 * a clinic means by "pause billing" and never what a client expects to come
 * back to.
 */
export async function pauseCollection(stripeAccountId: string, subscriptionId: string, paused: boolean): Promise<Stripe.Subscription> {
  return stripe().subscriptions.update(
    subscriptionId,
    paused ? { pause_collection: { behavior: "void" } } : { pause_collection: null },
    { stripeAccount: stripeAccountId },
  );
}

/**
 * Moves a subscription onto another price from its next period.
 *
 * `proration_behavior: "none"` is the whole point: nothing is charged or
 * credited in the middle of a period the client has already paid for. They
 * keep what they bought until it runs out, and the new price starts when the
 * next one would have.
 */
export async function switchSubscriptionPrice(
  stripeAccountId: string,
  subscriptionId: string,
  priceId: string,
): Promise<Stripe.Subscription> {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId, { stripeAccount: stripeAccountId });
  const item = subscription.items?.data?.[0];
  if (!item) throw new Error("That subscription has nothing on it to change.");

  return stripe().subscriptions.update(
    subscriptionId,
    {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: "none",
      // The client keeps the day of the month they signed up on.
      billing_cycle_anchor: "unchanged",
    },
    { stripeAccount: stripeAccountId },
  );
}

/**
 * Gives the client free time by pushing the next payment back.
 *
 * Stripe calls this a trial, which is the right machinery under a different
 * name: the subscription stays live, benefits continue, and nothing is
 * charged until the date given. Proration is off so the gift costs the client
 * nothing and refunds them nothing.
 */
export async function skipBillingUntil(stripeAccountId: string, subscriptionId: string, until: Date): Promise<Stripe.Subscription> {
  return stripe().subscriptions.update(
    subscriptionId,
    { trial_end: Math.floor(until.getTime() / 1000), proration_behavior: "none" },
    { stripeAccount: stripeAccountId },
  );
}

/** The end of the period this subscription is currently in. */
export function currentPeriodEndOf(subscription: Stripe.Subscription): Date {
  return periodDate(subscription, "current_period_end");
}

/**
 * The date that is `periods` whole billing periods after `from`, which is what
 * "skip the next two months" means on a monthly plan.
 */
export function addBillingPeriods(from: Date, periods: number, frequency: string): Date {
  const out = new Date(from);
  if (frequency === "MONTHLY") out.setMonth(out.getMonth() + periods);
  else out.setFullYear(out.getFullYear() + periods);
  return out;
}
