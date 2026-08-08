"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, requireStaffContext } from "@/lib/rbac";
import { getPaymentProvider } from "@/lib/providers/payments";
import { writeAuditLog } from "@/lib/audit";

export async function refundPaymentAction(_prevState: unknown, formData: FormData) {
  await requirePermission("sales.manage");
  const { db, user } = await requireStaffContext();

  const paymentId = String(formData.get("paymentId") ?? "");
  const amountDollars = Number(formData.get("amount") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  const amountCents = Math.round(amountDollars * 100);

  if (!paymentId || amountCents <= 0) return { error: "Enter a valid refund amount." };
  if (!reason) return { error: "A reason is required for refunds." };

  const payment = await db.payment.findFirst({ where: { id: paymentId }, include: { order: true, refunds: true } });
  if (!payment) return { error: "Payment not found." };
  if (payment.status !== "SUCCEEDED") return { error: "Only successful payments can be refunded." };

  const alreadyRefunded = payment.refunds
    .filter((r) => r.status === "SUCCEEDED")
    .reduce((sum, r) => sum + r.amountCents, 0);
  if (alreadyRefunded + amountCents > payment.amountCents) {
    return { error: "Refund amount exceeds the remaining refundable balance." };
  }

  const provider = getPaymentProvider();
  const result = await provider.refund({
    providerPaymentId: payment.providerPaymentId ?? "",
    amountCents,
    reason,
  });

  await db.refund.create({
    data: {
      paymentId: payment.id,
      amountCents,
      reason,
      status: result.status,
      providerRefundId: result.providerRefundId,
      createdByStaffProfileId: user.staffProfileId,
    } as never,
  });

  if (result.status === "SUCCEEDED" && payment.orderId) {
    const totalRefunded = alreadyRefunded + amountCents;
    const newStatus = totalRefunded >= payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await db.order.updateMany({ where: { id: payment.orderId }, data: { status: newStatus } });
  }

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "payment.refunded",
    entityType: "Payment",
    entityId: payment.id,
    reason,
    metadata: { amountCents },
  });

  revalidatePath("/admin/payments");
  revalidatePath("/admin/orders");
  return { success: true };
}
