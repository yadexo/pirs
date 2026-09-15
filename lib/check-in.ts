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
