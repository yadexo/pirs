/**
 * The badges and the two prices a shop card shows.
 *
 * Both of the things here are claims about the world, so both are measured
 * rather than set by hand: "Popular" means clients actually bought it, and
 * "Members pay €X" is the price a member would really be charged, resolved by
 * the same code the till uses. A clinic cannot tick a box to call something
 * popular, because a client reading the word would be entitled to believe it.
 */

import type { DiscountCandidate } from "@/lib/discounts";
import { discountedUnitPrice, membershipCandidates } from "@/lib/discounts";
import { referencePrice, type PricePoint } from "@/lib/price-history";

/** How far back "popular" and "new" look. */
export const POPULAR_WINDOW_DAYS = 30;
export const NEW_WINDOW_DAYS = 30;
/** Below this, "top seller" is noise rather than a signal. */
export const POPULAR_MIN_SOLD = 3;
/** At most this many items in a clinic's shop carry the badge. */
export const POPULAR_MAX_ITEMS = 5;

export interface SoldCount {
  kind: "SERVICE" | "PRODUCT";
  id: string;
  quantity: number;
}

/**
 * The items worth calling popular: the best sellers of the last 30 days, by
 * paid orders only. A handful at most — if everything is popular the word
 * stops meaning anything, and the design puts one badge on a card.
 */
export function popularIds(sold: SoldCount[], limit = POPULAR_MAX_ITEMS, minSold = POPULAR_MIN_SOLD): Set<string> {
  return new Set(
    [...sold]
      .filter((s) => s.quantity >= minSold)
      .sort((a, b) => b.quantity - a.quantity || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((s) => `${s.kind}:${s.id}`),
  );
}

export function isNew(createdAt: Date, now: Date = new Date(), windowDays = NEW_WINDOW_DAYS): boolean {
  return now.getTime() - createdAt.getTime() <= windowDays * 86_400_000;
}

export type CardTag = { kind: "brand"; label: string } | { kind: "photo"; label: string };

/**
 * One tag per card, and this is the order.
 *
 * A live discount beats everything, because it is the only one that changes
 * what the client pays. "Popular" beats "New" because a thing can be both and
 * the stronger claim is the one somebody else already bought.
 */
export function cardTag(input: { offerLabel?: string | null; popular?: boolean; isNew?: boolean }): CardTag | null {
  if (input.offerLabel) return { kind: "brand", label: input.offerLabel };
  if (input.popular) return { kind: "photo", label: "Popular" };
  if (input.isNew) return { kind: "photo", label: "New" };
  return null;
}

/**
 * The short label for a discount: "20% off" when the promotion is a straight
 * percentage, otherwise the promotion's own title, which the clinic wrote.
 */
export function offerLabel(listCents: number, payingCents: number, title: string | null): string | null {
  if (!title || payingCents >= listCents) return null;
  const percent = Math.round(((listCents - payingCents) / listCents) * 100);
  // Only when it lands on a whole, believable percentage — "23% off" from a
  // rounding artefact reads as a trick.
  return percent > 0 && percent % 5 === 0 ? `${percent}% off` : title;
}

export interface PricedItem {
  /** List price, before anything. */
  priceCents: number;
  /** What this viewer pays — member price for a member, offer price otherwise. */
  viewerPriceCents: number;
  /** The 30-day low to strike through, or null. See lib/price-history.ts. */
  wasCents: number | null;
  /** For a non-member: what they would pay as a member. Null for members. */
  memberPriceCents: number | null;
  /** The label for a live discount on this item, if any. */
  offerLabel: string | null;
}

export interface PlanRates {
  id: string;
  name: string;
  serviceDiscountPercent: number | null;
  productDiscountPercent: number | null;
}

/**
 * Both prices for one item.
 *
 * The viewer's price comes from the discount resolver, so the shop can never
 * promise something checkout will not honour. The member price is the same
 * question asked of a plan the client has not joined: what would this cost if
 * they had. It is left null for members, who are already seeing it, and for
 * anyone the plan would not actually save money.
 */
export function priceItem(
  item: { kind: "SERVICE" | "PRODUCT"; id: string; categoryId: string | null; priceCents: number; createdAt?: Date },
  options: {
    viewerCandidates: DiscountCandidate[];
    /** The plan to pitch; omitted or null for members. */
    pitchPlan?: PlanRates | null;
    history?: PricePoint[];
    now?: Date;
  },
): PricedItem {
  const line = { kind: item.kind === "SERVICE" ? ("SERVICE" as const) : ("PRODUCT" as const), id: item.id, categoryId: item.categoryId, unitPriceCents: item.priceCents, quantity: 1 };

  const viewer = discountedUnitPrice(line, options.viewerCandidates);
  const label = offerLabel(item.priceCents, viewer.priceCents, viewer.promotionTitle);

  let memberPriceCents: number | null = null;
  if (options.pitchPlan) {
    // The plan competes with the promotions the client already has, exactly as
    // it would at the till — so a 20% offer beats a 10% plan and the pitch
    // honestly disappears rather than quoting a worse price as a saving.
    const asMember = discountedUnitPrice(line, [
      ...options.viewerCandidates,
      ...membershipCandidates({ membershipPlan: options.pitchPlan }),
    ]);
    if (asMember.priceCents < viewer.priceCents) memberPriceCents = asMember.priceCents;
  }

  return {
    priceCents: item.priceCents,
    viewerPriceCents: viewer.priceCents,
    wasCents: referencePrice(options.history ?? [], viewer.priceCents, options.now),
    memberPriceCents,
    offerLabel: label,
  };
}
