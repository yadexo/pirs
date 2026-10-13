import { getClientAppContext } from "@/lib/client-app-context";
import { getCatalog } from "@/lib/client-app-catalog";
import { clinicPaymentMode } from "@/lib/stripe-payments";
import { MEMBERSHIP_HOLDS_SLOT } from "@/lib/membership-status";
import { ShopView } from "./shop-view";

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantSlug: string }>;
  searchParams: Promise<{ tab?: string; category?: string; product?: string; kind?: string; membership?: string }>;
}) {
  const { merchantSlug } = await params;
  const sp = await searchParams;
  const ctx = await getClientAppContext(merchantSlug);
  if (!ctx.customerProfileId) return null;

  // ?membership=1 is where a bank redirect comes back to after a first
  // membership payment, so that client lands on their plan rather than on the
  // shop front with nothing to show what just happened.
  const tab = sp.membership ? "memberships" : sp.tab === "memberships" || sp.tab === "treatments" ? sp.tab : "browse";

  // One read for both prices on every card: what this client pays, and what
  // they would pay as a member. Same resolver the till uses.
  const catalog = await getCatalog(ctx.db, { tenantId: ctx.merchant.id, customerProfileId: ctx.customerProfileId });

  const [categories, plans, membership, programme, settings] = await Promise.all([
    ctx.db.productCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ctx.db.membershipPlan.findMany({
      where: { active: true },
      orderBy: { priceCents: "asc" },
      include: { benefits: { select: { description: true, service: { select: { name: true } } } } },
    }),
    ctx.db.customerMembership.findFirst({
      where: { customerProfileId: ctx.customerProfileId, status: { in: [...MEMBERSHIP_HOLDS_SLOT] } },
      select: { membershipPlanId: true, status: true },
    }),
    ctx.db.loyaltyProgramme.findFirst({ where: {} }),
    ctx.db.tenantSettings.findFirst({ where: {} }),
  ]);

  // Whether this clinic can bill a recurring plan at all.
  const billable = (await clinicPaymentMode(ctx.merchant.id)).mode !== "blocked";

  // The categories a client can filter by: the product ones the clinic set up,
  // plus the treatment categories, so one chip row covers the whole shop.
  const treatmentCategories = [...new Map(catalog.treatments.filter((t) => t.categoryId).map((t) => [t.categoryId!, t.categoryName!])).entries()].map(
    ([id, name]) => ({ id, name }),
  );

  return (
    <ShopView
      merchantSlug={merchantSlug}
      merchantName={ctx.merchant.name}
      openProductId={sp.product ?? null}
      currency={ctx.merchant.currency}
      tab={tab}
      categoryId={sp.category ?? null}
      categories={[...categories.map((c) => ({ id: c.id, name: c.name })), ...treatmentCategories]}
      treatments={catalog.treatments}
      packages={catalog.packages}
      popularTreatments={catalog.popularTreatments}
      products={catalog.products}
      isMember={catalog.isMember}
      pitchPlan={catalog.pitchPlan}
      currentPlanId={membership?.membershipPlanId ?? null}
      pointsPerCents={programme?.active ? programme.pointsPerCents : 0}
      externalBookingUrl={settings?.bookingMode === "EXTERNAL" ? settings.externalBookingUrl : null}
      // A plan is a promise to bill somebody every month. A clinic that cannot
      // take a payment cannot keep that promise, so its plans are not shown at
      // all rather than offered and then refused at the last step.
      plans={
        billable
          ? plans.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description,
              priceCents: m.priceCents,
              interval: m.billingFrequency === "MONTHLY" ? "month" : "year",
              benefits: m.benefits.map((b) => b.service?.name ?? b.description),
            }))
          : []
      }
      membershipPending={membership?.status === "PENDING"}
    />
  );
}
