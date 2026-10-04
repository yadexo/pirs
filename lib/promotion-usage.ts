/**
 * Why deleting an offer sometimes hides it instead.
 *
 * An offer that has already been applied to an order is part of that order's
 * history: the discount on the receipt came from somewhere, and the campaign
 * that announced it says what it announced. The database would let it go —
 * those links are nullable — and the clinic would be left with orders showing
 * a discount from nothing. So an offer anybody has used is deactivated rather
 * than deleted, and it disappears from the client app either way.
 *
 * The clinic is told which it was, in the same words before and after, which
 * is why the sentence lives here rather than in the button that prints it.
 */

export interface PromotionUsage {
  /** Orders this offer was applied to, paid or not. */
  orders: number;
  /** Times it was actually spent, counted for its per-client limits. */
  redemptions: number;
  /** Notifications that announced it. */
  campaigns: number;
}

export const NO_USAGE: PromotionUsage = { orders: 0, redemptions: 0, campaigns: 0 };

/** Whether anything would lose its history if this offer were deleted. */
export function isPromotionUsed(usage: PromotionUsage): boolean {
  return usage.orders > 0 || usage.redemptions > 0 || usage.campaigns > 0;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What to tell the clinic, or null when the offer can simply be deleted.
 *
 * Orders come first because that is the reason they will care about: the
 * receipt a client could still ask about. Campaigns alone are a weaker reason
 * but the same one — a notification whose offer vanished explains nothing.
 */
export function whyHidden(usage: PromotionUsage): string | null {
  if (!isPromotionUsed(usage)) return null;

  if (usage.orders > 0) {
    return `This offer was used in ${plural(usage.orders, "order")}, so it's hidden instead of deleted to keep your order history correct.`;
  }
  if (usage.redemptions > 0) {
    return `This offer was used ${plural(usage.redemptions, "time")}, so it's hidden instead of deleted to keep your records correct.`;
  }
  return `This offer was announced in ${plural(usage.campaigns, "notification")}, so it's hidden instead of deleted to keep that message history correct.`;
}

/** The same thing in advance, for the confirmation step. */
export function warnBeforeDelete(usage: PromotionUsage): string | null {
  const why = whyHidden(usage);
  return why === null ? null : `${why} It stops showing in the client app either way.`;
}
