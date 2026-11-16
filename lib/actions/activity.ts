"use server";

import { requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { toActivityItem, type ActivityItem } from "@/lib/home-metrics";
import { arg, args, INVALID_REQUEST, validArgs } from "@/lib/action-args";

/** Latest client activity, for the Home feed's polling. */
export async function getActivityFeedAction(merchantId: string): Promise<ActionResult<{ items: ActivityItem[] }>> {
  if (!validArgs(args([arg.id]), [merchantId])) return { error: INVALID_REQUEST };
  return runAction(async () => {
    const { db } = await requireMerchantAction(merchantId, "member");
    const rows = await db.activityEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { customerProfile: { select: { firstName: true, lastName: true } } },
    });
    return { items: rows.map(toActivityItem) };
  });
}
