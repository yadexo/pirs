import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { isExpired, sessionsLeftLabel } from "@/lib/package-pricing";

/**
 * The session packages a client owns, for My items.
 *
 * Expiry is read, never recalculated: the end date was fixed when they bought
 * it, and a clinic that has since changed the package must not move it.
 */

export interface OwnedPackage {
  id: string;
  name: string;
  imageUrl: string | null;
  remainingUses: number;
  totalUses: number;
  /** "3 of 5 sessions left". */
  sessionsLabel: string;
  expiresAt: string | null;
  expired: boolean;
  /** Set only when the package itself allows it and sessions remain. */
  canGive: boolean;
  /** The treatments a session can be spent on, with their booking page. */
  covers: { id: string; name: string; bookingUrl: string | null }[];
  /** Set when another client gave these sessions. */
  receivedFromName: string | null;
}

export async function getOwnedPackages(db: TenantDb, customerProfileId: string, now: Date = new Date()): Promise<OwnedPackage[]> {
  const rows = await db.customerPackage.findMany({
    where: { customerProfileId },
    orderBy: [{ expiresAt: "asc" }, { purchasedAt: "desc" }],
    select: {
      id: true,
      remainingUses: true,
      totalUses: true,
      expiresAt: true,
      status: true,
      receivedFrom: { select: { firstName: true } },
      package: {
        select: {
          name: true,
          imageUrl: true,
          transferable: true,
          items: { select: { service: { select: { id: true, name: true, schedulingUrl: true, active: true } } } },
        },
      },
    },
  });

  return rows
    // A package given away entirely is the giver's no longer.
    .filter((r) => r.status !== "TRANSFERRED")
    .map((r) => {
      const expired = isExpired(r.expiresAt, now);
      return {
        id: r.id,
        name: r.package.name,
        imageUrl: r.package.imageUrl,
        remainingUses: r.remainingUses,
        totalUses: r.totalUses,
        sessionsLabel: sessionsLeftLabel(r.remainingUses, r.totalUses),
        expiresAt: r.expiresAt?.toISOString() ?? null,
        expired,
        // Expired sessions cannot be given, and neither can none.
        canGive: r.package.transferable && r.remainingUses > 0 && !expired,
        covers: r.package.items
          .map((i) => i.service)
          .filter((s): s is NonNullable<typeof s> => !!s && s.active)
          .map((s) => ({ id: s.id, name: s.name, bookingUrl: s.schedulingUrl })),
        receivedFromName: r.receivedFrom?.firstName ?? null,
      };
    });
}
