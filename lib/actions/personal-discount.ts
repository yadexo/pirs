"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { marketingAudience, marketingWindowFor, sendMarketingCampaign } from "@/lib/marketing";
import { nextSendableTime } from "@/lib/marketing-window";
import { vapidConfigured } from "@/lib/web-push";

/**
 * A discount for one client, given from their record in the dashboard.
 *
 * It is an ordinary Promotion with `customerProfileId` set, so checkout,
 * limits and the shop's struck-through prices all work on it without knowing
 * it is personal. What makes it personal is that nobody else's checkout can
 * ever see it — `candidatesFor` filters on exactly that column.
 *
 * Telling the client is optional and goes through the same marketing gate as
 * everything else: their consent, and the quiet hours. It skips only the daily
 * cap, because a gift addressed to one person is not a mailshot.
 */

const schema = z.object({
  customerProfileId: z.string().min(1),
  percent: z.coerce.number().int().min(1, "Between 1 and 100").max(100, "Between 1 and 100"),
  days: z.coerce.number().int().min(1, "At least a day").max(365, "A year at most"),
  reason: z.string().trim().max(60, "Keep it under 60 characters").optional(),
  notify: z.boolean().default(true),
});

export type PersonalDiscountResult = ActionResult<{ promotionId: string; notified: number; heldUntil: string | null }>;

export async function givePersonalDiscountAction(merchantId: string, input: z.input<typeof schema>): Promise<PersonalDiscountResult> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "promotions.create");
    const data = schema.parse(input);

    // The client must be this clinic's own.
    const client = await rawDb.customerProfile.findFirst({
      where: { id: data.customerProfileId, tenantId: merchantId },
      select: { id: true, firstName: true, userId: true, marketingConsent: true },
    });
    if (!client) throw new ActionError("That client isn't at this clinic.");

    const now = new Date();
    const title = data.reason?.trim() || `${data.percent}% off for ${client.firstName}`;
    const promotion = await rawDb.promotion.create({
      data: {
        tenantId: merchantId,
        title,
        startAt: now,
        endAt: new Date(now.getTime() + data.days * 24 * 60 * 60 * 1000),
        discountType: "PERCENT",
        discountValue: data.percent,
        autoApply: true,
        appOnly: true,
        customerProfileId: client.id,
        perCustomerLimit: 1,
      },
      select: { id: true, endAt: true },
    });

    await ctx.audit("promotion.personal", "Promotion", promotion.id, { customerProfileId: client.id, percent: data.percent, days: data.days });
    revalidatePath(`/m/${merchantId}/clients`);

    if (!data.notify || !vapidConfigured()) return { promotionId: promotion.id, notified: 0, heldUntil: null };

    // Held rather than dropped when it is the middle of the night: the cron
    // job picks the campaign up at nine.
    const sendAt = nextSendableTime(now, await marketingWindowFor(merchantId));
    const tenant = await rawDb.tenant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { slug: true, name: true, branding: { select: { businessName: true } } },
    });
    const clinicName = tenant.branding?.businessName ?? tenant.name;
    const base = `${process.env.CLIENT_APP_URL ? "" : "/app"}/${encodeURIComponent(tenant.slug)}`;

    const campaign = await rawDb.notificationCampaign.create({
      data: {
        tenantId: merchantId,
        name: title,
        channel: "PUSH",
        subject: clinicName,
        body: `${data.percent}% off for you, for the next ${data.days} ${data.days === 1 ? "day" : "days"}. It's applied automatically at checkout.`,
        marketing: true,
        customerProfileId: client.id,
        promotionId: promotion.id,
        scheduledAt: sendAt,
        status: sendAt.getTime() > now.getTime() + 30_000 ? "SCHEDULED" : "SENDING",
      },
      select: { id: true, body: true, subject: true },
    });

    if (sendAt.getTime() > now.getTime() + 30_000) {
      return { promotionId: promotion.id, notified: 0, heldUntil: sendAt.toISOString() };
    }

    const targets = await marketingAudience(merchantId, client.id);
    const result = await sendMarketingCampaign(merchantId, targets, {
      tenantId: merchantId,
      campaignId: campaign.id,
      now,
      exemptFromDailyCap: true,
      message: {
        title: clinicName,
        body: campaign.body,
        url: `${base}/shop`,
        icon: `${base}/app-icon/192.png`,
      },
    });

    await rawDb.notificationCampaign.updateMany({
      where: { id: campaign.id },
      data: { status: "SENT", sentAt: now, devicesReached: result.devices },
    });

    return { promotionId: promotion.id, notified: result.devices, heldUntil: null };
  });
}
