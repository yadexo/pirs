import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { requireCustomerContext } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";
import { Bell } from "lucide-react";
import { NotificationRow } from "./client";

export default async function NotificationsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db, user } = await requireCustomerContext();
  const notifications = await db.notification.findMany({
    where: { customerProfileId: user.customerProfileId! },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Notifications</h1>
      {notifications.length === 0 ? (
        <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications yet" />
      ) : (
        <Card>
          <CardContent className="p-0">
            {notifications.map((n) => (
              <NotificationRow
                key={n.id}
                id={n.id}
                title={n.title}
                body={n.body}
                createdAt={formatDateTime(n.createdAt)}
                read={!!n.readAt}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
