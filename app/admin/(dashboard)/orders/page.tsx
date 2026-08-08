import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { Receipt } from "lucide-react";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  PAID: "success",
  PENDING: "warning",
  FAILED: "danger",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
  CANCELLED: "neutral",
};

export default async function AdminOrdersPage() {
  await requirePermission("sales.manage");
  const { db } = await requireStaffContext();

  const orders = await db.order.findMany({
    orderBy: { placedAt: "desc" },
    take: 100,
    include: { customerProfile: true, items: true },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Orders</h1>
      {orders.length === 0 ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title="No orders yet" />
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">{order.orderNumber}</p>
                  <p className="text-xs text-ink-subtle">
                    {order.customerProfile.firstName} {order.customerProfile.lastName} · {formatDateTime(order.placedAt)} ·{" "}
                    {order.items.length} item{order.items.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>{order.status}</Badge>
                  <span className="font-semibold">{formatMoney(order.totalCents)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
