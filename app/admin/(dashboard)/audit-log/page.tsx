import { requireStaffContext, requireRole } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";
import { ScrollText } from "lucide-react";

export default async function AdminAuditLogPage() {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();

  const entries = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actorUser: { include: { staffProfile: true } } },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Audit log</h1>

      {entries.length === 0 ? (
        <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No activity recorded yet" />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {entries.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{entry.action}</p>
                  <p className="text-xs text-ink-subtle">
                    {entry.entityType}
                    {entry.entityId ? ` · ${entry.entityId}` : ""}
                    {entry.actorUser?.staffProfile
                      ? ` · ${entry.actorUser.staffProfile.firstName} ${entry.actorUser.staffProfile.lastName}`
                      : entry.actorUser
                        ? ` · ${entry.actorUser.email}`
                        : ""}
                    {entry.reason ? ` · reason: ${entry.reason}` : ""}
                  </p>
                </div>
                <span className="text-xs text-ink-subtle">{formatDateTime(entry.createdAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
