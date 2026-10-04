import type { TenantDb } from "@/lib/tenant-db";

/**
 * Typed promotion codes, and whether a client may still use one.
 *
 * This is the clinic's own counter: a receptionist types the code a client
 * brings in. It is separate from lib/discounts.ts, which decides the automatic
 * discounts the client app applies by itself without anyone typing anything.
 *
 * It lives here, as a plain function over a tenant-scoped client, rather than
 * in a server action — there is no counter screen yet, and a `"use server"`
 * export would be a live endpoint for a feature nobody can see. The rules are
 * the part worth keeping and testing; the screen can come later.
 */

export function findPromoByCode(db: TenantDb, code: string) {
  return db.promotion.findFirst({
    where: { code, active: true, startAt: { lte: new Date() }, endAt: { gte: new Date() } },
    include: { eligibility: true },
  });
}

export type PromoWithEligibility = NonNullable<Awaited<ReturnType<typeof findPromoByCode>>>;

/**
 * The promotion behind a code, or why this client can't use it. Both limits
 * are counted from PromotionRedemption rows, which are written when an order
 * is paid for — not when a basket merely had the code on it.
 */
export async function resolvePromotion(
  db: TenantDb,
  code: string,
  customerProfileId: string,
): Promise<{ error: string } | { promo: PromoWithEligibility }> {
  const promo = await findPromoByCode(db, code);
  if (!promo) return { error: "This promo code is not valid or has expired." };

  if (promo.usageLimit != null) {
    const used = await db.promotionRedemption.count({ where: { promotionId: promo.id } });
    if (used >= promo.usageLimit) return { error: "This promo code has reached its usage limit." };
  }
  if (promo.perCustomerLimit != null) {
    const used = await db.promotionRedemption.count({ where: { promotionId: promo.id, customerProfileId } });
    if (used >= promo.perCustomerLimit) return { error: "You've already used this promo code." };
  }
  return { promo };
}
