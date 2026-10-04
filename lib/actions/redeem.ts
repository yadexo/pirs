"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { notifyItemRedeemed } from "@/lib/client-notifications";
import { findItem, isBackupCode, normaliseCode, redeemItem, tokenFromScan, toView, type ItemView } from "@/lib/redeemable";

/**
 * Redeeming a client's paid-for item at the clinic — by scanning their code,
 * typing the eight characters underneath it, or picking the item off the
 * client's own record when they have neither.
 *
 * Every path goes through the same two steps: look it up, then confirm. Staff
 * see what they are about to hand over before anything is marked used, and the
 * marking itself is the atomic update in lib/redeemable.ts.
 *
 * The clinic is always the session's own. A code belonging to another clinic
 * is not found here, so the answer is "not valid at this clinic" — it never
 * says whose it is or what it was.
 */

const NOT_VALID_HERE = "Not valid at this clinic.";

/** What staff scanned or typed, whichever it turns out to be. */
const scanned = z.object({ value: z.string().trim().min(1, "Scan a code or type one").max(200) });

export type LookupResult = ActionResult<{ item: ItemView }>;

export async function lookupRedeemableAction(merchantId: string, value: string): Promise<LookupResult> {
  return runAction(async () => {
    await requireMerchantAction(merchantId, "sales.manage");
    const input = scanned.parse({ value });

    // A scanned QR carries a token; a receptionist types the short code.
    const token = tokenFromScan(input.value);
    const lookup = token ? { token } : isBackupCode(input.value) ? { code: normaliseCode(input.value) } : null;
    if (!lookup) throw new ActionError("That isn't one of this clinic's item codes.");

    const item = await findItem(merchantId, lookup);
    if (!item) throw new ActionError(NOT_VALID_HERE);
    return { item };
  });
}

const confirm = z.object({
  itemId: z.string().min(1),
  method: z.enum(["QR", "BACKUP_CODE", "MANUAL"]),
  note: z.string().trim().max(200, "Keep the note under 200 characters").optional(),
});

export type RedeemResult = ActionResult<{ item: ItemView }>;

export async function redeemItemAction(merchantId: string, input: z.input<typeof confirm>): Promise<RedeemResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "sales.manage");
    const { itemId, method, note } = confirm.parse(input);

    const outcome = await redeemItem({
      tenantId: merchantId,
      lookup: { id: itemId },
      staffUserId: ctx.user.id,
      method,
      note: method === "MANUAL" ? (note ?? null) : null,
    });

    if (!outcome.ok) {
      if (outcome.reason === "not-found") throw new ActionError(NOT_VALID_HERE);
      if (outcome.reason === "voided") throw new ActionError("This item was refunded, so it can't be redeemed.");
      if (outcome.reason === "expired") throw new ActionError("This item has expired.");
      const when = outcome.item?.redeemedAt ? new Date(outcome.item.redeemedAt).toLocaleString() : "earlier";
      const who = outcome.item?.redeemedByName ? ` by ${outcome.item.redeemedByName}` : "";
      throw new ActionError(`Already redeemed ${when}${who}.`);
    }

    await ctx.audit("redeemable.redeemed", "RedeemableItem", itemId, { method, name: outcome.item.name });

    // Told after the fact, and never able to undo it: the item is already
    // handed over whether or not the client's phone hears about it.
    const owner = await rawDb.redeemableItem.findFirst({
      where: { id: itemId, tenantId: merchantId },
      select: {
        name: true,
        customerProfile: { select: { userId: true } },
        tenant: { select: { slug: true, name: true, branding: { select: { businessName: true } } } },
      },
    });
    if (owner?.customerProfile?.userId) {
      await notifyItemRedeemed(
        owner.customerProfile.userId,
        owner.tenant.branding?.businessName ?? owner.tenant.name,
        owner.tenant.slug,
        owner.name,
      );
    }

    revalidatePath(`/m/${merchantId}/redeem`);
    return { item: outcome.item };
  });
}

/** Every item belonging to one client of this clinic, newest purchase first. */
export async function clientItemsAction(merchantId: string, customerProfileId: string): Promise<ActionResult<{ items: ItemView[] }>> {
  return runAction(async () => {
    await requireMerchantAction(merchantId, "sales.manage");
    const rows = await rawDb.redeemableItem.findMany({
      where: { tenantId: merchantId, customerProfileId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        itemType: true,
        status: true,
        code: true,
        createdAt: true,
        expiresAt: true,
        redeemedAt: true,
        redemptionMethod: true,
        refundedAfterUse: true,
        source: true,
        issuedReason: true,
        voidedReason: true,
        redeemedBy: { select: { email: true, staffProfile: { select: { firstName: true, lastName: true } } } },
        customerProfile: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
      },
    });
    return { items: rows.map((r) => toView(r as Parameters<typeof toView>[0])) };
  });
}
