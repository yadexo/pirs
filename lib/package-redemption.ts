import { rawDb } from "@/lib/db";
import { isExpired } from "@/lib/package-pricing";

/**
 * Spending one session of a client's package at the desk.
 *
 * The whole thing turns on one conditional update. Two people at the desk can
 * be looking at the same package — the client's phone and the receptionist's
 * screen, or two receptionists — and the last session must go to exactly one
 * of them. So the count is decremented with the current count as a condition,
 * and a caller whose update matched nothing is told it has already gone
 * rather than being handed a session that no longer exists.
 *
 * Nothing here decides whether staff may do this; that is the action's job.
 */

export type SpendSessionOutcome =
  | { ok: true; remainingUses: number; totalUses: number; packageName: string; serviceName: string; useId: string }
  | { ok: false; reason: "not-found" | "expired" | "none-left" | "not-covered" | "raced"; message: string };

export async function spendPackageSession(params: {
  tenantId: string;
  customerPackageId: string;
  /** Which covered treatment the session is being spent on. */
  serviceId: string;
  staffUserId: string | null;
  note?: string | null;
  now?: Date;
}): Promise<SpendSessionOutcome> {
  const now = params.now ?? new Date();

  const owned = await rawDb.customerPackage.findFirst({
    where: { id: params.customerPackageId, tenantId: params.tenantId },
    select: {
      id: true,
      remainingUses: true,
      totalUses: true,
      expiresAt: true,
      status: true,
      package: { select: { name: true, items: { select: { serviceId: true, service: { select: { name: true } } } } } },
    },
  });
  if (!owned) return { ok: false, reason: "not-found", message: "Those sessions aren't this clinic's." };

  // Expiry first: a package past its date has sessions on paper and none in
  // fact, and saying "none left" about it would be the wrong explanation.
  if (isExpired(owned.expiresAt, now)) {
    return { ok: false, reason: "expired", message: "These sessions passed their end date, so they can't be used." };
  }
  if (owned.remainingUses <= 0 || owned.status === "TRANSFERRED") {
    return { ok: false, reason: "none-left", message: "There are no sessions left on this package." };
  }

  const covered = owned.package.items.find((i) => i.serviceId === params.serviceId);
  if (!covered) {
    return { ok: false, reason: "not-covered", message: "This package doesn't cover that treatment." };
  }

  // The race: the count it was read at is the count it must still be.
  const { count } = await rawDb.customerPackage.updateMany({
    where: { id: owned.id, tenantId: params.tenantId, remainingUses: owned.remainingUses },
    data: {
      remainingUses: { decrement: 1 },
      // A package with nothing left is finished, not active.
      ...(owned.remainingUses === 1 ? { status: "DEPLETED" as const } : {}),
    },
  });
  if (count === 0) {
    return { ok: false, reason: "raced", message: "Someone just used that session. Check the count and try again." };
  }

  const use = await rawDb.packageSessionUse.create({
    data: {
      tenantId: params.tenantId,
      customerPackageId: owned.id,
      serviceId: params.serviceId,
      usedById: params.staffUserId,
      note: params.note?.trim() || null,
      usedAt: now,
    },
    select: { id: true },
  });

  return {
    ok: true,
    remainingUses: owned.remainingUses - 1,
    totalUses: owned.totalUses,
    packageName: owned.package.name,
    serviceName: covered.service?.name ?? "Treatment",
    useId: use.id,
  };
}

/** "1 session used, 4 left" — what the client is told. */
export function sessionUsedMessage(remaining: number): string {
  return `1 session used, ${remaining} left`;
}
