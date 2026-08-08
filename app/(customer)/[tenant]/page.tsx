import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getTenantBySlug } from "@/lib/tenant";
import { getTenantDb } from "@/lib/tenant-db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { Sparkles, CalendarDays, Gift, Tag } from "lucide-react";

export default async function CustomerHomePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const session = await auth();
  const isCustomer = session?.user.role === "CUSTOMER" && session.user.tenantSlug === tenantSlug;
  const db = getTenantDb(tenant.id);

  const [featuredServices, activePromotions, membershipPlan] = await Promise.all([
    db.service.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, take: 4 }),
    db.promotion.findMany({
      where: { active: true, startAt: { lte: new Date() }, endAt: { gte: new Date() } },
      take: 3,
      orderBy: { createdAt: "desc" },
    }),
    db.membershipPlan.findFirst({ where: { active: true }, orderBy: { priceCents: "asc" } }),
  ]);

  function fetchUpcomingAppointment(customerProfileId: string) {
    return db.appointment.findFirst({
      where: { customerProfileId, startAt: { gte: new Date() }, status: { in: ["REQUESTED", "CONFIRMED"] } },
      orderBy: { startAt: "asc" },
      include: { service: true, staffProfile: true },
    });
  }

  let loyaltyBalance: number | null = null;
  let upcomingAppointment: Awaited<ReturnType<typeof fetchUpcomingAppointment>> = null;
  let customerProfile: { firstName: string; loyaltyPointsBalance: number } | null = null;

  if (isCustomer && session?.user.customerProfileId) {
    const cpId = session.user.customerProfileId;
    [customerProfile, upcomingAppointment] = await Promise.all([
      db.customerProfile.findFirst({ where: { id: cpId }, select: { firstName: true, loyaltyPointsBalance: true } }),
      fetchUpcomingAppointment(cpId),
    ]);
    loyaltyBalance = customerProfile?.loyaltyPointsBalance ?? 0;
  }

  const businessName = tenant.branding?.businessName ?? tenant.name;

  return (
    <div className="space-y-6 pb-4">
      <section className="rounded-xl bg-brand-primary p-5 text-brand-primary-foreground">
        <p className="text-sm opacity-90">Welcome{customerProfile ? `, ${customerProfile.firstName}` : ""}</p>
        <h1 className="mt-1 text-xl font-semibold">{businessName}</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/${tenantSlug}/services`} className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25">
            Browse services
          </Link>
          <Link href={`/${tenantSlug}/appointments`} className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25">
            Book an appointment
          </Link>
        </div>
      </section>

      {isCustomer && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Gift className="h-5 w-5 text-brand-primary" />
              <div>
                <p className="text-xs text-ink-muted">Loyalty balance</p>
                <p className="font-semibold">{loyaltyBalance ?? 0} pts</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="mb-1 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-brand-primary" />
                <p className="text-xs text-ink-muted">Next appointment</p>
              </div>
              {upcomingAppointment ? (
                <Link href={`/${tenantSlug}/appointments`} className="text-sm font-medium hover:underline">
                  {upcomingAppointment.service.name} · {formatDateTime(upcomingAppointment.startAt)}
                </Link>
              ) : (
                <p className="text-sm text-ink-subtle">None scheduled</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activePromotions.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Tag className="h-4 w-4" /> Active promotions
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {activePromotions.map((promo) => (
              <Card key={promo.id}>
                <CardContent className="p-4">
                  <Badge tone="brand">{promo.discountType === "PERCENT" ? `${promo.discountValue}% off` : formatMoney(promo.discountValue)}</Badge>
                  <p className="mt-2 text-sm font-medium">{promo.title}</p>
                  {promo.description && <p className="mt-1 text-xs text-ink-muted line-clamp-2">{promo.description}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {membershipPlan && (
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-brand-accent" /> Become a member
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-sm text-ink-muted">{membershipPlan.name}</p>
                <p className="font-semibold">
                  {formatMoney(membershipPlan.priceCents)} / {membershipPlan.billingFrequency === "MONTHLY" ? "mo" : "yr"}
                </p>
              </div>
              <Link href={`/${tenantSlug}/memberships`} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-subtle">
                View plans
              </Link>
            </CardContent>
          </Card>
        </section>
      )}

      {featuredServices.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Featured services</h2>
            <Link href={`/${tenantSlug}/services`} className="text-sm text-brand-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {featuredServices.map((service) => (
              <Link key={service.id} href={`/${tenantSlug}/services/${service.id}`}>
                <Card className="transition-shadow hover:shadow-raised">
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm font-medium">{service.name}</p>
                      <p className="text-xs text-ink-muted">{service.durationMinutes} min</p>
                    </div>
                    <p className="font-semibold">{formatMoney(service.priceCents)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
