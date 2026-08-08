import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { getAnalyticsOverview } from "@/lib/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export default async function AdminAnalyticsPage() {
  await requirePermission("analytics.view");
  const { db } = await requireStaffContext();

  const to = new Date();
  const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  const data = await getAnalyticsOverview(db, { from, to });

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const cards = [
    { label: "Average order value", value: formatMoney(data.averageOrderValueCents) },
    { label: "Repeat-purchase rate", value: pct(data.repeatPurchaseRate) },
    { label: "Membership retention", value: pct(data.membershipRetention) },
    { label: "Loyalty participation", value: pct(data.loyaltyParticipationRate) },
    { label: "Promotion redemptions (90d)", value: data.promotionRedemptions },
    { label: "Appointment completion rate", value: pct(data.appointmentCompletionRate) },
    { label: "Appointment cancellation rate", value: pct(data.appointmentCancellationRate) },
    { label: "Total paid orders", value: data.totalOrders },
    { label: "Total customers", value: data.totalCustomers },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Analytics</h1>
        <p className="text-sm text-ink-muted">Last 90 days, computed from stored order, appointment, and membership data.</p>
      </div>
      <Badge tone="info">Figures reflect actual recorded activity for this tenant, including any demo seed data.</Badge>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-xs text-ink-muted">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by category</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {data.revenueByCategory.length === 0 ? (
            <p className="text-ink-muted">No revenue recorded yet.</p>
          ) : (
            data.revenueByCategory.map((r) => (
              <div key={r.type} className="flex justify-between">
                <span>{r.type}</span>
                <span className="font-medium">{formatMoney(r.revenueCents)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
