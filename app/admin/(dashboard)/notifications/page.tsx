import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";
import { BellRing } from "lucide-react";
import { NewCampaignForm, SendCampaignButton } from "./client";

export default async function AdminNotificationsPage() {
  await requirePermission("promotions.create");
  const { db } = await requireStaffContext();

  const [campaigns, tags] = await Promise.all([
    db.notificationCampaign.findMany({
      include: { _count: { select: { deliveries: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.customerTag.findMany({ orderBy: { name: "asc" } }),
  ]);

  const deliveryStats = await Promise.all(
    campaigns.map(async (c) => {
      const [delivered, failed, opened] = await Promise.all([
        db.notificationDelivery.count({ where: { campaignId: c.id, status: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED"] } } }),
        db.notificationDelivery.count({ where: { campaignId: c.id, status: "FAILED" } }),
        db.notificationDelivery.count({ where: { campaignId: c.id, status: { in: ["OPENED", "CLICKED"] } } }),
      ]);
      return { id: c.id, delivered, failed, opened };
    }),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Notification campaigns</h1>
        <NewCampaignForm tags={tags} />
      </div>

      {campaigns.length === 0 ? (
        <EmptyState icon={<BellRing className="h-6 w-6" />} title="No campaigns yet" />
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => {
            const stats = deliveryStats.find((s) => s.id === c.id)!;
            return (
              <Card key={c.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-ink-subtle">
                      {c.channel} · {c.segment} · {c.sentAt ? `sent ${formatDateTime(c.sentAt)}` : "not sent"}
                      {c.status === "SENT" && ` · ${stats.delivered} delivered, ${stats.opened} opened, ${stats.failed} failed`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={c.status === "SENT" ? "success" : "neutral"}>{c.status}</Badge>
                    {c.status === "DRAFT" && <SendCampaignButton campaignId={c.id} />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
