import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { Wallet } from "lucide-react";
import { RefundButton } from "./client";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  SUCCEEDED: "success",
  PROCESSING: "warning",
  REQUIRES_ACTION: "warning",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export default async function AdminPaymentsPage() {
  await requirePermission("sales.manage");
  const { db } = await requireStaffContext();

  const payments = await db.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { order: { include: { customerProfile: true } }, refunds: true },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Payments</h1>
      {payments.length === 0 ? (
        <EmptyState icon={<Wallet className="h-6 w-6" />} title="No payments yet" />
      ) : (
        <div className="space-y-2">
          {payments.map((payment) => {
            const refunded = payment.refunds
              .filter((r) => r.status === "SUCCEEDED")
              .reduce((sum, r) => sum + r.amountCents, 0);
            const refundable = payment.status === "SUCCEEDED" ? payment.amountCents - refunded : 0;
            return (
              <Card key={payment.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">
                      {payment.order?.orderNumber ?? "—"}
                      {payment.order?.customerProfile && (
                        <span className="ml-2 font-normal text-ink-muted">
                          {payment.order.customerProfile.firstName} {payment.order.customerProfile.lastName}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {formatDateTime(payment.createdAt)} · {payment.provider}
                      {refunded > 0 && ` · ${formatMoney(refunded)} refunded`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[payment.status] ?? "neutral"}>{payment.status}</Badge>
                    <span className="font-semibold">{formatMoney(payment.amountCents)}</span>
                    <RefundButton paymentId={payment.id} refundableCents={refundable} />
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
