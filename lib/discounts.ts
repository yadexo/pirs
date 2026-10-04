import type { DiscountType, PrismaClient } from "@prisma/client";
import { rawDb } from "@/lib/db";
import { membershipGivesBenefits } from "@/lib/membership-status";

/**
 * Which discount a client actually gets, decided here and nowhere else.
 *
 * The browser is never asked. It sends a basket of ids and quantities; prices,
 * eligibility and the discount are all read from the database on the server,
 * and the same function runs again when the PaymentIntent is created. A client
 * who edits a price in devtools changes nothing but their own screen.
 *
 * A clinic's own counter keeps its code-based promotions (lib/promo-codes.ts).
 * This is the automatic kind: no code to type, applied because the client and
 * the basket qualify — which includes being a member, since a plan's discount
 * is exactly that. A membership is just another candidate here, so the member
 * price a client sees in the shop and the one the till charges come from one
 * calculation and cannot disagree.
 *
 * They never stack. A client gets whichever single discount is worth most to
 * them on a given line — see bestDiscount.
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
  /**
   * A membership's benefit rather than a promotion. There is nothing to
   * redeem, so no PromotionRedemption is written and no usage limit applies:
   * it is a benefit of paying for the plan, available every time.
   */
  source?: "PROMOTION" | "MEMBERSHIP";
  /**
   * Narrows the candidate to products or to services, which is how a plan's
   * two rates are expressed ("10% off treatments, 5% off products"). A
   * promotion leaves it unset and uses eligibility rows instead.
   */
  appliesToKind?: "PRODUCT" | "SERVICE";
}

export interface AppliedDiscount {
  /** Null for a membership's own discount: there is no promotion behind it. */
  promotionId: string | null;
  source: "PROMOTION" | "MEMBERSHIP";
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
  // A plan's rate for treatments says nothing about the shelf, and vice versa.
  if (candidate.appliesToKind && candidate.appliesToKind !== line.kind) return false;
  // No rows at all: the candidate covers the whole shop (of that kind).
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

  const source = candidate.source ?? "PROMOTION";
  return {
    promotionId: source === "MEMBERSHIP" ? null : candidate.id,
    source,
    title: candidate.title,
    discountCents,
    lineIds: qualifying.map((l) => l.id),
  };
}

/**
 * The best of several, so a client is never quietly given the smaller one.
 *
 * This is also where "no stacking" lives: a member whose basket a promotion
 * also covers gets the larger of the two, not both. Ties go to whichever came
 * first, which is a coin toss nobody can feel — the client pays the same.
 */
export function bestDiscount(lines: BasketLine[], candidates: DiscountCandidate[]): AppliedDiscount | null {
  let best: AppliedDiscount | null = null;
  for (const candidate of candidates) {
    const applied = discountFor(lines, candidate);
    if (applied && (!best || applied.discountCents > best.discountCents)) best = applied;
  }
  return best;
}

type Db = Pick<PrismaClient, "promotion" | "promotionRedemption" | "customerMembership">;

/**
 * A plan's own discounts as candidates — one for treatments, one for the
 * shelf, whichever the plan sets.
 *
 * Pure, so the shop and the till both get them from the same place, and they
 * compete with promotions in bestDiscount rather than adding to them.
 */
export function membershipCandidates(membership: {
  membershipPlan: { id: string; name: string; serviceDiscountPercent: number | null; productDiscountPercent: number | null } | null;
}): DiscountCandidate[] {
  const plan = membership.membershipPlan;
  if (!plan) return [];

  const shared = {
    discountType: "PERCENT" as DiscountType,
    minOrderCents: null,
    // A benefit of paying for the plan, not a coupon: no limits, every time.
    perCustomerLimit: null,
    usageLimit: null,
    eligibility: [],
    source: "MEMBERSHIP" as const,
  };

  const out: DiscountCandidate[] = [];
  if (plan.serviceDiscountPercent && plan.serviceDiscountPercent > 0) {
    out.push({
      ...shared,
      id: `membership:${plan.id}:service`,
      title: `${plan.name} member price`,
      discountValue: plan.serviceDiscountPercent,
      appliesToKind: "SERVICE",
    });
  }
  if (plan.productDiscountPercent && plan.productDiscountPercent > 0) {
    out.push({
      ...shared,
      id: `membership:${plan.id}:product`,
      title: `${plan.name} member price`,
      discountValue: plan.productDiscountPercent,
      appliesToKind: "PRODUCT",
    });
  }
  return out;
}

/**
 * The plan discounts this client is entitled to right now.
 *
 * "Right now" is the point: a membership waiting for its first payment gives
 * nothing, and one whose payment failed keeps its benefits only through the
 * grace period — see lib/membership-status.ts. The query asks for the statuses
 * that can give benefits and the helper decides the borderline one, so a
 * member who stopped paying stops getting member prices on the day they
 * should.
 */
export async function memberCandidatesFor(
  tenantId: string,
  customerProfileId: string,
  now: Date = new Date(),
  db: Db = rawDb as Db,
): Promise<DiscountCandidate[]> {
  const membership = await db.customerMembership.findFirst({
    where: { tenantId, customerProfileId, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE"] } },
    orderBy: { startedAt: "desc" },
    select: {
      status: true,
      pastDueSince: true,
      membershipPlan: { select: { id: true, name: true, serviceDiscountPercent: true, productDiscountPercent: true } },
    },
  });
  if (!membership || !membershipGivesBenefits(membership, now)) return [];
  return membershipCandidates(membership);
}

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
 * from. Promotions and the client's plan compete here; the client gets the
 * better one. Returns null when nothing applies, which is the common case.
 */
export async function resolveDiscount(
  params: { tenantId: string; customerProfileId: string; lines: BasketLine[]; now?: Date },
  db: Db = rawDb as Db,
): Promise<AppliedDiscount | null> {
  if (params.lines.length === 0) return null;
  const now = params.now ?? new Date();
  const [promotions, member] = await Promise.all([
    candidatesFor(params.tenantId, params.customerProfileId, now, db),
    memberCandidatesFor(params.tenantId, params.customerProfileId, now, db),
  ]);
  return bestDiscount(params.lines, [...promotions, ...member]);
}

/**
 * The discounts worth showing on the shop, so a price can be struck through
 * before anything is in the basket — the client's plan included, because a
 * member should see the member price while they are deciding. Eligibility
 * only: no basket minimum is judged here, because there is no basket yet.
 */
export async function shopDiscountsFor(
  tenantId: string,
  customerProfileId: string,
  now: Date = new Date(),
  db: Db = rawDb as Db,
): Promise<DiscountCandidate[]> {
  const [promotions, member] = await Promise.all([
    candidatesFor(tenantId, customerProfileId, now, db),
    memberCandidatesFor(tenantId, customerProfileId, now, db),
  ]);
  return [...promotions, ...member];
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
