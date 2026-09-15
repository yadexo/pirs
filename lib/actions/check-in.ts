"use server";

import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { requireMerchantAction, runAction, ActionError, type ActionResult } from "@/lib/merchant-action";
import { verifyCheckinToken } from "@/lib/checkin-token";
import { recordVisit, searchClientsForCheckIn } from "@/lib/check-in";
import { startOfDayIn } from "@/lib/zoned-time";
import { DEFAULT_TIME_ZONE } from "@/lib/time-zone";
import type { TenantDb } from "@/lib/tenant-db";

/**
 * Clinic-side check-in. A client shows the signed code on their app's Scan
 * tab; staff scan it (or find the client by name) and confirm. This is the
 * only way a visit is recorded — a client cannot check themselves in.
 */

/** Scanned code or picked from search. A code proves the client is present. */
export type CheckInTarget = { token: string } | { customerProfileId: string };

export interface ClientCard {
  customerProfileId: string;
  name: string;
  email: string | null;
  points: number;
  visits: number;
  membership: string | null;
  checkedInToday: boolean;
  pointsPerVisit: number;
}

async function resolveTarget(db: TenantDb, merchantId: string, target: CheckInTarget): Promise<string> {
  if ("token" in target) {
    const verified = verifyCheckinToken(target.token, merchantId);
    // Expired, forged, or issued by another clinic: all look the same to staff.
    if (!verified) throw new ActionError("This code isn't valid here. Ask the client to open the Scan tab again.");
    return verified.customerProfileId;
  }
  return target.customerProfileId;
}

async function loadCard(db: TenantDb, customerProfileId: string): Promise<ClientCard> {
  const profile = await db.customerProfile.findFirst({
    where: { id: customerProfileId },
    include: {
      user: { select: { email: true, status: true } },
      memberships: { where: { status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "PAUSED"] } }, include: { membershipPlan: { select: { name: true } } }, take: 1 },
    },
  });
  if (!profile || profile.user.status === "DISABLED") throw new ActionError("That client isn't registered at this clinic.");

  const [branding, programme] = await Promise.all([
    db.tenantBranding.findFirst({ where: {}, select: { timeZone: true } }),
    db.loyaltyProgramme.findFirst({ where: {} }),
  ]);
  const dayStart = startOfDayIn(branding?.timeZone ?? DEFAULT_TIME_ZONE);

  return {
    customerProfileId: profile.id,
    name: `${profile.firstName} ${profile.lastName}`.trim(),
    email: profile.user.email,
    points: profile.loyaltyPointsBalance,
    visits: profile.visitCount,
    membership: profile.memberships[0]?.membershipPlan.name ?? null,
    checkedInToday: Boolean(profile.lastVisitAt && profile.lastVisitAt >= dayStart),
    pointsPerVisit: programme?.active ? programme.pointsPerVisit : 0,
  };
}

/** Shows who the code or search result is, before anything is recorded. */
export async function lookupClientForCheckInAction(merchantId: string, target: CheckInTarget): Promise<ActionResult<{ client: ClientCard }>> {
  return runAction(async () => {
    const { db } = await requireMerchantAction(merchantId, "customers.view");
    return { client: await loadCard(db, await resolveTarget(db, merchantId, target)) };
  });
}

/** Finds clients by name, email or phone, for when there is no code to scan. */
export async function searchClientsForCheckInAction(
  merchantId: string,
  query: string,
): Promise<ActionResult<{ results: { customerProfileId: string; name: string; email: string | null }[] }>> {
  return runAction(async () => {
    const { db } = await requireMerchantAction(merchantId, "customers.view");
    return { results: await searchClientsForCheckIn(db, query) };
  });
}

export async function checkInClientAction(
  merchantId: string,
  target: CheckInTarget,
): Promise<ActionResult<{ client: ClientCard; points: number; alreadyToday: boolean }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "customers.view");
    const customerProfileId = await resolveTarget(ctx.db, merchantId, target);
    await loadCard(ctx.db, customerProfileId); // confirms the client belongs here

    const result = await recordVisit(ctx.db, customerProfileId);
    if (!result.recorded && result.reason === "not-found") throw new ActionError("That client isn't registered at this clinic.");

    if (result.recorded) {
      await ctx.audit("client.checked_in", "CustomerProfile", customerProfileId, {
        method: "token" in target ? "scan" : "search",
        points: result.points,
      });
      const tenant = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { slug: true } });
      revalidatePath(`/m/${merchantId}`, "layout");
      if (tenant) revalidatePath(`/app/${tenant.slug}`, "layout");
    }
    return {
      client: await loadCard(ctx.db, customerProfileId),
      points: result.recorded ? result.points : 0,
      alreadyToday: !result.recorded,
    };
  });
}
