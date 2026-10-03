import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { getPaymentProvider } from "@/lib/providers/payments";
import { refundDirectCharge } from "@/lib/stripe-payments";
import { voidItemsForOrder } from "@/lib/redeemable";
import { notifyRefundProcessed } from "@/lib/client-notifications";

/**
 * Refunding a client, in one place.
 *
 * The clinic took the money on its own Stripe account, so the refund happens
 * there too. Everything after the money — the order's status, the unused items
 * that stop working, the client's notification — is driven by Stripe's
 * charge.refunded webhook, which is also what catches a refund the clinic
 * makes in its own Stripe dashboard. Only when there is no webhook to wait for
 * (the mock provider, in local development) does this apply those itself.
 */

/**
 * Whether the platform gives back its cut when a clinic refunds a client.
 *
 * It does. The alternative is that a clinic refunding €100 is out of pocket by
 * the platform's fee on a sale it no longer has — the platform would be
 * keeping a commission on money that went back to the client. Stripe handles
 * the proportion for a partial refund.
 *
 * Changing this is a pricing decision, not a technical one, which is why it is
 * a named constant rather than a flag on a form.
 */
export const REFUND_RETURNS_PLATFORM_FEE = true;

export interface RefundResult {
  refundId: string;
  amountCents: number;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  /** True when this refund takes the payment to fully refunded. */
  fully: boolean;
}

export interface RefundInput {
  paymentId: string;
  /** Null or undefined means everything still refundable. */
  amountCents?: number | null;
  reason?: string | null;
  staffProfileId?: string | null;
}

/** What is left to give back on a payment, in cents. */
export function refundableRemainder(payment: { amountCents: number; refunds: { amountCents: number; status: string }[] }): number {
  const refunded = payment.refunds.filter((r) => r.status === "SUCCEEDED" || r.status === "PENDING").reduce((sum, r) => sum + r.amountCents, 0);
  return Math.max(0, payment.amountCents - refunded);
}

export async function refundPayment(db: TenantDb, input: RefundInput): Promise<{ error: string } | ({ ok: true } & RefundResult)> {
  const payment = await db.payment.findFirst({
    where: { id: input.paymentId },
    include: { order: { select: { id: true, currency: true } }, refunds: true },
  });
  if (!payment) return { error: "That payment no longer exists." };
  // A payment stays SUCCEEDED when refunded: what was given back lives on the
  // Refund rows, and the order is what changes status.
  if (payment.status !== "SUCCEEDED") return { error: "Only a payment that went through can be refunded." };

  const remaining = refundableRemainder(payment);
  if (remaining === 0) return { error: "This payment has already been refunded in full." };

  const amountCents = input.amountCents == null ? remaining : Math.round(input.amountCents);
  if (amountCents <= 0) return { error: "Enter an amount to refund." };
  if (amountCents > remaining) return { error: `That's more than the ${(remaining / 100).toFixed(2)} still refundable on this payment.` };

  const reason = input.reason?.trim() || "Refunded by the clinic";

  let result: { providerRefundId: string; status: "PENDING" | "SUCCEEDED" | "FAILED" };
  const viaStripe = payment.provider === "STRIPE" && payment.stripeAccountId && payment.providerPaymentId;
  if (viaStripe) {
    try {
      result = await refundDirectCharge({
        stripeAccountId: payment.stripeAccountId!,
        paymentIntentId: payment.providerPaymentId!,
        amountCents,
        reason,
        // The platform's cut goes back with the client's money.
        hasApplicationFee: REFUND_RETURNS_PLATFORM_FEE && payment.applicationFeeCents > 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stripe refused the refund.";
      console.error("[refund] Stripe refused:", message);
      return { error: `Stripe couldn't refund this payment: ${message}` };
    }
  } else {
    const provider = getPaymentProvider();
    result = await provider.refund({ providerPaymentId: payment.providerPaymentId ?? "", amountCents, reason });
  }

  const refund = await db.refund.create({
    data: {
      paymentId: payment.id,
      amountCents,
      reason,
      status: result.status,
      providerRefundId: result.providerRefundId,
      createdByStaffProfileId: input.staffProfileId ?? null,
    } as never,
    select: { id: true },
  });

  const fully = amountCents >= remaining;

  if (result.status === "SUCCEEDED") {
    // Stripe's webhook owns what happens to the order, so that a refund made
    // in the clinic's own Stripe dashboard behaves identically. Without a
    // webhook there is nothing coming, so do it here instead.
    if (!viaStripe && payment.orderId) {
      await db.order.updateMany({
        where: { id: payment.orderId, status: { in: ["PAID", "PARTIALLY_REFUNDED", "DISPUTED"] } },
        data: { status: fully ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
      await voidItemsForOrder(payment.orderId);
      await notifyRefundProcessed(payment.orderId, amountCents, fully);
    }
  }

  return { ok: true, refundId: refund.id, amountCents, status: result.status, fully };
}
