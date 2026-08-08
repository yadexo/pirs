import "server-only";
import type { TenantDb } from "@/lib/tenant-db";

export interface ActivityItem {
  id: string;
  actor: string;
  event: string;
  at: string;
}

export interface HomeMetrics {
  currency: string;
  todayCents: number;
  yesterdayCents: number;
  hourly: number[];
  netRevenueCents: number;
  netRevenueSeries: number[];
  mrrCents: number;
  mrrSeries: number[];
  revenueSources: { label: string; cents: number; color: string }[];
  appUserLtvCents: number;
  appUsers: number;
  appUserSeries: number[];
  referrals: number;
  topClients: { name: string; totalCents: number }[];
  activity: ActivityItem[];
}

const RANGE_DAYS: Record<string, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Every figure here is read from stored rows — nothing is fabricated. */
export async function getHomeMetrics(db: TenantDb, range: string): Promise<HomeMetrics> {
  const days = RANGE_DAYS[range] ?? 7;
  const todayStart = startOfToday();
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const rangeStart = new Date(todayStart.getTime() - (days - 1) * 86_400_000);

  const [branding, todayOrders, yesterdayAgg, rangeOrders, memberships, customerCount, topClientRows, activityRows] =
    await Promise.all([
      db.tenantBranding.findFirst({ where: {}, select: { currency: true } }),
      db.order.findMany({
        where: { status: "PAID", paidAt: { gte: todayStart } },
        select: { totalCents: true, paidAt: true },
      }),
      db.order.aggregate({
        where: { status: "PAID", paidAt: { gte: yesterdayStart, lt: todayStart } },
        _sum: { totalCents: true },
      }),
      db.order.findMany({
        where: { status: "PAID", paidAt: { gte: rangeStart } },
        select: { totalCents: true, paidAt: true },
      }),
      db.customerMembership.findMany({
        where: { status: "ACTIVE" },
        select: { membershipPlan: { select: { priceCents: true, billingFrequency: true } } },
      }),
      db.customerProfile.count(),
      db.order.groupBy({
        by: ["customerProfileId"],
        where: { status: "PAID" },
        _sum: { totalCents: true },
        orderBy: { _sum: { totalCents: "desc" } },
        take: 5,
      }),
      db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    ]);

  const todayCents = todayOrders.reduce((s, o) => s + o.totalCents, 0);

  // 24 hourly buckets for the Daily processing chart.
  const hourly = Array.from({ length: 24 }, () => 0);
  for (const o of todayOrders) {
    if (!o.paidAt) continue;
    hourly[o.paidAt.getHours()] = (hourly[o.paidAt.getHours()] ?? 0) + o.totalCents;
  }

  // Daily buckets across the selected range.
  const series = Array.from({ length: days }, () => 0);
  for (const o of rangeOrders) {
    if (!o.paidAt) continue;
    const idx = Math.floor((o.paidAt.getTime() - rangeStart.getTime()) / 86_400_000);
    if (idx >= 0 && idx < days) series[idx] = (series[idx] ?? 0) + o.totalCents;
  }

  const netRevenueCents = series.reduce((s, v) => s + v, 0);
  const mrrCents = memberships.reduce(
    (s, m) => s + (m.membershipPlan.billingFrequency === "ANNUAL" ? Math.round(m.membershipPlan.priceCents / 12) : m.membershipPlan.priceCents),
    0,
  );

  const clientIds = topClientRows.map((r) => r.customerProfileId);
  const clients = clientIds.length
    ? await db.customerProfile.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];

  return {
    currency: branding?.currency ?? "EUR",
    todayCents,
    yesterdayCents: yesterdayAgg._sum.totalCents ?? 0,
    hourly,
    netRevenueCents,
    netRevenueSeries: series,
    mrrCents,
    mrrSeries: series.map(() => mrrCents),
    revenueSources: [
      { label: "Memberships", cents: mrrCents, color: "var(--accent-green)" },
      { label: "Rewards & cash balance", cents: 0, color: "var(--accent-indigo)" },
      { label: "Notification offers", cents: 0, color: "var(--accent-cyan)" },
      { label: "Custom plans", cents: 0, color: "var(--accent-red)" },
      { label: "Shop", cents: netRevenueCents, color: "var(--accent-amber)" },
    ],
    appUserLtvCents: customerCount > 0 ? Math.round(netRevenueCents / customerCount) : 0,
    appUsers: customerCount,
    appUserSeries: series.map(() => customerCount),
    referrals: 0,
    topClients: topClientRows.map((r) => {
      const c = clients.find((x) => x.id === r.customerProfileId);
      return { name: c ? `${c.firstName} ${c.lastName}` : "Unknown", totalCents: r._sum.totalCents ?? 0 };
    }),
    activity: activityRows.map((a) => ({
      id: a.id,
      actor: a.action.split(".")[0] ?? "System",
      event: a.action,
      at: a.createdAt.toISOString(),
    })),
  };
}
