import Link from "next/link";
import { requirePlatformContext } from "@/lib/rbac";
import { rawDb } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function PlatformOverviewPage() {
  await requirePlatformContext();

  const [totalTenants, activeTenants, suspendedTenants, trialTenants, recentTenants] = await Promise.all([
    rawDb.tenant.count(),
    rawDb.tenant.count({ where: { status: "ACTIVE" } }),
    rawDb.tenant.count({ where: { status: "SUSPENDED" } }),
    rawDb.tenant.count({ where: { subscriptionStatus: "TRIAL" } }),
    rawDb.tenant.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { branding: true } }),
  ]);

  const stats = [
    { label: "Total tenants", value: totalTenants },
    { label: "Active", value: activeTenants },
    { label: "Suspended", value: suspendedTenants },
    { label: "On trial", value: trialTenants },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Platform overview</h1>
        <Link href="/platform/tenants" className="text-sm text-brand-primary hover:underline">
          Manage tenants
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-ink-muted">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recently created tenants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentTenants.length === 0 && <p className="text-sm text-ink-muted">No tenants yet.</p>}
          {recentTenants.map((t) => (
            <Link
              key={t.id}
              href={`/platform/tenants/${t.id}`}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:bg-surface-subtle"
            >
              <div>
                <p className="font-medium">{t.branding?.businessName ?? t.name}</p>
                <p className="text-xs text-ink-subtle">/{t.slug} · created {formatDate(t.createdAt)}</p>
              </div>
              <Badge tone={t.status === "ACTIVE" ? "success" : "danger"}>{t.status}</Badge>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
