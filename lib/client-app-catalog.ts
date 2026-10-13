import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { shopDiscountsFor, type DiscountCandidate } from "@/lib/discounts";
import { groupHistory, historyKey, type PricePoint } from "@/lib/price-history";
import { cardTag, isNew, popularIds, priceItem, POPULAR_WINDOW_DAYS, type CardTag, type PlanRates, type PricedItem } from "@/lib/merchandising";
import { packageSaving } from "@/lib/package-pricing";

/**
 * The clinic's catalogue as the client app shows it: one card per thing, with
 * the price this client pays, the member price they could have, the badge it
 * has earned and the 30-day reference price if there is one.
 *
 * Home and Shop both read it from here so a treatment cannot be €96 on one
 * screen and €120 on the other, and so "Popular" means the same thing in both
 * places. The prices come from the same resolver checkout uses.
 */

export interface ShopCard extends PricedItem {
  kind: "SERVICE" | "PRODUCT";
  id: string;
  name: string;
  description: string | null;
  /** Duration for a treatment, the clinic's own unit for a product. */
  meta: string | null;
  imageUrl: string | null;
  images: string[];
  categoryId: string | null;
  categoryName: string | null;
  durationMinutes: number | null;
  tag: CardTag | null;
  soldOut: boolean;
  /** True for a treatment the clinic can put in its calendar. */
  bookable: boolean;
  bookingUrl: string | null;
  popular: boolean;
}

/**
 * A session package as this viewer sees it: the price, what it works out at
 * per session, and what it saves *them* — which is less for a member, who
 * already pays the member price for a single session. Never stored; see
 * lib/package-pricing.ts.
 */
export interface PackageCard {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  sessions: number;
  /** Days from purchase, or null when it never expires. */
  expiryDays: number | null;
  transferable: boolean;
  perSessionCents: number;
  savingCents: number | null;
  /** True when the saving was measured against the cheapest of several. */
  savingAtLeast: boolean;
  /** The treatments a session can be spent on. */
  covers: { id: string; name: string; singlePriceCents: number; bookingUrl: string | null }[];
}

export interface Catalog {
  treatments: ShopCard[];
  products: ShopCard[];
  packages: PackageCard[];
  /** Treatments with the real top sellers first. */
  popularTreatments: ShopCard[];
  isMember: boolean;
  /** The plan being pitched to a non-member, if any is worth pitching. */
  pitchPlan: (PlanRates & { priceCents: number; interval: string; description: string | null }) | null;
  viewerCandidates: DiscountCandidate[];
}

const DAY = 86_400_000;

export const firstImage = (images: unknown): string | null => {
  if (!Array.isArray(images)) return null;
  const first = images.find((i) => typeof i === "string" && i.length > 0);
  return typeof first === "string" ? first : null;
};

const allImages = (images: unknown): string[] => (Array.isArray(images) ? images.filter((i): i is string => typeof i === "string" && i.length > 0) : []);

const metaLine = (durationMinutes: number | null, unitLabel: string | null): string | null =>
  durationMinutes ? `${durationMinutes} min` : (unitLabel ?? null);

