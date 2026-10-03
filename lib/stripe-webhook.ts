import "server-only";
import type Stripe from "stripe";
import { rawDb } from "@/lib/db";
import { getTenantDb } from "@/lib/tenant-db";
import { completePaidOrder, releaseFailedOrder } from "@/lib/order-completion";
import { disconnectClinicAccount, syncClinicFromAccount } from "@/lib/stripe-connect";
import { domainsApi, registerApplePayDomains } from "@/lib/apple-pay-domains";
import { notifyOrderPaid, notifyRefundProcessed } from "@/lib/client-notifications";
import { createItemsForOrder, voidItemsForOrder } from "@/lib/redeemable";
import { stripe } from "@/lib/stripe-payments";

/**
 * What each Stripe event does to our records. Split out of the route so the
 * tests can hand it events directly.
 *
 * Every handler is safe to run twice: Stripe retries, and a webhook can be
 * delivered more than once. `alreadyProcessed` stops the common case, and each
 * write is conditional so a race between two deliveries still settles once.
 */

/**
 * How long a claim is assumed to belong to a handler that is still working.
 *
 * Above Stripe's own 25-second limit for a response, and above the time our
 * slowest handler can take, so a claim older than this belongs to an instance
 * that is gone rather than one still running.
 */
const CLAIM_HOLDS_FOR_MS = 5 * 60 * 1000;

/**
 * True when this event is not ours to handle — already finished, or claimed
 * by a delivery that could still be working on it. Claims it otherwise.
 *
 * The claim is written before the handler runs, so two simultaneous
 * deliveries cannot both act. But a claim is not proof of completion: an
 * instance can be killed mid-handler, and that used to leave the event
 * answered "already done" for every later retry, with the order stuck
 * unpaid. So a claim nobody stamped, old enough that no handler can still be
 * running, is taken over by the next retry.
 */
export async function alreadyProcessed(event: Stripe.Event): Promise<boolean> {
  try {
    await rawDb.processedStripeEvent.create({ data: { id: event.id, type: event.type, accountId: event.account ?? null } });
    return false;
  } catch {
    // Unique violation: this event has been claimed before.
    const stale = new Date(Date.now() - CLAIM_HOLDS_FOR_MS);
    const takenOver = await rawDb.processedStripeEvent.updateMany({
      where: { id: event.id, completedAt: null, processedAt: { lt: stale } },
      data: { processedAt: new Date() },
    });
    // Exactly one retry wins the take-over; anyone else steps back.
    return takenOver.count === 0;
  }
}

/** Stamps a claim as finished, so no later retry re-runs it. */
export async function markProcessed(eventId: string): Promise<void> {
  await rawDb.processedStripeEvent.updateMany({ where: { id: eventId }, data: { completedAt: new Date() } });
}

/**
 * Undoes the claim, so a handler that failed outright is retried by Stripe
 * immediately rather than waiting out the claim.
 */
export async function forgetProcessed(eventId: string): Promise<void> {
  await rawDb.processedStripeEvent.deleteMany({ where: { id: eventId } });
}

async function paymentFor(paymentIntentId: string | null | undefined) {
  if (!paymentIntentId) return null;
  return rawDb.payment.findFirst({ where: { providerPaymentId: paymentIntentId } });
}

function intentId(charge: Stripe.Charge): string | null {
  return typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null);
}

/**
 * Apple Pay domain registration is a convenience, not part of the event. If it
 * fails the clinic still takes card payments, so it must never make the webhook
 * return an error — that would have Stripe retry the whole event.
 */
