import "server-only";
import { Prisma } from "@prisma/client";

/**
 * The rows a claim can be serialised on. A fixed list, so the table name in
 * the query is never something a caller passed in.
 */
const LOCKABLE = {
  CustomerProfile: Prisma.raw('"CustomerProfile"'),
  StaffProfile: Prisma.raw('"StaffProfile"'),
  Promotion: Prisma.raw('"Promotion"'),
} as const;

export type LockableTable = keyof typeof LOCKABLE;

/**
 * Locks one row of one clinic for the rest of the transaction
 * (`SELECT … FOR UPDATE`), and says whether it exists.
 *
 * For "check, then write" claims that must happen once: a referral bonus, a
 * membership, a one-time discount, a booking slot. Simultaneous requests used
 * to all pass the check before any of them wrote
 * (docs/security/review-2026-11-pass2.md, P-4, P-5, P-6, B-2). Taking this
 * lock first makes the second request wait until the first has committed,
 * and then its check sees the first one's write.
 *
 * Everything that must see the lock — the check and the write — has to use
 * the same `tx`.
 */
export async function lockRow(tx: Prisma.TransactionClient, table: LockableTable, id: string, tenantId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${LOCKABLE[table]} WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE
  `;
  return rows.length === 1;
}

/**
 * Transaction options for a locked claim. Requests queued on one row each
 * hold a pooled connection while they wait, so a burst can keep a late one
 * from even starting within Prisma's default two seconds; it waits for a
 * connection instead of failing. The work inside each is short.
 */
export const LOCKED_CLAIM = { maxWait: 10_000, timeout: 20_000 } as const;
