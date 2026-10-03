import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary, getRedeemableItems } from "@/lib/client-app-data";
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
  if (!ctx.customerProfileId) return null;

  const tab = sp.tab === "membership" || sp.tab === "settings" || sp.tab === "items" ? sp.tab : "treatments";

  const [summary, orders, appointments, items, billing] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId),
    ctx.db.order.findMany({
      // A refunded order belongs in the history too — it is the one a client
      // is most likely to go looking for.
      where: { customerProfileId: ctx.customerProfileId, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
      orderBy: { placedAt: "desc" },
      take: 20,
      include: {
        items: { select: { name: true } },
        payments: { select: { refunds: { where: { status: "SUCCEEDED" }, select: { amountCents: true, createdAt: true } } } },
      },
    }),
    ctx.db.appointment.findMany({
      where: { customerProfileId: ctx.customerProfileId },
      orderBy: { startAt: "desc" },
      take: 20,
      include: { service: { select: { id: true, name: true, durationMinutes: true } }, location: { select: { name: true } } },
    }),
    getRedeemableItems(ctx.db, ctx.customerProfileId),
    ctx.db.membershipBillingEvent.findMany({
      where: { customerMembership: { customerProfileId: ctx.customerProfileId } },
      orderBy: { occurredAt: "desc" },
      take: 12,
    }),
  ]);
  if (!summary) return null;

  const now = Date.now();

  return (
    <ProfileView
      merchantSlug={merchantSlug}
      merchantName={ctx.merchant.name}
      currency={ctx.merchant.currency}
      supportUrl={ctx.merchant.supportUrl}
      tab={tab}
      summary={summary}
      items={items}
      appVersion="1.0.0"
      appointments={appointments.map((a) => ({
        id: a.id,
        serviceId: a.service.id,
        serviceName: a.service.name,
        durationMinutes: a.service.durationMinutes,
        location: a.location.name,
        startAt: a.startAt.toISOString(),
        status: a.status,
        upcoming: a.startAt.getTime() > now && (a.status === "REQUESTED" || a.status === "CONFIRMED"),
      }))}
      orders={orders.map((o) => {
        const refunds = o.payments.flatMap((p) => p.refunds);
        const refundedCents = refunds.reduce((sum, r) => sum + r.amountCents, 0);
        const last = refunds.map((r) => r.createdAt).sort((a, b) => b.getTime() - a.getTime())[0];
        return {
          id: o.id,
          number: o.orderNumber,
          placedAt: o.placedAt.toISOString(),
          totalCents: o.totalCents,
          pointsEarned: Math.max(0, o.totalCents / 100),
          itemNames: o.items.map((i) => i.name),
          refundedCents,
          refundedAt: last ? last.toISOString() : null,
        };
      })}
      billing={billing.map((b) => ({
        id: b.id,
        description: b.description ?? b.type,
        amountCents: b.amountCents,
        occurredAt: b.occurredAt.toISOString(),
      }))}
    />
  );
}
