import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { DEFAULT_TIME_ZONE } from "@/lib/time-zone";
import { startOfDayIn } from "@/lib/zoned-time";

export interface ActivityItem {
  id: string;
  /** The client, or "A client" when their profile has since been removed. */
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
  /** Membership charges collected per day across the range. */
  mrrSeries: number[];
  revenueSources: { label: string; cents: number; color: string }[];
  appUserLtvCents: number;
  appUsers: number;
  /** Total clients at the end of each day in the range. */
  appUserSeries: number[];
  referrals: number;
  topClients: { name: string; totalCents: number }[];
  activity: ActivityItem[];
}

const RANGE_DAYS: Record<string, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

/**
 * Every figure here is read from stored rows — nothing is fabricated, and
 * nothing is copied across days to draw a trend that didn't happen. Days and
 * hours are the clinic's own, in its time zone, not the server's.
 */
export async function getHomeMetrics(db: TenantDb, range: string): Promise<HomeMetrics> {
  const days = RANGE_DAYS[range] ?? 7;
  const branding = await db.tenantBranding.findFirst({ where: {}, select: { currency: true, timeZone: true } });
  const timeZone = branding?.timeZone ?? DEFAULT_TIME_ZONE;

  const now = new Date();
  const todayStart = startOfDayIn(timeZone, now);
  const yesterdayStart = startOfDayIn(timeZone, new Date(todayStart.getTime() - DAY_MS / 2));
  const rangeStart = startOfDayIn(timeZone, new Date(todayStart.getTime() - (days - 1) * DAY_MS + DAY_MS / 2));

  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const localHour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" });
  // The range's local calendar dates, oldest first, for placing rows in day buckets.
  const dayKeys = Array.from({ length: days }, (_, i) => localDay.format(new Date(rangeStart.getTime() + i * DAY_MS + DAY_MS / 2)));
  const dayIndex = (d: Date) => dayKeys.indexOf(localDay.format(d));

  const [todayOrders, yesterdayAgg, rangeOrders, memberships, membershipCharges, customerCount, clientsBeforeRange, newClients, referrals, topClientRows, activityRows] =
    await Promise.all([
      db.order.findMany({ where: { status: "PAID", paidAt: { gte: todayStart } }, select: { totalCents: true, paidAt: true } }),
      db.order.aggregate({ where: { status: "PAID", paidAt: { gte: yesterdayStart, lt: todayStart } }, _sum: { totalCents: true } }),
      // Items are read through their orders. OrderItem has no tenant column, so
      // querying it directly would not be scoped to this clinic.
      db.order.findMany({
        where: { status: "PAID", paidAt: { gte: rangeStart } },
        select: { totalCents: true, paidAt: true, items: { select: { itemType: true, totalCents: true } } },
      }),
      db.customerMembership.findMany({
        where: { status: "ACTIVE" },
        select: { membershipPlan: { select: { priceCents: true, billingFrequency: true } } },
      }),
      db.membershipBillingEvent.findMany({
        where: { type: "CHARGE", occurredAt: { gte: rangeStart } },
        select: { amountCents: true, occurredAt: true },
      }),
      db.customerProfile.count(),
      db.customerProfile.count({ where: { createdAt: { lt: rangeStart } } }),
      db.customerProfile.findMany({ where: { createdAt: { gte: rangeStart } }, select: { createdAt: true } }),
      db.activityEvent.count({ where: { type: "REFERRAL", createdAt: { gte: rangeStart } } }),
      db.order.groupBy({
        by: ["customerProfileId"],
        where: { status: "PAID" },
        _sum: { totalCents: true },
        orderBy: { _sum: { totalCents: "desc" } },
        take: 5,
      }),
      db.activityEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { customerProfile: { select: { firstName: true, lastName: true } } },
      }),
    ]);

  const todayCents = todayOrders.reduce((s, o) => s + o.totalCents, 0);

  // 24 buckets for the Daily processing chart, by the clinic's local hour.
  const hourly = Array.from({ length: 24 }, () => 0);
  for (const o of todayOrders) {
    if (!o.paidAt) continue;
    const h = Number(localHour.format(o.paidAt)) % 24;
    hourly[h] = (hourly[h] ?? 0) + o.totalCents;
  }

  const series = Array.from({ length: days }, () => 0);
  for (const o of rangeOrders) {
    const i = o.paidAt ? dayIndex(o.paidAt) : -1;
    if (i >= 0) series[i] = (series[i] ?? 0) + o.totalCents;
  }

  const mrrSeries = Array.from({ length: days }, () => 0);
  for (const c of membershipCharges) {
    const i = dayIndex(c.occurredAt);
    if (i >= 0) mrrSeries[i] = (mrrSeries[i] ?? 0) + (c.amountCents ?? 0);
  }

  const appUserSeries: number[] = [];
  let running = clientsBeforeRange;
  const joinedPerDay = Array.from({ length: days }, () => 0);
  for (const c of newClients) {
    const i = dayIndex(c.createdAt);
    if (i >= 0) joinedPerDay[i] = (joinedPerDay[i] ?? 0) + 1;
  }
  for (const n of joinedPerDay) {
    running += n;
    appUserSeries.push(running);
  }

  const netRevenueCents = series.reduce((s, v) => s + v, 0);
  const mrrCents = memberships.reduce(
    (s, m) => s + (m.membershipPlan.billingFrequency === "ANNUAL" ? Math.round(m.membershipPlan.priceCents / 12) : m.membershipPlan.priceCents),
    0,
  );
  const itemCents = (...types: string[]) =>
    rangeOrders.reduce((sum, o) => sum + o.items.filter((i) => types.includes(i.itemType)).reduce((s, i) => s + i.totalCents, 0), 0);

  const clientIds = topClientRows.map((r) => r.customerProfileId);
  const clients = clientIds.length
    ? await db.customerProfile.findMany({ where: { id: { in: clientIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];

  return {
    currency: branding?.currency ?? DEFAULT_CURRENCY,
    todayCents,
    yesterdayCents: yesterdayAgg._sum.totalCents ?? 0,
    hourly,
    netRevenueCents,
    netRevenueSeries: series,
    mrrCents,
    mrrSeries,
    // What was actually sold in the range, by kind.
    revenueSources: [
      { label: "Memberships", cents: membershipCharges.reduce((s, c) => s + (c.amountCents ?? 0), 0) + itemCents("MEMBERSHIP"), color: "var(--accent-green)" },
      { label: "Custom plans", cents: itemCents("PACKAGE"), color: "var(--accent-red)" },
      { label: "Treatments", cents: itemCents("SERVICE"), color: "var(--accent-indigo)" },
      { label: "Products", cents: itemCents("PRODUCT"), color: "var(--accent-amber)" },
    ],
    appUserLtvCents: customerCount > 0 ? Math.round(netRevenueCents / customerCount) : 0,
    appUsers: customerCount,
    appUserSeries,
    referrals,
    topClients: topClientRows.map((r) => {
      const c = clients.find((x) => x.id === r.customerProfileId);
      return { name: c ? `${c.firstName} ${c.lastName}` : "Unknown", totalCents: r._sum.totalCents ?? 0 };
    }),
    activity: activityRows.map(toActivityItem),
  };
}

export function toActivityItem(a: { id: string; summary: string; createdAt: Date; customerProfile: { firstName: string; lastName: string } | null }): ActivityItem {
  return {
    id: a.id,
    actor: a.customerProfile ? `${a.customerProfile.firstName} ${a.customerProfile.lastName}`.trim() : "A client",
    event: a.summary,
    at: a.createdAt.toISOString(),
  };
}
