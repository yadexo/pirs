import "server-only";
import { rawDb } from "@/lib/db";
import { localDayRange, nextSendableTime } from "@/lib/marketing-window";
import { notifyClientQuietly, sendToClient, type PushMessage } from "@/lib/web-push";

/**
 * Sending marketing to clients, with the rules that make it bearable.
 *
 * Everything promotional goes through `sendMarketingTo`. It refuses, quietly
 * and per client, when the client has offers switched off, when the hour is
 * unsociable, or when this clinic has already sent them something today. A
 * clinic cannot opt out of those checks by calling something else: the plain
 * senders in lib/web-push.ts are for service messages, and this is the only
 * path the campaign and birthday code uses.
 *
 * Every send is written to NotificationDelivery — which is both the record a
 * clinic reads back and the thing the daily cap counts.
 */

export type MarketingSkip = "no-consent" | "quiet-hours" | "already-today" | "no-devices";

export interface MarketingOutcome {
  sent: number;
  skipped: MarketingSkip | null;
}

export interface MarketingTarget {
  customerProfileId: string;
  userId: string;
  marketingConsent: boolean;
}

interface SendOptions {
  tenantId: string;
  campaignId?: string | null;
  message: PushMessage;
  now?: Date;
  /**
   * Birthdays and personal discounts are addressed to one client about their
   * own thing, so they don't spend the daily allowance for the clinic's
   * general marketing. Consent and quiet hours still apply.
   */
  exemptFromDailyCap?: boolean;
}

/** Has this clinic already sent this client something promotional today? */
export async function alreadySentToday(tenantId: string, customerProfileId: string, now: Date): Promise<boolean> {
  const { start, end } = localDayRange(now);
  const count = await rawDb.notificationDelivery.count({
    where: {
      tenantId,
      customerProfileId,
      channel: "PUSH",
      status: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED"] },
      sentAt: { gte: start, lt: end },
      // Only campaign-backed deliveries are marketing; service messages write
      // no delivery row at all, so they can't use up the allowance.
      campaignId: { not: null },
    },
  });
  return count > 0;
}

/**
 * One marketing message to one client, if all three rules allow it.
 *
 * Returns why it didn't send rather than throwing: a campaign to 400 clients
 * skips some of them by design, and that is a normal result, not an error.
 */
export async function sendMarketingTo(target: MarketingTarget, options: SendOptions): Promise<MarketingOutcome> {
  const now = options.now ?? new Date();

  // The client's own switch comes first: no consent, no message, whatever the
  // clinic scheduled.
  if (!target.marketingConsent) return { sent: 0, skipped: "no-consent" };

  // Quiet hours are checked at the moment of sending, not when scheduled — a
  // job that runs late must not deliver at 23:00 because 20:55 was fine.
  if (nextSendableTime(now).getTime() !== now.getTime()) return { sent: 0, skipped: "quiet-hours" };

  if (!options.exemptFromDailyCap && (await alreadySentToday(options.tenantId, target.customerProfileId, now))) {
    return { sent: 0, skipped: "already-today" };
  }

  const result = await sendToClient(target.userId, options.message);
  if (result.sent === 0) return { sent: 0, skipped: "no-devices" };

  await rawDb.notificationDelivery.create({
    data: {
      tenantId: options.tenantId,
      campaignId: options.campaignId ?? null,
      customerProfileId: target.customerProfileId,
      channel: "PUSH",
      status: "SENT",
      sentAt: now,
    },
  });

  return { sent: result.sent, skipped: null };
}

/** Everyone a clinic may market to: its own clients, with a device and consent. */
export async function marketingAudience(tenantId: string, customerProfileId?: string | null): Promise<MarketingTarget[]> {
  const profiles = await rawDb.customerProfile.findMany({
    where: {
      tenantId,
      ...(customerProfileId ? { id: customerProfileId } : {}),
      marketingConsent: true,
      user: { status: "ACTIVE", pushSubscriptions: { some: {} } },
    },
    select: { id: true, userId: true, marketingConsent: true },
    take: 5000,
  });
  return profiles.map((p) => ({ customerProfileId: p.id, userId: p.userId, marketingConsent: p.marketingConsent }));
}

export interface CampaignSendResult {
  devices: number;
  clients: number;
  skipped: Record<MarketingSkip, number>;
}

/** Sends one message to a whole audience, counting what happened to each. */
export async function sendMarketingCampaign(
  tenantId: string,
  targets: MarketingTarget[],
  options: SendOptions,
): Promise<CampaignSendResult> {
  const skipped: Record<MarketingSkip, number> = { "no-consent": 0, "quiet-hours": 0, "already-today": 0, "no-devices": 0 };
  let devices = 0;
  let clients = 0;

  for (const target of targets) {
    const outcome = await sendMarketingTo(target, { ...options, tenantId });
    if (outcome.skipped) skipped[outcome.skipped] += 1;
    else {
      devices += outcome.sent;
      clients += 1;
    }
  }

  return { devices, clients, skipped };
}

/**
 * A service message: an order, a refund, a redemption. No consent check, no
 * quiet hours, no cap — the client caused it and is waiting for it.
 */
export async function sendServiceMessage(userId: string, message: PushMessage): Promise<void> {
  await notifyClientQuietly(userId, message);
}