export async function getCatalog(db: TenantDb, params: { tenantId: string; customerProfileId: string; now?: Date }): Promise<Catalog> {
  const now = params.now ?? new Date();
  const popularSince = new Date(now.getTime() - POPULAR_WINDOW_DAYS * DAY);

  const [profile, plans, services, products, paidItems, history, packages] = await Promise.all([
    db.customerProfile.findFirst({
      where: { id: params.customerProfileId },
      select: { memberships: { where: { status: { in: ["ACTIVE", "TRIAL"] } }, select: { id: true }, take: 1 } },
    }),
    db.membershipPlan.findMany({
      where: { active: true },
      orderBy: { priceCents: "asc" },
      select: { id: true, name: true, description: true, priceCents: true, billingFrequency: true, serviceDiscountPercent: true, productDiscountPercent: true },
    }),
    db.service.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, name: true, description: true, priceCents: true, durationMinutes: true, unitLabel: true,
        imageUrl: true, categoryId: true, createdAt: true, schedulingUrl: true,
        category: { select: { name: true } },
        staff: { select: { staffProfileId: true }, take: 1 },
      },
    }),
    db.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, description: true, priceCents: true, durationMinutes: true, unitLabel: true,
        images: true, categoryId: true, createdAt: true, inventoryQuantity: true, schedulingUrl: true,
        category: { select: { name: true } },
      },
    }),
    // Paid orders only: an abandoned basket is not a sale, and "Popular" is a
    // claim about what other clients actually bought.
    db.orderItem.findMany({
      where: { order: { status: "PAID", paidAt: { gte: popularSince } } },
      select: { serviceId: true, productId: true, quantity: true },
    }),
    // The whole history, not just the window: the price in force when the
    // window opened was set before it, and that row is part of the answer.
    // One row per price change per item, so a clinic's table stays small.
    db.priceHistory.findMany({
      orderBy: { recordedAt: "asc" },
      select: { itemType: true, serviceId: true, productId: true, priceCents: true, recordedAt: true },
    }),
    db.package.findMany({
      where: { active: true, archivedAt: null },
      orderBy: { priceCents: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        imageUrl: true,
        priceCents: true,
        totalUses: true,
        expiryDays: true,
        transferable: true,
        items: { select: { serviceId: true } },
      },
    }),
  ]);

  const isMember = (profile?.memberships.length ?? 0) > 0;
  const viewerCandidates = await shopDiscountsFor(params.tenantId, params.customerProfileId, now);

  // The plan to pitch: the cheapest that would actually discount something.
  const plan = isMember ? null : (plans.find((p) => (p.serviceDiscountPercent ?? 0) > 0 || (p.productDiscountPercent ?? 0) > 0) ?? null);
  const pitchPlan = plan
    ? {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        interval: plan.billingFrequency === "MONTHLY" ? "month" : "year",
        serviceDiscountPercent: plan.serviceDiscountPercent,
        productDiscountPercent: plan.productDiscountPercent,
      }
    : null;

  const sold = new Map<string, number>();
  for (const row of paidItems) {
    const key = row.serviceId ? `SERVICE:${row.serviceId}` : row.productId ? `PRODUCT:${row.productId}` : null;
    if (key) sold.set(key, (sold.get(key) ?? 0) + row.quantity);
  }
  const popular = popularIds(
    [...sold].map(([key, quantity]) => {
      const [kind, id] = key.split(":") as ["SERVICE" | "PRODUCT", string];
      return { kind, id, quantity };
    }),
  );

  const historyByItem = groupHistory(history);
  const priceFor = (kind: "SERVICE" | "PRODUCT", id: string, categoryId: string | null, priceCents: number): PricedItem =>
    priceItem(
      { kind, id, categoryId, priceCents },
      { viewerCandidates, pitchPlan, history: historyByItem.get(historyKey(kind, id)) ?? ([] as PricePoint[]), now },
    );

  const treatments: ShopCard[] = services.map((s) => {
    const priced = priceFor("SERVICE", s.id, s.categoryId, s.priceCents);
    const isPopular = popular.has(`SERVICE:${s.id}`);
    return {
      ...priced,
      kind: "SERVICE",
      id: s.id,
      name: s.name,
      description: s.description,
      meta: metaLine(s.durationMinutes, s.unitLabel),
      imageUrl: s.imageUrl,
      images: s.imageUrl ? [s.imageUrl] : [],
      categoryId: s.categoryId,
      categoryName: s.category.name,
      durationMinutes: s.durationMinutes,
      tag: cardTag({ offerLabel: priced.offerLabel, popular: isPopular, isNew: isNew(s.createdAt, now) }),
      soldOut: false,
      // Only bookable when the clinic has assigned a practitioner to it.
      bookable: s.staff.length > 0,
      bookingUrl: s.schedulingUrl,
      popular: isPopular,
    };
  });

  const products_: ShopCard[] = products.map((p) => {
    const priced = priceFor("PRODUCT", p.id, p.categoryId, p.priceCents);
    const isPopular = popular.has(`PRODUCT:${p.id}`);
    return {
      ...priced,
      kind: "PRODUCT",
      id: p.id,
      name: p.name,
      description: p.description,
      meta: metaLine(p.durationMinutes, p.unitLabel),
      imageUrl: firstImage(p.images),
      images: allImages(p.images),
      categoryId: p.categoryId,
      categoryName: p.category.name,
      durationMinutes: p.durationMinutes,
      tag: cardTag({ offerLabel: priced.offerLabel, popular: isPopular, isNew: isNew(p.createdAt, now) }),
      soldOut: p.inventoryQuantity <= 0,
      bookable: false,
      bookingUrl: p.schedulingUrl,
      popular: isPopular,
    };
  });

  // The row is called "Popular treatments", so a real top seller leads it; the
  // rest follow in the clinic's own order rather than the row standing empty
  // on a quiet month.
  const popularTreatments = [...treatments].sort((a, b) => Number(b.popular) - Number(a.popular));

  // The saving is worked out against what *this* viewer pays for one session,
  // so a member and a non-member looking at the same package see different
  // numbers — and sometimes the member sees none at all.
  const byId = new Map(treatments.map((t) => [t.id, t]));
  const packageCards: PackageCard[] = packages.map((pkg) => {
    const covers = pkg.items
      .map((i) => byId.get(i.serviceId))
      .filter((t): t is ShopCard => !!t)
      .map((t) => ({
        id: t.id,
        name: t.name,
        // What the viewer would pay for one of these today.
        singlePriceCents: t.memberPriceCents ?? t.viewerPriceCents,
        bookingUrl: t.bookingUrl,
      }));
    const saving = packageSaving({
      packagePriceCents: pkg.priceCents,
      sessions: pkg.totalUses,
      coveredSinglePricesCents: covers.map((c) => c.singlePriceCents),
    });
    return {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      imageUrl: pkg.imageUrl,
      priceCents: pkg.priceCents,
      sessions: pkg.totalUses,
      expiryDays: pkg.expiryDays,
      transferable: pkg.transferable,
      perSessionCents: saving.perSessionCents,
      savingCents: saving.savingCents,
      savingAtLeast: saving.atLeast,
      covers,
    };
  });

  return { treatments, products: products_, packages: packageCards, popularTreatments, isMember, pitchPlan, viewerCandidates };
}
