import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary } from "@/lib/client-app-data";
import { ShopView } from "./shop-view";

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantSlug: string }>;
  searchParams: Promise<{ tab?: string; category?: string }>;
}) {
  const { merchantSlug } = await params;
  const sp = await searchParams;
  const ctx = await getClientAppContext(merchantSlug);
  // The layout renders onboarding when logged out, but Next renders page
  // and layout in parallel — so this page must guard independently.
  if (!ctx.customerProfileId) return null;
  const tab = sp.tab === "memberships" || sp.tab === "treatments" ? sp.tab : "browse";

  const [summary, categories, products, services, plans] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId),
    ctx.db.productCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ctx.db.product.findMany({
      where: { active: true, ...(sp.category ? { categoryId: sp.category } : {}) },
      orderBy: { name: "asc" },
      include: { category: { select: { id: true, name: true } } },
    }),
    ctx.db.service.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    ctx.db.membershipPlan.findMany({
      where: { active: true },
      orderBy: { priceCents: "asc" },
      include: { benefits: { select: { id: true, description: true } } },
    }),
  ]);

  const activeCategory = categories.find((c) => c.id === sp.category) ?? null;

  return (
    <ShopView
      merchantSlug={merchantSlug}
      currency={ctx.merchant.currency}
      tab={tab}
      activeCategoryId={sp.category ?? null}
      activeCategoryName={activeCategory?.name ?? null}
      currentPlanName={summary?.membershipPlanName ?? null}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        imageUrl: Array.isArray(p.images) ? ((p.images as string[])[0] ?? null) : null,
        soldOut: p.inventoryQuantity <= 0,
      }))}
      services={services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        priceCents: s.priceCents,
        durationMinutes: s.durationMinutes,
        imageUrl: s.imageUrl,
      }))}
      plans={plans.map((m) => ({
        id: m.id,
        name: m.name,
        priceCents: m.priceCents,
        interval: m.billingFrequency === "MONTHLY" ? "month" : "year",
        benefits: m.benefits.map((b) => b.description),
      }))}
    />
  );
}
