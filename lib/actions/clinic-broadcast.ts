"use server";

import { z } from "zod";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { rateLimit } from "@/lib/rate-limit";
import { vapidConfigured } from "@/lib/web-push";
import { marketingAudience, sendMarketingCampaign } from "@/lib/marketing";
import { describeOutcome } from "@/lib/campaign-send";

/**
 * A clinic sending one notification to its own clients' devices.
 *
 * "Its own" is not a filter the caller passes: the tenant comes from the
 * session, and the audience is read by that tenant id, so there is no
 * argument a clinic could change to reach someone else's clients. And "its
 * clients" means the ones who asked for offers — see the send below.
 *
 * Rate limited per clinic rather than per user — the limit protects clients
 * from being messaged twenty times in an afternoon, and staff share it.
 */

const BROADCASTS_PER_HOUR = 5;

const schema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(60, "Keep the title under 60 characters"),
  body: z.string().trim().min(1, "Write a message").max(200, "Keep the message under 200 characters"),
  /** Optional product to open — a product of this clinic, checked below. */
  productId: z.string().trim().max(60).optional(),
});

export async function sendClinicBroadcastAction(merchantId: string, fd: FormData): Promise<ActionResult<{ devices: number }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "messages.send");
    if (!vapidConfigured()) throw new ActionError("Push notifications aren't set up on this platform yet.");

    const input = schema.parse({
      title: fd.get("title"),
      body: fd.get("body"),
      productId: fd.get("productId") || undefined,
    });

    const limit = await rateLimit(`broadcast:${merchantId}`, BROADCASTS_PER_HOUR, 60 * 60 * 1000);
    if (!limit.ok) {
      throw new ActionError(`That's ${BROADCASTS_PER_HOUR} messages this hour, which is the limit. Try again later.`);
    }

    // Still read, as the check that this clinic exists at all before anything
    // is sent on its behalf. Nothing is taken from it any more: the paths in
    // the message are relative to the clinic's app, so its slug is no longer
    // needed here.
    await rawDb.tenant.findUniqueOrThrow({ where: { id: merchantId }, select: { id: true } });

    // A product id from the form is checked against this clinic's own
    // products, so a link can never point into another clinic's shop.
    let path = "/shop";
    if (input.productId) {
      const product = await rawDb.product.findFirst({
        where: { id: input.productId, tenantId: merchantId, active: true },
        select: { id: true },
      });
      if (!product) throw new ActionError("That product isn't available any more, so the link was left off.");
      path = `/shop?product=${encodeURIComponent(product.id)}`;
    }

    // A message a clinic writes to all its clients is marketing, so it goes
    // the way all marketing goes (lib/marketing.ts): only to clients who have
    // offers switched on, only inside the clinic's sending hours, and within
    // the daily limit. It used to go straight to every device the clinic had,
    // whatever its owner had chosen and whatever the hour
    // (docs/security/review-2026-11.md, N-1).
    const audience = await marketingAudience(merchantId);
    const result = await sendMarketingCampaign(merchantId, audience, {
      tenantId: merchantId,
      // Clinic-relative: lib/web-push.ts adds each device's own prefix.
      message: { title: input.title, body: input.body, url: path, icon: "/app-icon/192.png" },
    });

    await ctx.audit("notifications.broadcast", "Tenant", merchantId, {
      title: input.title,
      devices: result.devices,
      clients: result.clients,
      skipped: result.skipped,
    });

    // Nobody got it: say why, rather than "sent to 0 devices".
    if (result.clients === 0) {
      const why = describeOutcome(result.skipped);
      throw new ActionError(why ? `Nobody was sent this. ${why}.` : "Nobody was sent this: no client has both offers and notifications turned on.");
    }

    return { devices: result.devices };
  });
}
