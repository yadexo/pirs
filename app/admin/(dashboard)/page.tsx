import Link from "next/link";
import { requireStaffContext } from "@/lib/rbac";
import { getDashboardMetrics } from "@/lib/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";

const RANGES: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { user, db } = await requireStaffContext();
  const { range = "30d" } = await searchParams;
  const days = RANGES[range] ?? 30;

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const metrics = await getDashboardMetrics(db, { from, to });

  const stats = [
    { label: "Revenue", value: formatMoney(metrics.revenueCents) },
    { label: "Orders", value: metrics.orderCount },
    { label: "Membership revenue", value: formatMoney(metrics.membershipRevenueCents) },
    { label: "Active memberships", value: metrics.activeMemberships },
    { label: "New customers", value: metrics.newCustomers },
    { label: "Returning customers", value: metrics.returningCustomers },
    { label: "Loyalty redemptions", value: metrics.loyaltyRedemptions },
    { label: "Upcoming appointments", value: metrics.upcomingAppointments },
    { label: "Appointment completion", value: `${Math.round(metrics.appointmentUtilization * 100)}%` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-sm text-ink-muted">Welcome back, {user.name.split(" ")[0]}.</p>
        </div>
        <div className="flex gap-1.5">
          {Object.keys(RANGES).map((r) => (
            <Link
              key={r}
              href={`/admin?range=${r}`}
              className={`rounded-md border px-3 py-1.5 text-sm ${range === r ? "border-brand-primary bg-brand-primary/10 text-brand-primary" : "border-border text-ink-muted"}`}
            >
              {r}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-ink-muted">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top-selling services</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {metrics.topServices.length === 0 ? (
              <p className="text-ink-muted">No sales in this period.</p>
            ) : (
              metrics.topServices.map((s, i) => (
                <div key={i} className="flex justify-between">
                  <span>{s.name}</span>
                  <span className="text-ink-muted">{formatMoney(s.revenueCents)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top-selling packages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {metrics.topPackages.length === 0 ? (
              <p className="text-ink-muted">No package sales in this period.</p>
            ) : (
              metrics.topPackages.map((p, i) => (
                <div key={i} className="flex justify-between">
                  <span>{p.name}</span>
                  <span className="text-ink-muted">{formatMoney(p.revenueCents)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.recentActivity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <div className="space-y-2">
              {metrics.recentActivity.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between border-b border-border py-1.5 text-sm last:border-0">
                  <span>{entry.action}</span>
                  <span className="text-ink-subtle">{formatDateTime(entry.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
