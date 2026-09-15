import "server-only";
import { rawDb } from "@/lib/db";
import type { TenantDb } from "@/lib/tenant-db";
import { adjustLoyaltyPoints } from "@/lib/loyalty";
import { recordActivity } from "@/lib/activity";
import { startOfDayIn } from "@/lib/zoned-time";
import { DEFAULT_TIME_ZONE } from "@/lib/time-zone";

export type VisitResult = { recorded: true; points: number; visitCount: number } | { recorded: false; reason: "already-today" | "not-found" };

/**
 * Records a clinic visit and awards the clinic's per-visit points — once per
 * client per clinic day.
 *
 * The once-a-day rule is a conditional UPDATE, not a check followed by a
 * write, so two staff scanning the same client at the same moment record one
 * visit, not two. "Today" is the clinic's day in its own time zone.
 */
export async function recordVisit(db: TenantDb, customerProfileId: string): Promise<VisitResult> {
  const profile = await db.customerProfile.findFirst({
    where: { id: customerProfileId },
    select: { id: true, tenantId: true, firstName: true, lastName: true },
  });
  if (!profile) return { recorded: false, reason: "not-found" };

  const [branding, programme] = await Promise.all([
    db.tenantBranding.findFirst({ where: {}, select: { timeZone: true } }),
    db.loyaltyProgramme.findFirst({ where: {} }),
  ]);
  const dayStart = startOfDayIn(branding?.timeZone ?? DEFAULT_TIME_ZONE);

  const rows = await rawDb.$queryRaw<{ visitCount: number }[]>`
    UPDATE "CustomerProfile"
    SET "visitCount" = "visitCount" + 1, "lastVisitAt" = NOW(), "updatedAt" = NOW()
    WHERE "id" = ${profile.id} AND "tenantId" = ${profile.tenantId}
      AND ("lastVisitAt" IS NULL OR "lastVisitAt" < ${dayStart})
    RETURNING "visitCount"
  `;
  if (rows.length === 0) return { recorded: false, reason: "already-today" };

  const points = programme?.active ? programme.pointsPerVisit : 0;
  if (points > 0) {
    await adjustLoyaltyPoints(db, { customerProfileId: profile.id, points, type: "EARNED", reason: "Clinic check-in" });
  }
  await recordActivity(db, {
    type: "CHECK_IN",
    customerProfileId: profile.id,
    summary: "Checked in at the clinic",
    points: points || null,
  });
  return { recorded: true, points, visitCount: Number(rows[0]!.visitCount) };
}

export interface ClientMatch {
  customerProfileId: string;
  name: string;
  email: string | null;
}

/**
 * Finds this clinic's clients by name, email or phone for the front desk.
 * Every word has to match somewhere, so "Emma Johnson" finds Emma Johnson —
 * matching the whole phrase against one field at a time never would.
 */
export async function searchClientsForCheckIn(db: TenantDb, query: string): Promise<ClientMatch[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const words = q.split(/\s+/).slice(0, 5);
  const rows = await db.customerProfile.findMany({
    where: {
      user: { status: { not: "DISABLED" } },
      AND: words.map((w) => ({
        OR: [
          { firstName: { contains: w, mode: "insensitive" as const } },
          { lastName: { contains: w, mode: "insensitive" as const } },
          { phone: { contains: w } },
          { user: { email: { contains: w, mode: "insensitive" as const } } },
        ],
      })),
    },
    take: 8,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } },
  });
  return rows.map((r) => ({ customerProfileId: r.id, name: `${r.firstName} ${r.lastName}`.trim(), email: r.user.email }));
}
