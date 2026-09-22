import "server-only";
import type Stripe from "stripe";
import { rawDb } from "@/lib/db";
import { getTenantDb } from "@/lib/tenant-db";
import { completePaidOrder, releaseFailedOrder } from "@/lib/order-completion";
import { disconnectClinicAccount, syncClinicFromAccount } from "@/lib/stripe-connect";

/**
 * What each Stripe event does to our records. Split out of the route so the
 * tests can hand it events directly.
 *
 * Every handler is safe to run twice: Stripe retries, and a webhook can be
 * delivered more than once. `alreadyProcessed` stops the common case, and each
 * write is conditional so a race between two deliveries still settles once.
 */

/** True when this event has been acted on before. Records it otherwise. */
export async function alreadyProcessed(event: Stripe.Event): Promise<boolean> {
  try {
    await rawDb.processedStripeEvent.create({ data: { id: event.id, type: event.type, accountId: event.account ?? null } });
    return false;
  } catch {
    // Unique violation: another delivery of the same event got here first.
    return true;
  }
}

/**
 * Undoes the record above, so a handler that failed halfway is retried by
 * Stripe rather than being skipped as a duplicate.
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

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    // --- the clinic's Stripe account -------------------------------------
    case "account.updated": {
      // Stamped with the event's own time, so a late, older event can't undo a newer state.
      await syncClinicFromAccount(event.data.object as Stripe.Account, new Date(event.created * 1000));
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
      const method = intent.payment_method_types?.[0] ?? null;
      await rawDb.payment.updateMany({
        where: { id: payment.id },
        data: { status: "SUCCEEDED", failureReason: null, method },
      });
      if (payment.orderId) await completePaidOrder(getTenantDb(payment.tenantId), payment.orderId);
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
