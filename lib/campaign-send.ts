import "server-only";
import { rawDb } from "@/lib/db";
import { marketingAudience, sendMarketingCampaign } from "@/lib/marketing";

/**
 * Sending one stored campaign, wherever it was created from.
 *
 * The offer form, the notifications settings and the cron job all end up
 * here, so there is one path to the push service and one set of rules in
 * front of it — the gate in lib/marketing.ts. A second sender would be a
 * second place for consent and quiet hours to be forgotten.
 */

export interface CampaignSendOutcome {
  devices: number;
  clients: number;
  /** Set when the campaign was dropped instead of sent, with the reason. */
  cancelled: "offer-inactive" | "offer-ended" | null;
}

/**
 * Why the clients who didn't get it didn't get it, in the clinic's words.
 * "0 devices" on its own is the kind of answer that costs someone an evening.
 */
export function describeOutcome(counts: { "no-consent": number; "already-today": number; "quiet-hours": number; "no-devices": number }): string | null {
  const parts: string[] = [];
  const clients = (n: number) => `${n} ${n === 1 ? "client" : "clients"}`;
  if (counts["no-consent"] > 0) parts.push(`${clients(counts["no-consent"])}: offers and promotions off`);
  if (counts["already-today"] > 0) parts.push(`${clients(counts["already-today"])}: daily limit reached`);
  if (counts["quiet-hours"] > 0) parts.push(`${clients(counts["quiet-hours"])}: outside your sending hours`);
  if (counts["no-devices"] > 0) parts.push(`${clients(counts["no-devices"])}: no notifications turned on`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The link a notification opens: the offer's product, or the shop. */
export function campaignPath(productId: string | null): string {
  return productId ? `/shop?product=${encodeURIComponent(productId)}` : "/shop";
}

export function clinicBase(slug: string): string {
  return `${process.env.CLIENT_APP_URL ? "" : "/app"}/${encodeURIComponent(slug)}`;
}

/**
 * An offer's notification is only worth sending while the offer is worth
 * having. A clinic that switches an offer off, or lets it end, should not
 * have yesterday's plan arrive on its clients' phones tomorrow.
 */
export function promotionStillWorthAnnouncing(
  promotion: { active: boolean; endAt: Date } | null,
  now: Date,
): { ok: true } | { ok: false; reason: "offer-inactive" | "offer-ended" } {
  if (!promotion) return { ok: true }; // not about an offer at all
  if (!promotion.active) return { ok: false, reason: "offer-inactive" };
  if (promotion.endAt.getTime() <= now.getTime()) return { ok: false, reason: "offer-ended" };
  return { ok: true };
}

/**
 * Sends a campaign that is already stored, and records what happened to it.
 * Returns the devices reached, or the reason it was cancelled instead.
 */
export async function sendCampaignNow(campaignId: string, now: Date = new Date()): Promise<CampaignSendOutcome> {
  const campaign = await rawDb.notificationCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: {
      id: true,
      tenantId: true,
      subject: true,
      body: true,
      customerProfileId: true,
      ignoreDailyLimit: true,
      productId: true,
      promotion: { select: { active: true, endAt: true } },
      tenant: { select: { slug: true, name: true, branding: { select: { businessName: true } } } },
    },
  });

  const worth = promotionStillWorthAnnouncing(campaign.promotion, now);
  if (!worth.ok) {
    await rawDb.notificationCampaign.updateMany({
      where: { id: campaign.id },
      data: {
        status: "CANCELLED",
        outcomeNote: worth.reason === "offer-ended" ? "Cancelled: the offer had ended by send time" : "Cancelled: the offer was not active at send time",
      },
    });
    return { devices: 0, clients: 0, cancelled: worth.reason };
  }

  const clinicName = campaign.tenant.branding?.businessName ?? campaign.tenant.name;
  const base = clinicBase(campaign.tenant.slug);

  const targets = await marketingAudience(campaign.tenantId, campaign.customerProfileId);
  const result = await sendMarketingCampaign(campaign.tenantId, targets, {
    tenantId: campaign.tenantId,
    campaignId: campaign.id,
    now,
    // A notification addressed to one client about their own offer is not a
    // mailshot, so it doesn't spend the clinic's daily allowance for them.
    // A message addressed to one client is about their own thing, and a
    // clinic can mark one message as worth reaching everyone. Either way the
    // client's consent and the sending hours still decide.
    exemptFromDailyCap: Boolean(campaign.customerProfileId) || campaign.ignoreDailyLimit,
    message: {
      title: campaign.subject?.trim() || clinicName,
      body: campaign.body,
      url: `${base}${campaignPath(campaign.productId)}`,
      icon: `${base}/app-icon/192.png`,
    },
  });

  await rawDb.notificationCampaign.updateMany({
    where: { id: campaign.id },
    data: {
      status: "SENT",
      sentAt: now,
      devicesReached: result.devices,
      // Kept per reason, so the dashboard can say why rather than showing a
      // bare zero.
      skippedNoConsent: result.skipped["no-consent"],
      skippedDailyCap: result.skipped["already-today"],
      skippedOutsideHours: result.skipped["quiet-hours"],
      skippedNoDevices: result.skipped["no-devices"],
      outcomeNote: describeOutcome(result.skipped),
    },
  });

  return { devices: result.devices, clients: result.clients, cancelled: null };
}
