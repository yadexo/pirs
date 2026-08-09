import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary } from "@/lib/client-app-data";
import { ProfileView } from "./profile-view";

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantSlug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { merchantSlug } = await params;
  const sp = await searchParams;
  const ctx = await getClientAppContext(merchantSlug);
  const tab = sp.tab === "membership" || sp.tab === "settings" ? sp.tab : "treatments";

  const [summary, orders, appointments, billing] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId!),
    ctx.db.order.findMany({
      where: { customerProfileId: ctx.customerProfileId!, status: "PAID" },
      orderBy: { placedAt: "desc" },
      take: 20,
      include: { items: { select: { name: true } } },
    }),
    ctx.db.appointment.findMany({
      where: { customerProfileId: ctx.customerProfileId! },
      orderBy: { startAt: "desc" },
      take: 20,
      include: { service: { select: { name: true } }, location: { select: { name: true } } },
    }),
    ctx.db.membershipBillingEvent.findMany({
      where: { customerMembership: { customerProfileId: ctx.customerProfileId! } },
      orderBy: { occurredAt: "desc" },
      take: 12,
    }),
  ]);

  return (
    <ProfileView
      merchantSlug={merchantSlug}
      currency={ctx.merchant.currency}
      tab={tab}
      summary={summary}
      appointments={appointments.map((a) => ({
        id: a.id,
        name: a.service.name,
        location: a.location.name,
        startAt: a.startAt.toISOString(),
        status: a.status,
      }))}
      orders={orders.map((o) => ({
        id: o.id,
        number: o.orderNumber,
        placedAt: o.placedAt.toISOString(),
        totalCents: o.totalCents,
        itemNames: o.items.map((i) => i.name),
      }))}
      billing={billing.map((b) => ({
        id: b.id,
        description: b.description ?? b.type,
        amountCents: b.amountCents,
        occurredAt: b.occurredAt.toISOString(),
      }))}
    />
  );
}
