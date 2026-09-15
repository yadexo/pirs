import "server-only";
import type { ActivityType } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";

/**
 * Records something a client did, for the clinic's Live Activity Feed.
 * Never allowed to break the action it describes: a failed write is logged
 * and swallowed, because the booking or payment already happened.
 */
export async function recordActivity(
  db: TenantDb,
  event: { type: ActivityType; summary: string; customerProfileId?: string | null; amountCents?: number | null; points?: number | null },
): Promise<void> {
  try {
    await db.activityEvent.create({
      data: {
        type: event.type,
        summary: event.summary.slice(0, 200),
        customerProfileId: event.customerProfileId ?? null,
        amountCents: event.amountCents ?? null,
        points: event.points ?? null,
      } as never,
    });
  } catch (err) {
    console.error("[activity] could not record", event.type, err);
  }
}
