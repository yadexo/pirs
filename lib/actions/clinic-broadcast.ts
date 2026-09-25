"use server";

import { z } from "zod";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { rateLimit } from "@/lib/rate-limit";
import { sendToClinicClients, vapidConfigured } from "@/lib/web-push";

/**
 * A clinic sending one notification to its own clients' devices.
 *
 * "Its own" is not a filter the caller passes: the tenant comes from the
 * session, and the send reads subscriptions by that tenant id, so there is no
 * argument a clinic could change to reach someone else's clients.
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

    const tenant = await rawDb.tenant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { slug: true, name: true, branding: { select: { businessName: true } } },
    });

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

    const short = Boolean(process.env.CLIENT_APP_URL);
    const base = `${short ? "" : "/app"}/${encodeURIComponent(tenant.slug)}`;

    const result = await sendToClinicClients(merchantId, {
      title: input.title,
      body: input.body,
      url: `${base}${path}`,
      icon: `${base}/app-icon/192.png`,
    });

    await ctx.audit("notifications.broadcast", "Tenant", merchantId, {
      title: input.title,
      devices: result.sent,
      removed: result.removed,
    });

    return { devices: result.sent };
  });
}
