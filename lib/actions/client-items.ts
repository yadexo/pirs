"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { generateBackupCode, generateToken } from "@/lib/redeemable";
import { notifyItemIssued, notifyItemVoided } from "@/lib/client-notifications";

/**
 * The items a client can collect, as the clinic's own staff manage them.
 *
 * Three things happen here that a purchase cannot do by itself: taking back
 * an item that should not have been issued, replacing a code that was lost or
 * voided, and giving something away. All three change what a client believes
 * they own, so each needs a reason, records the staff member, writes the audit
 * log and tells the client.
 */

const reason = z.string().trim().min(1, "A reason is required").max(200, "Keep the reason under 200 characters");

const voidInput = z.object({ reason });
const reissueInput = z.object({ reason });
const giftInput = z.object({
  name: z.string().trim().min(1, "What are you giving them?").max(120),
  itemType: z.enum(["PRODUCT", "SERVICE", "PACKAGE"]),
  reason,
});

/** The item, and the clinic it belongs to. Another clinic's is simply absent. */
async function openItem(merchantId: string, itemId: string) {
  const ctx = await requireMerchantAction(merchantId, "sales.manage");
  const item = await rawDb.redeemableItem.findFirst({
    where: { id: itemId, tenantId: merchantId },
    select: { id: true, name: true, status: true, customerProfileId: true, itemType: true, source: true, orderId: true, orderItemId: true, unitIndex: true },
  });
  if (!item) throw new ActionError("That item no longer exists.");
  return { ctx, item };
}

/**
 * Takes back an item that has not been used.
 *
 * A used item is left alone: the client already had the thing, and a code
 * that has been handed over cannot be un-handed by changing a row. Refunds
 * have their own path for that (see lib/redeemable.ts).
 */
export async function voidClientItemAction(
  merchantId: string,
  itemId: string,
  input: z.input<typeof voidInput>,
): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const { ctx, item } = await openItem(merchantId, itemId);
    const { reason: why } = voidInput.parse(input);

    if (item.status === "REDEEMED") throw new ActionError("That item has already been collected, so there's nothing to take back.");
    if (item.status === "VOIDED") throw new ActionError("That item is already void.");

    // Conditional, so an item redeemed a moment ago is not voided from under
    // the staff member who just handed it over.
    const { count } = await rawDb.redeemableItem.updateMany({
      where: { id: itemId, tenantId: merchantId, status: { in: ["AVAILABLE", "EXPIRED"] } },
      data: { status: "VOIDED", voidedAt: new Date(), voidedReason: why, voidedByStaffProfileId: ctx.user.staffProfileId ?? null },
    });
    if (count === 0) throw new ActionError("That item was just collected. Nothing has been changed.");

    await ctx.audit("item.voided", "RedeemableItem", itemId, { reason: why, name: item.name });
    await notifyItemVoided(item.customerProfileId, item.name, why).catch((err) =>
      console.error("[client-items] void notice not sent:", err instanceof Error ? err.message : err),
    );

    revalidatePath(`/m/${merchantId}/clients`);
    return { status: "VOIDED" };
  });
}

/**
 * Replaces a lost or voided item with a new code.
 *
 * The same entitlement, a new code: the old one stops working the moment this
 * is written, which is the point of reissuing a code somebody else may be
 * holding. The row keeps its history rather than a new one being invented.
 */
export async function reissueClientItemAction(
  merchantId: string,
  itemId: string,
  input: z.input<typeof reissueInput>,
): Promise<ActionResult<{ code: string }>> {
  return runAction(async () => {
    const { ctx, item } = await openItem(merchantId, itemId);
    const { reason: why } = reissueInput.parse(input);

    if (item.status === "REDEEMED") throw new ActionError("That item has been collected. Give them a new one instead.");

    const code = generateBackupCode();
    const { count } = await rawDb.redeemableItem.updateMany({
      where: { id: itemId, tenantId: merchantId, status: { in: ["AVAILABLE", "VOIDED", "EXPIRED"] } },
      data: {
        token: generateToken(),
        code,
        status: "AVAILABLE",
        source: "REISSUE",
        issuedByStaffProfileId: ctx.user.staffProfileId ?? null,
        issuedReason: why,
        // It is available again, so what was said about voiding it no longer
        // describes this item.
        voidedAt: null,
        voidedReason: null,
        voidedByStaffProfileId: null,
      },
    });
    if (count === 0) throw new ActionError("That item can't be reissued.");

    await ctx.audit("item.reissued", "RedeemableItem", itemId, { reason: why, name: item.name });
    await notifyItemIssued(item.customerProfileId, item.name, "Your code has been replaced", why).catch((err) =>
      console.error("[client-items] reissue notice not sent:", err instanceof Error ? err.message : err),
    );

    revalidatePath(`/m/${merchantId}/clients`);
    return { code };
  });
}

/**
 * Gives a client something they did not buy.
 *
 * It has no order behind it, and says so: a gift that pretended to be a sale
 * would show up in the client's purchase history and the clinic's revenue as
 * money that never changed hands.
 */
export async function giftClientItemAction(
  merchantId: string,
  customerProfileId: string,
  input: z.input<typeof giftInput>,
): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "sales.manage");
    const { name, itemType, reason: why } = giftInput.parse(input);

    const client = await ctx.db.customerProfile.findFirst({ where: { id: customerProfileId }, select: { id: true } });
    if (!client) throw new ActionError("That client no longer exists.");

    const created = await rawDb.redeemableItem.create({
      data: {
        tenantId: merchantId,
        customerProfileId,
        orderId: null,
        orderItemId: null,
        unitIndex: 0,
        source: "GIFT",
        itemType,
        name,
        token: generateToken(),
        code: generateBackupCode(),
        status: "AVAILABLE",
        issuedByStaffProfileId: ctx.user.staffProfileId ?? null,
        issuedReason: why,
      } as never,
      select: { id: true, code: true },
    });

    await ctx.audit("item.gifted", "RedeemableItem", created.id, { reason: why, name, itemType });
    await notifyItemIssued(customerProfileId, name, "A gift from us", why).catch((err) =>
      console.error("[client-items] gift notice not sent:", err instanceof Error ? err.message : err),
    );

    revalidatePath(`/m/${merchantId}/clients`);
    return created;
  });
}
