"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { adjustAccountCredit, InsufficientCreditError } from "@/lib/account-credit";
import { notifyCreditChanged } from "@/lib/client-notifications";

/**
 * A client's balances, as the clinic's own staff see and change them.
 *
 * Every change here is somebody's decision about somebody else's money, so
 * none of it is anonymous: a reason is required, the staff member is on the
 * ledger row, and the audit log gets its own entry. The client is told, and
 * sees the same line in their own history — a balance that moves with no
 * explanation is indistinguishable from a bug.
 *
 * Reads and writes go through lib/account-credit.ts, so a staff adjustment
 * and a client's checkout move the balance the same atomic way.
 */

/** A money amount typed by a person: "25", "25.50", "25,50". */
const amount = z
  .string()
  .trim()
  .min(1, "Enter an amount")
  .max(20)
  .transform((v) => Math.round(Number(v.replace(",", ".")) * 100))
  .refine((cents) => Number.isFinite(cents) && cents > 0, "Enter an amount like 25 or 25.50");

const adjustment = z.object({
  direction: z.enum(["add", "remove"]),
  amount,
  reason: z.string().trim().min(1, "A reason is required").max(200, "Keep the reason under 200 characters"),
});

export interface LedgerRow {
  id: string;
  /** Signed: negative is money leaving the client's balance. */
  amountCents: number;
  balanceAfterCents: number;
  type: string;
  reason: string | null;
  /** The staff member who did it, when a person did. */
  by: string | null;
  at: string;
}

export interface ClientAccount {
  creditCents: number;
  credit: LedgerRow[];
}

const staffName = (staff: { firstName: string | null; lastName: string | null } | null) =>
  staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") || null : null;

/** The balance and the whole story behind it. */
export async function clientAccountAction(merchantId: string, customerProfileId: string): Promise<ActionResult<{ account: ClientAccount }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "customers.view");

    const profile = await ctx.db.customerProfile.findFirst({
      where: { id: customerProfileId },
      select: { accountCreditBalanceCents: true },
    });
    if (!profile) throw new ActionError("That client no longer exists.");

    const credit = await ctx.db.accountCreditTransaction.findMany({
      where: { customerProfileId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        amountCents: true,
        balanceAfterCents: true,
        type: true,
        reason: true,
        createdAt: true,
        performedByStaffProfile: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      account: {
        creditCents: profile.accountCreditBalanceCents,
        credit: credit.map((row) => ({
          id: row.id,
          amountCents: row.amountCents,
          balanceAfterCents: row.balanceAfterCents,
          type: row.type,
          reason: row.reason,
          by: staffName(row.performedByStaffProfile),
          at: row.createdAt.toISOString(),
        })),
      },
    };
  });
}

/**
 * Adds or takes back account credit.
 *
 * Taking credit back is capped at what the client has: an adjustment that
 * would push them below zero is refused with the balance named, rather than
 * leaving somebody owing the clinic money they never borrowed.
 */
export async function adjustClientCreditAction(
  merchantId: string,
  customerProfileId: string,
  input: z.input<typeof adjustment>,
): Promise<ActionResult<{ balanceCents: number }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "customers.edit");
    const { direction, amount: amountCents, reason } = adjustment.parse(input);

    // Through the tenant-scoped client, so another clinic's client is simply
    // not found rather than quietly adjusted.
    const profile = await ctx.db.customerProfile.findFirst({ where: { id: customerProfileId }, select: { id: true } });
    if (!profile) throw new ActionError("That client no longer exists.");

    const signed = direction === "add" ? amountCents : -amountCents;

    let balanceCents: number;
    try {
      balanceCents = await adjustAccountCredit(ctx.db, {
        customerProfileId,
        amountCents: signed,
        type: "MANUAL_ADJUSTMENT",
        reason,
        performedByStaffProfileId: ctx.user.staffProfileId ?? null,
      });
    } catch (err) {
      if (err instanceof InsufficientCreditError) {
        const current = await ctx.db.customerProfile.findFirst({
          where: { id: customerProfileId },
          select: { accountCreditBalanceCents: true },
        });
        throw new ActionError(`That's more than the ${((current?.accountCreditBalanceCents ?? 0) / 100).toFixed(2)} this client has.`);
      }
      throw err;
    }

    await ctx.audit("credit.adjusted", "CustomerProfile", customerProfileId, { amountCents: signed, reason, balanceCents });

    // Told after the fact and unable to undo it: a notification that fails
    // must not lose the adjustment that already happened.
    await notifyCreditChanged(customerProfileId, signed, reason).catch((err) =>
      console.error("[client-account] credit notice not sent:", err instanceof Error ? err.message : err),
    );

    revalidatePath(`/m/${merchantId}/clients`);
    return { balanceCents };
  });
}

/** Where the client's own app reads this from, kept in one place. */
export async function clientCreditBalance(customerProfileId: string): Promise<number> {
  const profile = await rawDb.customerProfile.findUnique({
    where: { id: customerProfileId },
    select: { accountCreditBalanceCents: true },
  });
  return profile?.accountCreditBalanceCents ?? 0;
}
