import { getClientAppContext } from "@/lib/client-app-context";
import { discountedUnitPrice, shopDiscountsFor } from "@/lib/discounts";
import { ShopView } from "./shop-view";

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantSlug: string }>;
  searchParams: Promise<{ tab?: string; category?: string; product?: string }>;
}) {
  const { merchantSlug } = await params;
  const sp = await searchParams;
  const ctx = await getClientAppContext(merchantSlug);
  if (!ctx.customerProfileId) return null;

  const tab = sp.tab === "memberships" || sp.tab === "treatments" ? sp.tab : "browse";

  // This client's own automatic discounts, including any personal one.
  const discounts = await shopDiscountsFor(ctx.merchant.id, ctx.customerProfileId);

  const [categories, products, services, plans, membership, programme, settings] = await Promise.all([
    ctx.db.productCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ctx.db.product.findMany({
      where: { active: true, ...(sp.category ? { categoryId: sp.category } : {}) },
      orderBy: { name: "asc" },
    }),
    ctx.db.service.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: { category: { select: { name: true } }, staff: { select: { staffProfileId: true }, take: 1 } },
    }),
    ctx.db.membershipPlan.findMany({
      where: { active: true },
      orderBy: { priceCents: "asc" },
      include: { benefits: { select: { description: true, service: { select: { name: true } } } } },
    }),
    ctx.db.customerMembership.findFirst({
      where: { customerProfileId: ctx.customerProfileId, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "PAUSED"] } },
      select: { membershipPlanId: true },
    }),
    ctx.db.loyaltyProgramme.findFirst({ where: {} }),
    ctx.db.tenantSettings.findFirst({ where: {} }),
  ]);

  return (
    <ShopView
      merchantSlug={merchantSlug}
      openProductId={sp.product ?? null}
      currency={ctx.merchant.currency}
      tab={tab}
      categoryId={sp.category ?? null}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      currentPlanId={membership?.membershipPlanId ?? null}
      pointsPerCents={programme?.active ? programme.pointsPerCents : 0}
      banner={{
        headline: settings?.shopBannerHeadline ?? null,
        subtitle: settings?.shopBannerSubtitle ?? null,
        buttonLabel: settings?.shopBannerButtonLabel ?? null,
      }}
      externalBookingUrl={settings?.bookingMode === "EXTERNAL" ? settings.externalBookingUrl : null}
      products={products.map((p) => {
        // The struck-through price comes from the same rules checkout uses, so
        // the shop cannot promise a discount the till won't give.
        const offer = discountedUnitPrice(
          { kind: "PRODUCT", id: p.id, categoryId: p.categoryId, unitPriceCents: p.priceCents, quantity: 1 },
          discounts,
        );
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          priceCents: p.priceCents,
          offerPriceCents: offer.promotionTitle ? offer.priceCents : null,
          offerTitle: offer.promotionTitle,
          images: Array.isArray(p.images) ? (p.images as string[]) : [],
          soldOut: p.inventoryQuantity <= 0,
          categoryId: p.categoryId,
        };
      })}
      services={services.map((s) => {
        const offer = discountedUnitPrice(
          { kind: "SERVICE", id: s.id, categoryId: s.categoryId, unitPriceCents: s.priceCents, quantity: 1 },
          discounts,
        );
        return {
        id: s.id,
        name: s.name,
        description: s.description,
        priceCents: s.priceCents,
        offerPriceCents: offer.promotionTitle ? offer.priceCents : null,
        offerTitle: offer.promotionTitle,
        durationMinutes: s.durationMinutes,
        images: s.imageUrl ? [s.imageUrl] : [],
        // Only bookable when the clinic has assigned a practitioner to it.
        bookable: s.staff.length > 0,
        categoryName: s.category.name,
        };
      })}
      plans={plans.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        priceCents: m.priceCents,
        interval: m.billingFrequency === "MONTHLY" ? "month" : "year",
        benefits: m.benefits.map((b) => b.service?.name ?? b.description),
      }))}
    />
  );
}
