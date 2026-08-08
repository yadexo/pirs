import "server-only";
import type { TenantDb } from "@/lib/tenant-db";

/**
 * Awards loyalty points for a paid order, respecting the tenant's
 * configured earn rate and any excluded services/products. Writes an
 * auditable LoyaltyTransaction and updates the cached balance on
 * CustomerProfile. Safe to call even if the tenant has no loyalty
 * programme configured (no-op).
 */
export async function awardPointsForOrder(
  db: TenantDb,
  order: { id: string; customerProfileId: string; items: { serviceId: string | null; productId: string | null; totalCents: number }[] },
) {
  const programme = await db.loyaltyProgramme.findFirst({ where: {}, include: { exclusions: true } });
  if (!programme || !programme.active) return;

  const excludedServiceIds = new Set(programme.exclusions.filter((e) => e.serviceId).map((e) => e.serviceId));
  const excludedProductIds = new Set(programme.exclusions.filter((e) => e.productId).map((e) => e.productId));

  const eligibleSpend = order.items
    .filter((i) => !(i.serviceId && excludedServiceIds.has(i.serviceId)) && !(i.productId && excludedProductIds.has(i.productId)))
    .reduce((sum, i) => sum + i.totalCents, 0);

  const earnedFromSpend = Math.floor(eligibleSpend * programme.pointsPerCents);
  const points = earnedFromSpend + programme.pointsPerVisit;
  if (points <= 0) return;

  await adjustLoyaltyPoints(db, {
    customerProfileId: order.customerProfileId,
    points,
    type: "EARNED",
    reason: "Earned from purchase",
    relatedOrderId: order.id,
    expiresAt: programme.pointsExpiryDays
      ? new Date(Date.now() + programme.pointsExpiryDays * 24 * 60 * 60 * 1000)
      : null,
  });
}

export async function adjustLoyaltyPoints(
  db: TenantDb,
  params: {
    customerProfileId: string;
    points: number; // positive to add, negative to subtract
    type: "EARNED" | "REDEEMED" | "MANUAL_ADJUSTMENT" | "EXPIRED" | "REFUNDED";
    reason?: string;
    relatedOrderId?: string;
    relatedRewardId?: string;
    performedByStaffProfileId?: string;
    expiresAt?: Date | null;
  },
) {
  const profile = await db.customerProfile.findFirst({ where: { id: params.customerProfileId } });
  if (!profile) throw new Error("Customer not found.");

  const balanceAfter = profile.loyaltyPointsBalance + params.points;

  await db.$transaction([
    db.customerProfile.updateMany({
      where: { id: params.customerProfileId },
      data: { loyaltyPointsBalance: balanceAfter },
    }),
    db.loyaltyTransaction.create({
      data: {
        customerProfileId: params.customerProfileId,
        type: params.type,
        points: params.points,
        balanceAfter,
        reason: params.reason,
        relatedOrderId: params.relatedOrderId,
        relatedRewardId: params.relatedRewardId,
        performedByStaffProfileId: params.performedByStaffProfileId,
        expiresAt: params.expiresAt ?? undefined,
      } as never,
    }),
  ]);

  return balanceAfter;
}

export function rewardDiscountCents(
  reward: { rewardType: string; discountAmountCents: number | null; discountPercent: number | null },
  eligibleSubtotalCents: number,
) {
  if (reward.rewardType === "DISCOUNT_AMOUNT") return Math.min(reward.discountAmountCents ?? 0, eligibleSubtotalCents);
  if (reward.rewardType === "DISCOUNT_PERCENT") {
    return Math.round((eligibleSubtotalCents * (reward.discountPercent ?? 0)) / 100);
  }
  return 0; // FREE_SERVICE / FREE_PRODUCT handled separately at redemption time
}
