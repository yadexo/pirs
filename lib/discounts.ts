import type { DiscountType, PrismaClient } from "@prisma/client";
import { rawDb } from "@/lib/db";

/**
 * Which discount a client actually gets, decided here and nowhere else.
 *
 * The browser is never asked. It sends a basket of ids and quantities; prices,
 * eligibility and the discount are all read from the database on the server,
 * and the same function runs again when the PaymentIntent is created. A client
 * who edits a price in devtools changes nothing but their own screen.
 *
 * A clinic's own POS keeps its code-based promotions (lib/actions/checkout.ts).
 * This is the automatic kind: no code to type, applied because the client and
 * the basket qualify.
 *
 * No "server-only" here so the shop can import the pure helpers for display.
 */

export interface BasketLine {
  /** What kind of thing it is, matching the catalogue tables. */
  kind: "PRODUCT" | "SERVICE";
  id: string;
  categoryId: string | null;
  unitPriceCents: number;
  quantity: number;
}

export interface DiscountCandidate {
  id: string;
  title: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderCents: number | null;
  perCustomerLimit: number | null;
  usageLimit: number | null;
  /** Empty means the whole shop. */
  eligibility: {
    productId: string | null;
    serviceId: string | null;
    productCategoryId: string | null;
    serviceCategoryId: string | null;
  }[];
}

export interface AppliedDiscount {
  promotionId: string;
  title: string;
  /** What comes off the subtotal, in cents. Never more than the basket. */
  discountCents: number;
  /** The lines it applied to — for showing "20% off" on the right rows. */
  lineIds: string[];
}

