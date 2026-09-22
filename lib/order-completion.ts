import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { adjustLoyaltyPoints } from "@/lib/loyalty";
import { recordActivity } from "@/lib/activity";

/**
 * What happens to an order once its payment settles.
 *
 * With real card payments the browser is no longer in charge: the client can
 * close the tab, and bank methods finish minutes later. So the webhook calls
 * these, and so does the mock provider, which settles immediately.
 *
 * Both are idempotent. Stripe retries events and can deliver the same one
 * twice; the status change is a conditional update, and everything after it
 * only runs for the caller that actually made the change — so points are never
 * awarded twice and stock is never released twice.
 */

/** Marks a pending order paid. Returns false when it was already settled. */
export async function completePaidOrder(db: TenantDb, orderId: string): Promise<{ completed: boolean; pointsEarned: number }> {
  const claimed = await db.order.updateMany({
    where: { id: orderId, status: "PENDING" },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (claimed.count === 0) return { completed: false, pointsEarned: 0 };

  const order = await db.order.findFirst({ where: { id: orderId }, include: { items: true } });
  if (!order) return { completed: false, pointsEarned: 0 };

  // Stock was taken when the order was placed; record the movements now the sale stands.
  for (const item of order.items) {
    if (item.itemType === "PRODUCT" && item.productId) {
      await db.inventoryTransaction.create({
        data: { productId: item.productId, type: "SALE", quantityChange: -item.quantity, reason: `Order ${order.orderNumber}` } as never,
      });
    }
  }

  const programme = await db.loyaltyProgramme.findFirst({ where: {} });
  let pointsEarned = 0;
  if (programme?.active) {
    pointsEarned = Math.floor(order.totalCents * programme.pointsPerCents);
    if (pointsEarned > 0) {
      await adjustLoyaltyPoints(db, {
        customerProfileId: order.customerProfileId,
        points: pointsEarned,
        type: "EARNED",
        reason: "Earned from purchase",
        relatedOrderId: order.id,
        expiresAt: programme.pointsExpiryDays ? new Date(Date.now() + programme.pointsExpiryDays * 86_400_000) : null,
      });
    }
  }

  // A booking paid by deposit is confirmed by the payment.
  await db.appointment.updateMany({ where: { orderId: order.id, status: "REQUESTED" }, data: { status: "CONFIRMED" } });

  await db.basket.updateMany({ where: { customerProfileId: order.customerProfileId, status: "OPEN" }, data: { status: "CONVERTED" } });

  await recordActivity(db, {
    type: "PURCHASE",
    customerProfileId: order.customerProfileId,
    summary: `Paid for order ${order.orderNumber}`,
    amountCents: order.totalCents,
  });

  return { completed: true, pointsEarned };
}

/**
 * Gives back everything a pending order was holding: redeemed points and the
 * stock it took. The basket is left OPEN so the client can try again.
 */
export async function releaseFailedOrder(db: TenantDb, orderId: string, reason: string): Promise<boolean> {
  const claimed = await db.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "FAILED" } });
  if (claimed.count === 0) return false;

  const order = await db.order.findFirst({ where: { id: orderId }, include: { items: true } });
  if (!order) return false;

  for (const item of order.items) {
    if (item.itemType === "PRODUCT" && item.productId) {
      await db.product.updateMany({ where: { id: item.productId }, data: { inventoryQuantity: { increment: item.quantity } } });
    }
  }
  if (order.loyaltyPointsRedeemed > 0) {
    await adjustLoyaltyPoints(db, {
      customerProfileId: order.customerProfileId,
      points: order.loyaltyPointsRedeemed,
      type: "REFUNDED",
      reason: `Order ${order.orderNumber} did not complete: ${reason}`,
      relatedOrderId: order.id,
    });
  }
  // An appointment held by this payment is not confirmed; it goes away.
  await db.appointment.updateMany({
    where: { orderId: order.id, status: "REQUESTED" },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Payment was not completed" },
  });
  return true;
}
