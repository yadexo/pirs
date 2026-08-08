import { notFound } from "next/navigation";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { requireCustomerContext } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatDate } from "@/lib/utils";
import { Receipt } from "lucide-react";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  PAID: "success",
  PENDING: "warning",
  FAILED: "danger",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
  CANCELLED: "neutral",
};

export default async function OrdersPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db, user } = await requireCustomerContext();
  const orders = await db.order.findMany({
    where: { customerProfileId: user.customerProfileId! },
    orderBy: { placedAt: "desc" },
    include: { items: true },
  });

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-lg font-semibold">Orders</h1>
      {orders.length === 0 ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title="No orders yet" />
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <Link key={order.id} href={`/${tenantSlug}/orders/${order.id}`}>
              <Card className="transition-shadow hover:shadow-raised">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">{order.orderNumber}</p>
                    <p className="text-xs text-ink-subtle">
                      {formatDate(order.placedAt)} · {order.items.length} item{order.items.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>{order.status}</Badge>
                    <span className="font-semibold">{formatMoney(order.totalCents)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
