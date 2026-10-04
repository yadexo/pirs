import "server-only";
import { rawDb } from "@/lib/db";
import type { TenantDb } from "@/lib/tenant-db";

/**
 * A client's account credit: money the clinic already holds for them.
 *
 * It arrives as a membership's included credit, as a goodwill adjustment from
 * a staff member, or back from an order that failed, and it is spent at
 * checkout like cash. The client app shows it as their balance, so the number
 * has to be exactly right — this is the only place it moves.
 *
 * Deliberately the same shape as lib/loyalty.ts, because it is the same
 * problem: a balance two requests can reach at once.
 */

/** Thrown when a deduction would take a client's balance below zero. */
export class InsufficientCreditError extends Error {
  constructor() {
    super("Not enough account credit.");
    this.name = "InsufficientCreditError";
  }
}

/**
 * Adds (or, with a negative number, spends) credit and writes the ledger row,
 * atomically.
 *
 * One conditional UPDATE, never a read followed by a write, so two checkouts
 * at the same moment cannot both spend the same credit: the second finds the
 * balance too low and throws. The ledger row records the balance that UPDATE
 * produced, in the same transaction, so the running balances never drift from
 * the profile's.
 */
export async function adjustAccountCredit(
  db: TenantDb,
  params: {
    customerProfileId: string;
    amountCents: number; // positive to grant, negative to spend
    type: "MANUAL_ADJUSTMENT" | "MEMBERSHIP_GRANT" | "REFUND" | "REDEEMED" | "EXPIRED";
    reason?: string;
    relatedOrderId?: string;
    performedByStaffProfileId?: string | null;
  },
): Promise<number> {
  if (!Number.isInteger(params.amountCents)) throw new Error("Credit must be a whole number of cents.");
  // Resolved through the tenant-scoped client, so a profile from another clinic is "not found".
  const profile = await db.customerProfile.findFirst({ where: { id: params.customerProfileId }, select: { id: true, tenantId: true } });
  if (!profile) throw new Error("Customer not found.");

  return rawDb.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ balance: number }[]>`
        UPDATE "CustomerProfile"
        SET "accountCreditBalanceCents" = "accountCreditBalanceCents" + ${params.amountCents}, "updatedAt" = NOW()
        WHERE "id" = ${profile.id} AND "tenantId" = ${profile.tenantId}
          AND "accountCreditBalanceCents" + ${params.amountCents} >= 0
        RETURNING "accountCreditBalanceCents" AS balance
      `;
      if (rows.length === 0) throw new InsufficientCreditError();
      const balanceAfterCents = Number(rows[0]!.balance);

      await tx.accountCreditTransaction.create({
        data: {
          tenantId: profile.tenantId,
          customerProfileId: profile.id,
          type: params.type,
          amountCents: params.amountCents,
          balanceAfterCents,
          reason: params.reason,
          relatedOrderId: params.relatedOrderId,
          performedByStaffProfileId: params.performedByStaffProfileId ?? undefined,
        },
      });
      return balanceAfterCents;
    },
    // Same reasoning as the loyalty ledger: these two statements serialise on
    // one row, and the default five seconds is the whole queue's budget.
    { timeout: 20_000 },
  );
}

/** What this client has to spend, in cents. */
export async function availableCredit(db: TenantDb, customerProfileId: string): Promise<number> {
  const profile = await db.customerProfile.findFirst({ where: { id: customerProfileId }, select: { accountCreditBalanceCents: true } });
  return profile?.accountCreditBalanceCents ?? 0;
}

/**
 * How much credit an order should actually take: never more than the client
 * has, and never more than the bill.
 */
export function creditToApply({ requestedUse, availableCents, totalCents }: { requestedUse: boolean; availableCents: number; totalCents: number }): number {
  if (!requestedUse) return 0;
  return Math.max(0, Math.min(availableCents, totalCents));
}
