import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { getCatalog, firstImage, type ShopCard } from "@/lib/client-app-catalog";

/**
 * Everything the Home screen shows, read in one place.
 *
 * Each section comes back empty when it has nothing to say, and the screen
 * renders only what is filled — a clinic with no offers, no plan and no
 * rewards gets a short page rather than a page of empty cards. The order the
 * sections go in is decided by homeOrder below, because it differs for a
 * client who has never bought anything.
 */

export type { ShopCard };

export interface HomeSections {
  /** Clinic header. */
  coverImageUrl: string | null;
  address: string | null;
  /** Wallet strip. */
  creditCents: number;
  points: number;
  membershipLabel: string;
  /** Featured offers: running now, for everyone. */
  offers: { id: string; title: string; scope: string | null; endsAt: string; imageUrl: string | null; discountLabel: string | null }[];
  /** Just for you: this client's own offer, if the clinic gave them one. */
  personalOffer: { id: string; title: string; scope: string | null; endsAt: string } | null;
  itemsToRedeem: number;
  /** Points progress towards the next reward they cannot yet afford. */
  nextReward: { name: string; pointsCost: number; pointsToGo: number } | null;
  popularTreatments: ShopCard[];
  products: ShopCard[];
  /** Membership pitch, hidden for members. */
  membershipPitch: { planId: string; name: string; priceCents: number; interval: string; blurb: string | null; savingCents: number | null } | null;
  /** Buy again: what this client has bought before. */
  buyAgain: { kind: "SERVICE" | "PRODUCT"; id: string; name: string; imageUrl: string | null; lastBoughtAt: string; lastPaidCents: number; bookingUrl: string | null }[];
  /** False for a client with no paid order yet — changes the section order. */
  returning: boolean;
}

/** How many cards a Home shelf carries before "See all" is the only way on. */
const SHELF = 10;

export async function getHomeSections(
  db: TenantDb,
  params: { tenantId: string; customerProfileId: string; now?: Date },
): Promise<HomeSections> {
  const now = params.now ?? new Date();

  const [catalog, branding, location, profile, promotions, items, rewards, paidOrders, pastItems] = await Promise.all([
    getCatalog(db, params),
    db.tenantBranding.findFirst({ where: {}, select: { coverImageUrl: true, addressLine1: true, city: true, postalCode: true } }),
    db.location.findFirst({ where: { active: true }, orderBy: { isPrimary: "desc" }, select: { addressLine1: true, city: true, postalCode: true } }),
    db.customerProfile.findFirst({
      where: { id: params.customerProfileId },
      select: {
        loyaltyPointsBalance: true,
        accountCreditBalanceCents: true,
        memberships: { where: { status: { in: ["ACTIVE", "TRIAL"] } }, select: { membershipPlan: { select: { name: true } } }, take: 1 },
      },
    }),
    db.promotion.findMany({
      where: { active: true, startAt: { lte: now }, endAt: { gte: now }, OR: [{ customerProfileId: null }, { customerProfileId: params.customerProfileId }] },
      orderBy: { endAt: "asc" },
      take: 12,
      select: { id: true, title: true, description: true, endAt: true, imageUrl: true, discountType: true, discountValue: true, customerProfileId: true },
    }),
    db.redeemableItem.count({ where: { customerProfileId: params.customerProfileId, status: "AVAILABLE" } }),
    db.loyaltyReward.findMany({ where: { active: true }, orderBy: { pointsCost: "asc" }, select: { name: true, pointsCost: true } }),
    db.order.count({ where: { customerProfileId: params.customerProfileId, status: "PAID" } }),
    db.orderItem.findMany({
      where: { order: { customerProfileId: params.customerProfileId, status: "PAID" } },
      orderBy: { order: { paidAt: "desc" } },
      take: 40,
      select: { serviceId: true, productId: true, name: true, unitPriceCents: true, order: { select: { paidAt: true } } },
    }),
  ]);

  const points = profile?.loyaltyPointsBalance ?? 0;
  const nextRewardRow = rewards.find((r) => r.pointsCost > points) ?? null;
  const personal = promotions.find((p) => p.customerProfileId === params.customerProfileId) ?? null;

  // What this client has bought and could buy again, newest first — and only
  // things the clinic still sells, because a Buy again button for a withdrawn
  // treatment would fail at the cart.
  const byId = new Map([...catalog.treatments, ...catalog.products].map((c) => [c.id, c]));
  const seen = new Set<string>();
  const buyAgain: HomeSections["buyAgain"] = [];
  for (const row of pastItems) {
    const id = row.serviceId ?? row.productId;
    if (!id || seen.has(id)) continue;
    const live = byId.get(id);
    if (!live) continue;
    seen.add(id);
    buyAgain.push({
      kind: live.kind,
      id,
      name: live.name,
      imageUrl: live.imageUrl ?? firstImage(live.images),
      lastBoughtAt: (row.order.paidAt ?? now).toISOString(),
      lastPaidCents: row.unitPriceCents,
      bookingUrl: live.bookingUrl,
    });
    if (buyAgain.length >= 6) break;
  }

  const address =
    [location?.addressLine1, location?.city, location?.postalCode].filter(Boolean).join(", ") ||
    [branding?.addressLine1, branding?.city, branding?.postalCode].filter(Boolean).join(", ") ||
    null;

  const pitch = catalog.pitchPlan;

  return {
    coverImageUrl: branding?.coverImageUrl ?? null,
    address,
    creditCents: profile?.accountCreditBalanceCents ?? 0,
    points,
    membershipLabel: profile?.memberships[0]?.membershipPlan.name ?? "NOT A MEMBER",
    offers: promotions
      .filter((p) => p.customerProfileId === null)
      .map((p) => ({
        id: p.id,
        title: p.title,
        scope: p.description,
        endsAt: p.endAt.toISOString(),
        imageUrl: p.imageUrl,
        discountLabel: p.discountType === "PERCENT" ? `−${p.discountValue}%` : null,
      })),
    personalOffer: personal ? { id: personal.id, title: personal.title, scope: personal.description, endsAt: personal.endAt.toISOString() } : null,
    itemsToRedeem: items,
    nextReward: nextRewardRow ? { name: nextRewardRow.name, pointsCost: nextRewardRow.pointsCost, pointsToGo: nextRewardRow.pointsCost - points } : null,
    popularTreatments: catalog.popularTreatments.slice(0, SHELF),
    products: catalog.products.slice(0, SHELF),
    membershipPitch: pitch
      ? {
          planId: pitch.id,
          name: pitch.name,
          priceCents: pitch.priceCents,
          interval: pitch.interval,
          blurb: pitch.description,
          // What the plan would have saved them on what they have already
          // bought — a number from their own history, not a brochure claim.
          savingCents:
            buyAgain.reduce((sum, row) => {
              const rate = row.kind === "SERVICE" ? (pitch.serviceDiscountPercent ?? 0) : (pitch.productDiscountPercent ?? 0);
              return sum + Math.round((row.lastPaidCents * rate) / 100);
            }, 0) || null,
        }
      : null,
    buyAgain,
    returning: paidOrders > 0,
  };
}