async function registerDomainsQuietly(stripeAccountId: string): Promise<void> {
  try {
    const results = await registerApplePayDomains(domainsApi(stripe()), stripeAccountId);
    for (const result of results.filter((r) => r.status === "failed")) {
      console.error(`[stripe-webhook] Apple Pay domain ${result.domain} not registered for ${stripeAccountId}: ${result.error}`);
    }
  } catch (err) {
    console.error(`[stripe-webhook] Apple Pay domains skipped for ${stripeAccountId}:`, err instanceof Error ? err.message : err);
  }
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    // --- the clinic's Stripe account -------------------------------------
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const before = await rawDb.tenant.findFirst({ where: { stripeAccountId: account.id }, select: { stripeChargesEnabled: true } });
      // Stamped with the event's own time, so a late, older event can't undo a newer state.
      await syncClinicFromAccount(account, new Date(event.created * 1000));
      // The moment Stripe switches charges on is when Apple Pay can be set up
      // for this clinic: the domains have to be registered on the clinic's own account.
      if (account.charges_enabled && before && !before.stripeChargesEnabled) await registerDomainsQuietly(account.id);
      return;
    }
    case "account.application.deauthorized": {
      if (event.account) await disconnectClinicAccount(event.account);
      return;
    }

    // --- client payments --------------------------------------------------
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const payment = await paymentFor(intent.id);
      if (!payment) return;

      // What was actually collected, against what the order was priced at by
      // this server. These are direct charges on the clinic's own account, so
      // the clinic can capture less than was asked for in its own dashboard;
      // that must not hand the client a paid order and collectable items.
      // Left pending rather than failed: the money is real, it is just short,
      // and somebody has to look at it.
      //
      // An event that carries neither field is let through. Stripe always
      // sends them, and only Stripe can sign an event, so the alternative —
      // refusing on an absent field — would risk wedging real payments to
      // guard against a forgery nobody can produce.
      const collected = intent.amount_received ?? intent.amount ?? null;
      if (collected != null && collected < payment.amountCents) {
        console.error(
          `[stripe-webhook] ${intent.id} collected ${collected} but ${payment.amountCents} was due on payment ${payment.id}; order left pending`,
        );
        await rawDb.payment.updateMany({
          where: { id: payment.id },
          data: { status: "PROCESSING", failureReason: `Only ${collected} of ${payment.amountCents} was collected.` },
        });
        return;
      }

      const method = intent.payment_method_types?.[0] ?? null;
      await rawDb.payment.updateMany({
        where: { id: payment.id },
        data: { status: "SUCCEEDED", failureReason: null, method },
      });
      if (payment.orderId) {
        await completePaidOrder(getTenantDb(payment.tenantId), payment.orderId);
        // Paid for means collectable: one code per unit bought. Safe to
        // repeat, because Stripe can deliver the same event twice.
        await createItemsForOrder(payment.orderId);
        // After the order is settled, and unable to affect it: a failed
        // notification must not make Stripe retry a payment already applied.
        await notifyOrderPaid(payment.orderId, payment.amountCents);
      }
      return;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const payment = await paymentFor(intent.id);
      if (!payment) return;
      const reason = intent.last_payment_error?.message ?? "The payment was declined.";
      await rawDb.payment.updateMany({ where: { id: payment.id }, data: { status: "FAILED", failureReason: reason } });
      // The client can try again: their basket is still open, and a new attempt
      // makes a new order.
      if (payment.orderId) await releaseFailedOrder(getTenantDb(payment.tenantId), payment.orderId, reason);
      return;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const payment = await paymentFor(intentId(charge));
      if (!payment) return;
      const db = getTenantDb(payment.tenantId);
      const refundedCents = charge.amount_refunded ?? 0;
      const fully = refundedCents >= payment.amountCents;

      // A refund made in the clinic's own Stripe Dashboard has no row here yet.
      const latest = charge.refunds?.data?.[0];
      if (latest?.id && !(await db.refund.findFirst({ where: { providerRefundId: latest.id } }))) {
        await db.refund.create({
          data: {
            paymentId: payment.id,
            amountCents: latest.amount,
            reason: latest.reason ?? "Refunded in Stripe",
            status: latest.status === "succeeded" ? "SUCCEEDED" : latest.status === "failed" ? "FAILED" : "PENDING",
            providerRefundId: latest.id,
          } as never,
        });
      }
      if (payment.orderId) {
        await db.order.updateMany({
          where: { id: payment.orderId, status: { in: ["PAID", "PARTIALLY_REFUNDED", "DISPUTED"] } },
          data: { status: fully ? "REFUNDED" : "PARTIALLY_REFUNDED" },
        });
        // Unused items stop working; used ones are flagged, not hidden.
        await voidItemsForOrder(payment.orderId);
        await notifyRefundProcessed(payment.orderId, refundedCents, fully);
      }
      return;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      // A dispute names the charge, not the intent; find the payment either way.
      const payment =
        (await paymentFor(typeof dispute.payment_intent === "string" ? dispute.payment_intent : (dispute.payment_intent?.id ?? null))) ??
        (chargeId ? await rawDb.payment.findFirst({ where: { providerPaymentId: chargeId } }) : null);
      if (!payment) return;
      await rawDb.payment.updateMany({
        where: { id: payment.id },
        data: { status: "DISPUTED", disputedAt: new Date(event.created * 1000), failureReason: dispute.reason ?? "Disputed by the cardholder" },
      });
      if (payment.orderId) {
        await rawDb.order.updateMany({ where: { id: payment.orderId, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, data: { status: "DISPUTED" } });
      }
      return;
    }

    // --- memberships ------------------------------------------------------
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const membership = await rawDb.customerMembership.findFirst({ where: { stripeSubscriptionId: sub.id } });
      if (!membership) return;
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
      return;
    }
    default:
      return;
  }
}
