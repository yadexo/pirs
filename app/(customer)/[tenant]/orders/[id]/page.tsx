import { notFound } from "next/navigation";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { requireCustomerContext } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { CheckCircle2, XCircle } from "lucide-react";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { tenant: tenantSlug, id } = await params;
  const { status } = await searchParams;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db, user } = await requireCustomerContext();
  const order = await db.order.findFirst({
    where: { id, customerProfileId: user.customerProfileId! },
    include: { items: true, payments: true },
  });
  if (!order) notFound();

  return (
    <div className="space-y-4 py-4">
      {status === "success" && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-6 w-6 text-success" />
            <div>
              <p className="font-medium text-success">Payment successful</p>
              <p className="text-sm text-ink-muted">Your order is confirmed.</p>
            </div>
          </CardContent>
        </Card>
      )}
      {status === "failed" && (
        <Card className="border-danger/30 bg-danger/5">
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="h-6 w-6 text-danger" />
            <div>
              <p className="font-medium text-danger">Payment failed</p>
              <p className="text-sm text-ink-muted">
                {order.payments[0]?.failureReason ?? "Your payment could not be processed."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{order.orderNumber}</h1>
        <Badge tone={order.status === "PAID" ? "success" : order.status === "FAILED" ? "danger" : "neutral"}>
          {order.status}
        </Badge>
      </div>
      <p className="text-sm text-ink-subtle">{formatDateTime(order.placedAt)}</p>

      <Card>
        <CardContent className="space-y-2 p-4">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <span>{item.name} × {item.quantity}</span>
              <span>{formatMoney(item.totalCents)}</span>
            </div>
          ))}
          <div className="space-y-1 border-t border-border pt-2 text-sm">
            <div className="flex justify-between text-ink-muted">
              <span>Subtotal</span>
              <span>{formatMoney(order.subtotalCents)}</span>
            </div>
            {order.discountCents > 0 && (
              <div className="flex justify-between text-success">
                <span>Discount</span>
                <span>-{formatMoney(order.discountCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-ink-muted">
              <span>Tax</span>
              <span>{formatMoney(order.taxCents)}</span>
            </div>
            {order.creditAppliedCents > 0 && (
              <div className="flex justify-between text-success">
                <span>Account credit</span>
                <span>-{formatMoney(order.creditAppliedCents)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <span>Total</span>
              <span>{formatMoney(order.totalCents)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {order.status === "FAILED" && (
        <Link href={`/${tenantSlug}/checkout`}>
          <Button className="w-full">Try again</Button>
        </Link>
      )}
    </div>
  );
}
