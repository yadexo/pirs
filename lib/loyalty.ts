import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { rawDb } from "@/lib/db";

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

/** Thrown when a deduction would take a client's balance below zero. */
export class InsufficientPointsError extends Error {
  constructor() {
    super("Not enough points.");
    this.name = "InsufficientPointsError";
  }
}

/**
 * Adds (or, with a negative number, deducts) points and writes the ledger row,
 * atomically.
 *
 * The balance changes in one conditional UPDATE — never read, then written
 * back — so two awards at the same moment both count, and two redemptions
 * cannot both spend the same points: the second finds the balance too low and
 * throws InsufficientPointsError. The ledger row records the balance that
 * UPDATE produced, in the same transaction.
 */
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
): Promise<number> {
  if (!Number.isInteger(params.points)) throw new Error("Points must be a whole number.");
  // Resolved through the tenant-scoped client, so a profile from another clinic is "not found".
  const profile = await db.customerProfile.findFirst({ where: { id: params.customerProfileId }, select: { id: true, tenantId: true } });
  if (!profile) throw new Error("Customer not found.");

  return rawDb.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ balance: number }[]>`
      UPDATE "CustomerProfile"
      SET "loyaltyPointsBalance" = "loyaltyPointsBalance" + ${params.points}, "updatedAt" = NOW()
      WHERE "id" = ${profile.id} AND "tenantId" = ${profile.tenantId}
        AND "loyaltyPointsBalance" + ${params.points} >= 0
      RETURNING "loyaltyPointsBalance" AS balance
    `;
    if (rows.length === 0) throw new InsufficientPointsError();
    const balanceAfter = Number(rows[0]!.balance);

    await tx.loyaltyTransaction.create({
      data: {
        tenantId: profile.tenantId,
        customerProfileId: profile.id,
        type: params.type,
        points: params.points,
        balanceAfter,
        reason: params.reason,
        relatedOrderId: params.relatedOrderId,
        relatedRewardId: params.relatedRewardId,
        performedByStaffProfileId: params.performedByStaffProfileId,
        expiresAt: params.expiresAt ?? undefined,
      },
    });
    return balanceAfter;
  });
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