/** Everything in the basket, before any discount, in cents. */
export function subtotalOf(lines: BasketLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

/** Whether one basket line is covered by a promotion's eligibility rules. */
export function lineQualifies(line: BasketLine, candidate: DiscountCandidate): boolean {
  // No rows at all: the promotion covers the whole shop.
  if (candidate.eligibility.length === 0) return true;
  return candidate.eligibility.some((rule) => {
    if (line.kind === "PRODUCT") {
      if (rule.productId) return rule.productId === line.id;
      if (rule.productCategoryId) return rule.productCategoryId === line.categoryId;
      return false;
    }
    if (rule.serviceId) return rule.serviceId === line.id;
    if (rule.serviceCategoryId) return rule.serviceCategoryId === line.categoryId;
    return false;
  });
}

/**
 * What one promotion is worth on this basket.
 *
 * A percentage applies to the qualifying lines only. A fixed amount is capped
 * at those lines' value, so a €30 discount on a €20 qualifying product takes
 * €20 and not the price of everything else in the basket.
 */
export function discountFor(lines: BasketLine[], candidate: DiscountCandidate): AppliedDiscount | null {
  const qualifying = lines.filter((line) => lineQualifies(line, candidate));
  if (qualifying.length === 0) return null;

  const qualifyingCents = subtotalOf(qualifying);
  if (qualifyingCents <= 0) return null;

  // The minimum is about the whole basket, not the qualifying part: it is a
  // "spend this much" rule, and the client sees the basket total.
  if (candidate.minOrderCents && subtotalOf(lines) < candidate.minOrderCents) return null;

  const raw =
    candidate.discountType === "PERCENT"
      ? Math.round((qualifyingCents * candidate.discountValue) / 100)
      : candidate.discountValue;

  const discountCents = Math.max(0, Math.min(raw, qualifyingCents));
  if (discountCents === 0) return null;

  return {
    promotionId: candidate.id,
    title: candidate.title,
    discountCents,
    lineIds: qualifying.map((l) => l.id),
  };
}

/** The best of several, so a client is never quietly given the smaller one. */
export function bestDiscount(lines: BasketLine[], candidates: DiscountCandidate[]): AppliedDiscount | null {
  let best: AppliedDiscount | null = null;
  for (const candidate of candidates) {
    const applied = discountFor(lines, candidate);
    if (applied && (!best || applied.discountCents > best.discountCents)) best = applied;
  }
  return best;
}

type Db = Pick<PrismaClient, "promotion" | "promotionRedemption">;

/**
 * The automatic promotions this client could use right now: running today,
 * active, meant for everyone or for them personally, and not already used as
 * often as they are allowed to.
 */
export async function candidatesFor(
  tenantId: string,
  customerProfileId: string,
  now: Date = new Date(),
  db: Db = rawDb as Db,
): Promise<DiscountCandidate[]> {
  const promotions = await db.promotion.findMany({
    where: {
      tenantId,
      active: true,
      autoApply: true,
      startAt: { lte: now },
      endAt: { gte: now },
      // Everyone's, or this client's own — never another client's.
      OR: [{ customerProfileId: null }, { customerProfileId }],
    },
    select: {
      id: true,
      title: true,
      discountType: true,
      discountValue: true,
      minOrderCents: true,
      perCustomerLimit: true,
      usageLimit: true,
      customerProfileId: true,
      eligibility: { select: { productId: true, serviceId: true, productCategoryId: true, serviceCategoryId: true } },
    },
  });
  if (promotions.length === 0) return [];

  // One query for the counts rather than one per promotion.
  const ids = promotions.map((p) => p.id);
  const [mine, all] = await Promise.all([
    db.promotionRedemption.groupBy({ by: ["promotionId"], where: { promotionId: { in: ids }, customerProfileId }, _count: { _all: true } }),
    db.promotionRedemption.groupBy({ by: ["promotionId"], where: { promotionId: { in: ids } }, _count: { _all: true } }),
  ]);
  const usedByMe = new Map(mine.map((r) => [r.promotionId, r._count._all]));
  const usedByAll = new Map(all.map((r) => [r.promotionId, r._count._all]));

  return promotions.filter((p) => {
    if (p.perCustomerLimit != null && (usedByMe.get(p.id) ?? 0) >= p.perCustomerLimit) return false;
    if (p.usageLimit != null && (usedByAll.get(p.id) ?? 0) >= p.usageLimit) return false;
    return true;
  });
}

/**
 * The discount to apply to this basket, straight from the database.
 *
 * This is what checkout calls, and what the PaymentIntent amount is built
 * from. Returns null when nothing applies, which is the common case.
 */
export async function resolveDiscount(
  params: { tenantId: string; customerProfileId: string; lines: BasketLine[]; now?: Date },
  db: Db = rawDb as Db,
): Promise<AppliedDiscount | null> {
  if (params.lines.length === 0) return null;
  const candidates = await candidatesFor(params.tenantId, params.customerProfileId, params.now ?? new Date(), db);
  return bestDiscount(params.lines, candidates);
}

/**
 * The promotions worth showing on the shop, so a price can be struck through
 * before anything is in the basket. Eligibility only — no basket minimum is
 * judged here, because there is no basket yet.
 */
export async function shopDiscountsFor(
  tenantId: string,
  customerProfileId: string,
  now: Date = new Date(),
  db: Db = rawDb as Db,
): Promise<DiscountCandidate[]> {
  return candidatesFor(tenantId, customerProfileId, now, db);
}

/** The price a client actually sees for one item, given the promotions on it. */
export function discountedUnitPrice(line: BasketLine, candidates: DiscountCandidate[]): { priceCents: number; promotionTitle: string | null } {
  const single: BasketLine = { ...line, quantity: 1 };
  let best: { priceCents: number; promotionTitle: string | null } = { priceCents: line.unitPriceCents, promotionTitle: null };

  for (const candidate of candidates) {
    if (!lineQualifies(single, candidate)) continue;
    // A basket minimum can't be judged from one product page; those promotions
    // still apply at checkout, they just aren't advertised on the price.
    if (candidate.minOrderCents) continue;
    const applied = discountFor([single], candidate);
    if (!applied) continue;
    const priceCents = Math.max(0, line.unitPriceCents - applied.discountCents);
    if (priceCents < best.priceCents) best = { priceCents, promotionTitle: candidate.title };
  }
  return best;
}
