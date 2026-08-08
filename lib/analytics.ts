import "server-only";
import type { TenantDb } from "@/lib/tenant-db";

export interface DateRange {
  from: Date;
  to: Date;
}

export async function getDashboardMetrics(db: TenantDb, range: DateRange) {
  const { from, to } = range;

  const [
    revenueAgg,
    orderCount,
    membershipRevenueAgg,
    activeMemberships,
    newCustomers,
    customersWithOrders,
    loyaltyRedemptions,
    upcomingAppointments,
    appointmentStatusCounts,
    topServiceItems,
    topPackageItems,
    recentAudit,
  ] = await Promise.all([
    db.order.aggregate({ where: { status: "PAID", paidAt: { gte: from, lte: to } }, _sum: { totalCents: true } }),
    db.order.count({ where: { status: "PAID", paidAt: { gte: from, lte: to } } }),
    db.membershipBillingEvent.aggregate({
      where: { type: "CHARGE", occurredAt: { gte: from, lte: to } },
      _sum: { amountCents: true },
    }),
    db.customerMembership.count({ where: { status: "ACTIVE" } }),
    db.customerProfile.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.order.groupBy({ by: ["customerProfileId"], where: { status: "PAID" }, _count: { _all: true } }),
    db.loyaltyTransaction.count({ where: { type: "REDEEMED", createdAt: { gte: from, lte: to } } }),
    db.appointment.count({ where: { startAt: { gte: new Date() }, status: { in: ["REQUESTED", "CONFIRMED"] } } }),
    db.appointment.groupBy({ by: ["status"], where: { startAt: { gte: from, lte: to } }, _count: { _all: true } }),
    db.orderItem.groupBy({
      by: ["serviceId"],
      where: { serviceId: { not: null }, order: { status: "PAID", paidAt: { gte: from, lte: to } } },
      _sum: { totalCents: true, quantity: true },
      orderBy: { _sum: { totalCents: "desc" } },
      take: 5,
    }),
    db.orderItem.groupBy({
      by: ["packageId"],
      where: { packageId: { not: null }, order: { status: "PAID", paidAt: { gte: from, lte: to } } },
      _sum: { totalCents: true, quantity: true },
      orderBy: { _sum: { totalCents: "desc" } },
      take: 5,
    }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const returningCustomers = customersWithOrders.filter((c) => c._count._all > 1).length;

  const statusMap = Object.fromEntries(appointmentStatusCounts.map((s) => [s.status, s._count._all]));
  const completed = statusMap.COMPLETED ?? 0;
  const cancelled = statusMap.CANCELLED ?? 0;
  const noShow = statusMap.NO_SHOW ?? 0;
  const totalConcluded = completed + cancelled + noShow;
  const appointmentUtilization = totalConcluded > 0 ? completed / totalConcluded : 0;

  const serviceIds = topServiceItems.map((i) => i.serviceId).filter((id): id is string => !!id);
  const packageIds = topPackageItems.map((i) => i.packageId).filter((id): id is string => !!id);
  const [services, packages] = await Promise.all([
    db.service.findMany({ where: { id: { in: serviceIds } } }),
    db.package.findMany({ where: { id: { in: packageIds } } }),
  ]);

  return {
    revenueCents: revenueAgg._sum.totalCents ?? 0,
    orderCount,
    membershipRevenueCents: membershipRevenueAgg._sum.amountCents ?? 0,
    activeMemberships,
    newCustomers,
    returningCustomers,
    loyaltyRedemptions,
    upcomingAppointments,
    appointmentUtilization,
    topServices: topServiceItems.map((i) => ({
      name: services.find((s) => s.id === i.serviceId)?.name ?? "Unknown",
      revenueCents: i._sum.totalCents ?? 0,
      quantity: i._sum.quantity ?? 0,
    })),
    topPackages: topPackageItems.map((i) => ({
      name: packages.find((p) => p.id === i.packageId)?.name ?? "Unknown",
      revenueCents: i._sum.totalCents ?? 0,
      quantity: i._sum.quantity ?? 0,
    })),
    recentActivity: recentAudit,
  };
}

export async function getAnalyticsOverview(db: TenantDb, range: DateRange) {
  const { from, to } = range;

  const [
    revenueByCategory,
    aovAgg,
    membershipStatusCounts,
    promotionRedemptions,
    appointmentStatusCounts,
    totalOrders,
    totalCustomers,
    repeatCustomers,
  ] = await Promise.all([
    db.orderItem.groupBy({
      by: ["itemType"],
      where: { order: { status: "PAID", paidAt: { gte: from, lte: to } } },
      _sum: { totalCents: true },
    }),
    db.order.aggregate({ where: { status: "PAID", paidAt: { gte: from, lte: to } }, _avg: { totalCents: true } }),
    db.customerMembership.groupBy({ by: ["status"], _count: { _all: true } }),
    db.promotionRedemption.count({ where: { redeemedAt: { gte: from, lte: to } } }),
    db.appointment.groupBy({ by: ["status"], where: { startAt: { gte: from, lte: to } }, _count: { _all: true } }),
    db.order.count({ where: { status: "PAID" } }),
    db.customerProfile.count(),
    db.order.groupBy({ by: ["customerProfileId"], where: { status: "PAID" }, _count: { _all: true } }),
  ]);

  const activeMembers = membershipStatusCounts.find((s) => s.status === "ACTIVE")?._count._all ?? 0;
  const totalEverMembers = membershipStatusCounts.reduce((sum, s) => sum + s._count._all, 0);
  const cancelledMembers = membershipStatusCounts.find((s) => s.status === "CANCELLED")?._count._all ?? 0;
  const membershipRetention = totalEverMembers > 0 ? activeMembers / totalEverMembers : 0;

  const apptStatusMap = Object.fromEntries(appointmentStatusCounts.map((s) => [s.status, s._count._all]));
  const apptCompleted = apptStatusMap.COMPLETED ?? 0;
  const apptCancelled = apptStatusMap.CANCELLED ?? 0;
  const apptTotal = Object.values(apptStatusMap).reduce((a: number, b) => a + (b as number), 0);

  const repeatCount = repeatCustomers.filter((c) => c._count._all > 1).length;

  const loyaltyParticipants = await db.loyaltyTransaction.groupBy({ by: ["customerProfileId"], _count: { _all: true } });

  return {
    revenueByCategory: revenueByCategory.map((r) => ({ type: r.itemType, revenueCents: r._sum.totalCents ?? 0 })),
    averageOrderValueCents: Math.round(aovAgg._avg.totalCents ?? 0),
    membershipRetention,
    cancelledMembers,
    promotionRedemptions,
    appointmentCompletionRate: apptTotal > 0 ? apptCompleted / apptTotal : 0,
    appointmentCancellationRate: apptTotal > 0 ? apptCancelled / apptTotal : 0,
    repeatPurchaseRate: totalCustomers > 0 ? repeatCount / totalCustomers : 0,
    loyaltyParticipationRate: totalCustomers > 0 ? loyaltyParticipants.length / totalCustomers : 0,
    totalOrders,
    totalCustomers,
  };
}
