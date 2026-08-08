import { notFound } from "next/navigation";
import { requirePlatformContext } from "@/lib/rbac";
import { rawDb } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { TenantActionsPanel } from "./actions-panel";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformContext();
  const { id } = await params;

  const tenant = await rawDb.tenant.findUnique({
    where: { id },
    include: {
      branding: true,
      _count: { select: { customerProfiles: true, staffProfiles: true, orders: true, appointments: true } },
    },
  });
  if (!tenant) notFound();

  const [admins, recentAudit] = await Promise.all([
    rawDb.user.findMany({ where: { tenantId: tenant.id, role: "TENANT_ADMIN" }, include: { staffProfile: true } }),
    rawDb.auditLog.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tenant.branding?.businessName ?? tenant.name}</h1>
          <p className="text-sm text-ink-subtle">/{tenant.slug}</p>
        </div>
        <div className="flex gap-1.5">
          <Badge tone={tenant.status === "ACTIVE" ? "success" : "danger"}>{tenant.status}</Badge>
          <Badge tone="neutral">{tenant.subscriptionStatus}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenant status</CardTitle>
        </CardHeader>
        <CardContent>
          <TenantActionsPanel tenantId={tenant.id} status={tenant.status} subscriptionStatus={tenant.subscriptionStatus} />
          {tenant.suspendedReason && (
            <p className="mt-2 text-sm text-ink-muted">Suspension reason: {tenant.suspendedReason}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Customers", value: tenant._count.customerProfiles },
          { label: "Staff", value: tenant._count.staffProfiles },
          { label: "Orders", value: tenant._count.orders },
          { label: "Appointments", value: tenant._count.appointments },
        ].map((s) => (
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
          <CardTitle>Support contacts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {admins.map((a) => (
            <p key={a.id} className="text-sm">
              {a.staffProfile ? `${a.staffProfile.firstName} ${a.staffProfile.lastName}` : a.email} · {a.email}
            </p>
          ))}
          {admins.length === 0 && <p className="text-sm text-ink-muted">No tenant admin on record.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentAudit.length === 0 && <p className="text-sm text-ink-muted">No recorded activity yet.</p>}
          {recentAudit.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
              <span>{entry.action}</span>
              <span className="text-ink-subtle">{formatDateTime(entry.createdAt)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
