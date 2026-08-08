import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { getChannelProvider } from "@/lib/providers/notifications";

type Segment = "ALL" | "NEW" | "MEMBERS" | "NON_MEMBERS" | "TAGGED";

async function resolveAudience(db: TenantDb, segment: Segment, segmentTagId: string | null) {
  switch (segment) {
    case "NEW": {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return db.customerProfile.findMany({ where: { createdAt: { gte: cutoff } } });
    }
    case "MEMBERS":
      return db.customerProfile.findMany({ where: { memberships: { some: { status: "ACTIVE" } } } });
    case "NON_MEMBERS":
      return db.customerProfile.findMany({ where: { memberships: { none: { status: "ACTIVE" } } } });
    case "TAGGED":
      return segmentTagId ? db.customerProfile.findMany({ where: { tags: { some: { tagId: segmentTagId } } } }) : [];
    default:
      return db.customerProfile.findMany({});
  }
}

/** Sends (or simulates sending, for mock channels) a notification campaign to its target segment. */
export async function sendCampaign(db: TenantDb, campaignId: string) {
  const campaign = await db.notificationCampaign.findFirst({ where: { id: campaignId } });
  if (!campaign) throw new Error("Campaign not found.");

  const audience = await resolveAudience(db, campaign.segment, campaign.segmentTagId);
  const provider = campaign.channel === "IN_APP" ? null : getChannelProvider(campaign.channel);

  for (const customer of audience) {
    if (campaign.channel === "IN_APP") {
      await db.notification.create({
        data: {
          customerProfileId: customer.id,
          title: campaign.subject ?? campaign.name,
          body: campaign.body,
          type: "PROMOTION",
          campaignId: campaign.id,
        } as never,
      });
      await db.notificationDelivery.create({
        data: { campaignId: campaign.id, customerProfileId: customer.id, channel: "IN_APP", status: "DELIVERED", deliveredAt: new Date() } as never,
      });
      continue;
    }

    if (campaign.channel === "EMAIL" && !customer.emailConsent) continue;
    if (campaign.channel === "SMS" && !customer.smsConsent) continue;
    if (campaign.channel === "PUSH" && !customer.pushConsent) continue;

    const to = campaign.channel === "EMAIL" ? "customer@example.com" : customer.phone ?? "";
    const result = await provider!.send({ to, subject: campaign.subject ?? undefined, body: campaign.body });

    await db.notificationDelivery.create({
      data: {
        campaignId: campaign.id,
        customerProfileId: customer.id,
        channel: campaign.channel,
        status: result.status === "SENT" ? "SENT" : "FAILED",
        providerMessageId: result.providerMessageId,
        error: result.error,
        sentAt: result.status === "SENT" ? new Date() : undefined,
      } as never,
    });
  }

  await db.notificationCampaign.updateMany({
    where: { id: campaignId },
    data: { status: "SENT", sentAt: new Date() },
  });

  return { audienceSize: audience.length };
}
