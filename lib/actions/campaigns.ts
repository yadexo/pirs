"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { rateLimit } from "@/lib/rate-limit";
import { sendCampaignNow } from "@/lib/campaign-send";
import { marketingWindowFor } from "@/lib/marketing";
import { instantFromLocal, nextSendableTime } from "@/lib/marketing-window";
import { vapidConfigured } from "@/lib/web-push";

/**
 * A clinic's own messages to its clients: send now, or schedule for later.
 *
 * Both paths write a NotificationCampaign, so "sent" and "scheduled" are the
 * same list and the same history. The cron job sends the scheduled ones; this
 * file only ever sends the immediate kind, and even then through the same gate
 * — consent, quiet hours, one a day.
 *
 * The clinic comes from the session. There is no argument here that could
 * point a campaign at another clinic's clients.
 */

const CAMPAIGNS_PER_HOUR = 5;

const schema = z
  .object({
    title: z.string().trim().min(1, "Give it a title").max(60, "Keep the title under 60 characters"),
    body: z.string().trim().min(1, "Write a message").max(200, "Keep the message under 200 characters"),
    productId: z.string().trim().max(60).optional(),
    promotionId: z.string().trim().max(60).optional(),
    /** Empty means now. */
    scheduledAt: z.string().trim().max(40).optional(),
    /** Set to send to one client instead of everyone. */
    customerProfileId: z.string().trim().max(60).optional(),
  });

/** Checks a product or promotion belongs to this clinic before linking to it. */
async function ownedLinks(merchantId: string, productId?: string, promotionId?: string) {
  const [product, promotion] = await Promise.all([
    productId ? rawDb.product.findFirst({ where: { id: productId, tenantId: merchantId, active: true }, select: { id: true } }) : null,
    promotionId ? rawDb.promotion.findFirst({ where: { id: promotionId, tenantId: merchantId }, select: { id: true } }) : null,
  ]);
  if (productId && !product) throw new ActionError("That product isn't available any more.");
  if (promotionId && !promotion) throw new ActionError("That discount no longer exists.");
  return { productId: product?.id ?? null, promotionId: promotion?.id ?? null };
}

export type CampaignResult = ActionResult<{ id: string; devices: number; scheduledFor: string | null; heldUntil: string | null }>;

export async function saveCampaignAction(merchantId: string, input: z.input<typeof schema>): Promise<CampaignResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "messages.send");
    if (!vapidConfigured()) throw new ActionError("Push notifications aren't set up on this platform yet.");

    const data = schema.parse(input);
    const links = await ownedLinks(merchantId, data.productId || undefined, data.promotionId || undefined);

    // One client's own message is checked against this clinic's clients.
    let customerProfileId: string | null = null;
    if (data.customerProfileId) {
      const client = await rawDb.customerProfile.findFirst({
        where: { id: data.customerProfileId, tenantId: merchantId },
        select: { id: true },
      });
      if (!client) throw new ActionError("That client isn't at this clinic.");
      customerProfileId = client.id;
    }

    const limit = await rateLimit(`campaign:${merchantId}`, CAMPAIGNS_PER_HOUR, 60 * 60 * 1000);
    if (!limit.ok) throw new ActionError(`That's ${CAMPAIGNS_PER_HOUR} messages this hour, which is the limit. Try again later.`);

    const now = new Date();
    const window = await marketingWindowFor(merchantId);
    // A wall clock typed by the clinic means the clinic's own time — not
    // the server's, which in production is UTC.
    let wanted = now;
    if (data.scheduledAt) {
      const picked = instantFromLocal(data.scheduledAt, window.timeZone);
      if (!picked) throw new ActionError("That isn't a date and time.");
      if (picked.getTime() < now.getTime() - 60_000) throw new ActionError("That time has already passed.");
      wanted = picked;
    }
    // Quiet hours move a send rather than refusing it, so a clinic scheduling
    // something for 22:00 gets it at 09:00 instead of silence.
    const when = nextSendableTime(wanted, window);
    const later = when.getTime() > now.getTime() + 30_000;

    const campaign = await rawDb.notificationCampaign.create({
      data: {
        tenantId: merchantId,
        name: data.title,
        channel: "PUSH",
        subject: data.title,
        body: data.body,
        marketing: true,
        customerProfileId,
        productId: links.productId,
        promotionId: links.promotionId,
        scheduledAt: when,
        status: later ? "SCHEDULED" : "SENDING",
      },
      select: { id: true },
    });

    if (later) {
      await ctx.audit("campaign.scheduled", "NotificationCampaign", campaign.id, { title: data.title, when: when.toISOString() });
      revalidatePath(`/m/${merchantId}/app-builder`);
      return { id: campaign.id, devices: 0, scheduledFor: when.toISOString(), heldUntil: wanted.getTime() !== when.getTime() ? when.toISOString() : null };
    }

    const result = await sendCampaignNow(campaign.id, now);
    await ctx.audit("campaign.sent", "NotificationCampaign", campaign.id, { title: data.title, devices: result.devices });
    revalidatePath(`/m/${merchantId}/app-builder`);

    return { id: campaign.id, devices: result.devices, scheduledFor: null, heldUntil: null };
  });
}

/** Calls off something that hasn't gone out yet. A sent message can't be unsent. */
export async function cancelCampaignAction(merchantId: string, campaignId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "messages.send");
    const { count } = await rawDb.notificationCampaign.updateMany({
      where: { id: campaignId, tenantId: merchantId, status: "SCHEDULED" },
      data: { status: "CANCELLED" },
    });
    if (count === 0) throw new ActionError("That message has already gone out, or was cancelled.");
    await ctx.audit("campaign.cancelled", "NotificationCampaign", campaignId, {});
    revalidatePath(`/m/${merchantId}/app-builder`);
    return {};
  });
}
