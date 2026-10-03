"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { refundPayment, refundableRemainder } from "@/lib/refunds";

/**
 * Refunding an order from the clinic's dashboard.
 *
 * The work is in lib/refunds.ts; this is the door into it from a clinic page:
 * it checks the staff member may manage sales, finds the order's payment, and
 * refuses an order belonging to another clinic by never looking outside the
 * session's own tenant.
 */

const schema = z.object({
  orderId: z.string().min(1),
  /** Blank means everything still refundable. */
  amount: z.string().trim().max(20).optional(),
  reason: z.string().trim().max(200, "Keep the reason under 200 characters").optional(),
});

export interface RefundableOrder {
  orderId: string;
  paymentId: string;
  currency: string;
  /** What is still refundable, in cents. */
  remainderCents: number;
  totalCents: number;
}

/** What the dashboard needs before offering a refund: is there anything left? */
export async function refundableForOrderAction(merchantId: string, orderId: string): Promise<ActionResult<{ order: RefundableOrder | null }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "sales.manage");
    const order = await ctx.db.order.findFirst({
      where: { id: orderId },
      select: { id: true, currency: true, totalCents: true, payments: { where: { status: "SUCCEEDED" }, include: { refunds: true } } },
    });
    const payment = order?.payments[0];
    if (!order || !payment) return { order: null };
    return {
      order: {
        orderId: order.id,
        paymentId: payment.id,
        currency: order.currency,
        remainderCents: refundableRemainder(payment),
        totalCents: order.totalCents,
      },
    };
  });
}

export interface ClientOrderRow {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  totalCents: number;
  placedAt: string;
  /** Already given back. */
  refundedCents: number;
  /** Still refundable, so the button only appears where it can do something. */
  refundableCents: number;
}

/** One client's orders, for the record staff already have open. */
export async function clientOrdersAction(merchantId: string, customerProfileId: string): Promise<ActionResult<{ orders: ClientOrderRow[] }>> {
  return runAction(async () => {
    // Reading a client's orders is part of managing sales, like refunding one.
    const ctx = await requireMerchantAction(merchantId, "sales.manage");
    const rows = await ctx.db.order.findMany({
      where: { customerProfileId },
      orderBy: { placedAt: "desc" },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        currency: true,
        totalCents: true,
        placedAt: true,
        payments: { where: { status: "SUCCEEDED" }, include: { refunds: true } },
      },
    });

    return {
      orders: rows.map((o) => {
        const payment = o.payments[0];
        const refundedCents = (payment?.refunds ?? [])
          .filter((r) => r.status === "SUCCEEDED" || r.status === "PENDING")
          .reduce((sum, r) => sum + r.amountCents, 0);
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          currency: o.currency,
          totalCents: o.totalCents,
          placedAt: o.placedAt.toISOString(),
          refundedCents,
          refundableCents: payment ? refundableRemainder(payment) : 0,
        };
      }),
    };
  });
}

export type RefundOrderResult = ActionResult<{ amountCents: number; fully: boolean; pending: boolean }>;

export async function refundOrderAction(merchantId: string, input: z.input<typeof schema>): Promise<RefundOrderResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "sales.manage");
    const data = schema.parse(input);

    const order = await ctx.db.order.findFirst({
      where: { id: data.orderId },
      select: { id: true, payments: { where: { status: "SUCCEEDED" }, select: { id: true } } },
    });
    const payment = order?.payments[0];
    if (!payment) throw new ActionError("There's no completed payment on this order to refund.");

    // Typed in currency units by a person, stored and sent in cents.
    const amountCents = data.amount ? Math.round(Number(data.amount.replace(",", ".")) * 100) : null;
    if (data.amount && (!Number.isFinite(amountCents) || (amountCents ?? 0) <= 0)) {
      throw new ActionError("Enter an amount like 25 or 25.50, or leave it blank to refund everything.");
    }

    const result = await refundPayment(ctx.db, {
      paymentId: payment.id,
      amountCents,
      reason: data.reason ?? null,
      staffProfileId: ctx.user.staffProfileId ?? null,
    });
    if ("error" in result) throw new ActionError(result.error);

    await ctx.audit("payment.refunded", "Payment", payment.id, {
      orderId: order!.id,
      amountCents: result.amountCents,
      fully: result.fully,
      reason: data.reason ?? null,
    });

    revalidatePath(`/m/${merchantId}/shop`);
    revalidatePath(`/m/${merchantId}/clients`);
    return { amountCents: result.amountCents, fully: result.fully, pending: result.status === "PENDING" };
  });
}
