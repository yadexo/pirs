"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { adjustAccountCredit, InsufficientCreditError } from "@/lib/account-credit";
import { adjustLoyaltyPoints, InsufficientPointsError } from "@/lib/loyalty";
import { notifyCreditChanged, notifyPointsChanged } from "@/lib/client-notifications";

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
  /** Signed: negative is leaving the client's balance. Cents, or points. */
  amount: number;
  balanceAfter: number;
  type: string;
  reason: string | null;
  /** The staff member who did it, when a person did. */
  by: string | null;
  at: string;
}

export interface ClientAccount {
  creditCents: number;
  credit: LedgerRow[];
  pointsBalance: number;
  points: LedgerRow[];
}

const staffName = (staff: { firstName: string | null; lastName: string | null } | null) =>
  staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") || null : null;

/** The balance and the whole story behind it. */
export async function clientAccountAction(merchantId: string, customerProfileId: string): Promise<ActionResult<{ account: ClientAccount }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "customers.view");

    const profile = await ctx.db.customerProfile.findFirst({
      where: { id: customerProfileId },
      select: { accountCreditBalanceCents: true, loyaltyPointsBalance: true },
    });
    if (!profile) throw new ActionError("That client no longer exists.");

    const by = { select: { firstName: true, lastName: true } };
    const [credit, points] = await Promise.all([
      ctx.db.accountCreditTransaction.findMany({
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
          performedByStaffProfile: by,
        },
      }),
      ctx.db.loyaltyTransaction.findMany({
        where: { customerProfileId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          points: true,
          balanceAfter: true,
          type: true,
          reason: true,
          createdAt: true,
          performedByStaffProfile: by,
        },
      }),
    ]);

    return {
      account: {
        creditCents: profile.accountCreditBalanceCents,
        credit: credit.map((row) => ({
          id: row.id,
          amount: row.amountCents,
          balanceAfter: row.balanceAfterCents,
          type: row.type,
          reason: row.reason,
          by: staffName(row.performedByStaffProfile),
          at: row.createdAt.toISOString(),
        })),
        pointsBalance: profile.loyaltyPointsBalance,
        points: points.map((row) => ({
          id: row.id,
          amount: row.points,
          balanceAfter: row.balanceAfter,
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

const pointsAdjustment = z.object({
  direction: z.enum(["add", "remove"]),
  points: z
    .string()
    .trim()
    .min(1, "Enter a number of points")
    .max(12)
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, "Points are whole numbers above zero"),
  reason: z.string().trim().min(1, "A reason is required").max(200, "Keep the reason under 200 characters"),
});

/**
 * Adds or takes back loyalty points.
 *
 * The same shape as credit, and for the same reason: points are worth money
 * to the client, so nobody moves them anonymously. Taking more than the
 * client has is refused rather than wrapping into a negative balance.
 */
export async function adjustClientPointsAction(
  merchantId: string,
  customerProfileId: string,
  input: z.input<typeof pointsAdjustment>,
): Promise<ActionResult<{ balance: number }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "loyalty.adjust");
    const { direction, points, reason } = pointsAdjustment.parse(input);

    const profile = await ctx.db.customerProfile.findFirst({ where: { id: customerProfileId }, select: { id: true } });
    if (!profile) throw new ActionError("That client no longer exists.");

    const signed = direction === "add" ? points : -points;

    let balance: number;
    try {
      balance = await adjustLoyaltyPoints(ctx.db, {
        customerProfileId,
        points: signed,
        type: "MANUAL_ADJUSTMENT",
        reason,
        performedByStaffProfileId: ctx.user.staffProfileId ?? undefined,
      });
    } catch (err) {
      if (err instanceof InsufficientPointsError) {
        const current = await ctx.db.customerProfile.findFirst({
          where: { id: customerProfileId },
          select: { loyaltyPointsBalance: true },
        });
        throw new ActionError(`That's more than the ${current?.loyaltyPointsBalance ?? 0} points this client has.`);
      }
      throw err;
    }

    await ctx.audit("loyalty.adjusted", "CustomerProfile", customerProfileId, { points: signed, reason, balance });

    await notifyPointsChanged(customerProfileId, signed, reason).catch((err) =>
      console.error("[client-account] points notice not sent:", err instanceof Error ? err.message : err),
    );

    revalidatePath(`/m/${merchantId}/clients`);
    return { balance };
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
