import "server-only";
import { rawDb } from "@/lib/db";
import { formatWindowTime, isWithinWindow, localDayAndMonth, localYear, windowFrom } from "@/lib/marketing-window";
import { marketingWindowFor, sendMarketingTo } from "@/lib/marketing";
import { sendCampaignNow } from "@/lib/campaign-send";

/**
 * The scheduled half of marketing: campaigns whose time has come, and today's
 * birthdays.
 *
 * Written for a scheduler that calls it every few minutes and sometimes twice
 * at once. Nothing here assumes it is the only run:
 *
 * - A campaign is claimed with a conditional update from SCHEDULED to SENDING.
 *   Two runs race, one wins, the loser sees no rows and moves on.
 * - A birthday greeting is guarded by a unique row per client per year, so the
 *   second attempt fails on the constraint instead of sending twice.
 * - Anything due during the quiet hours is left alone until 09:00 rather than
 *   being sent late at night.
 */

export interface MarketingRunResult extends Record<string, number | string> {
  campaigns: number;
  campaignDevices: number;
  birthdays: number;
  birthdayDevices: number;
  heldForQuietHours: number;
}

/** How far back to look — a campaign missed while the scheduler was down still goes. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

function clinicPath(slug: string, rest = ""): string {
  const short = Boolean(process.env.CLIENT_APP_URL);
  return `${short ? "" : "/app"}/${encodeURIComponent(slug)}${rest}`;
}

async function sendDueCampaigns(now: Date): Promise<{ campaigns: number; devices: number; held: number }> {
  const due = await rawDb.notificationCampaign.findMany({
    where: {
      status: "SCHEDULED",
      channel: "PUSH",
      scheduledAt: { lte: now, gte: new Date(now.getTime() - LOOKBACK_MS) },
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      subject: true,
      body: true,
      marketing: true,
      customerProfileId: true,
      promotionId: true,
      productId: true,
      tenant: { select: { slug: true, name: true, branding: { select: { businessName: true } } } },
    },
    take: 50,
  });

  let campaigns = 0;
  let devices = 0;
  let held = 0;

  for (const campaign of due) {
    // Marketing waits for the clinic's own sending window; a service
    // campaign does not.
    if (campaign.marketing && !isWithinWindow(now, await marketingWindowFor(campaign.tenantId))) {
      const window = await marketingWindowFor(campaign.tenantId);
      // Say so on the campaign itself: a clinic watching a scheduled message
      // sit there deserves to know it is waiting, not broken.
      await rawDb.notificationCampaign.updateMany({
        where: { id: campaign.id, status: "SCHEDULED" },
        data: { outcomeNote: `Waiting until ${formatWindowTime(window.startMinutes)} — outside your sending hours` },
      });
      held += 1;
      continue;
    }

    // Claim it. Only one run can move it out of SCHEDULED.
    const claimed = await rawDb.notificationCampaign.updateMany({
      where: { id: campaign.id, status: "SCHEDULED" },
      data: { status: "SENDING" },
    });
    if (claimed.count === 0) continue;

    try {
      // One sender for every path — it also drops the notification when the
      // offer it announces has been switched off or has ended.
      const result = await sendCampaignNow(campaign.id, now);
      if (result.cancelled) continue;
      campaigns += 1;
      devices += result.devices;
    } catch (err) {
      // Put it back so the next run tries again rather than losing it.
      await rawDb.notificationCampaign.updateMany({ where: { id: campaign.id, status: "SENDING" }, data: { status: "SCHEDULED" } });
      console.error(`[cron:marketing] campaign ${campaign.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  return { campaigns, devices, held };
}

async function sendBirthdayGreetings(now: Date): Promise<{ greetings: number; devices: number; held: number }> {
  const clinics = await rawDb.tenantSettings.findMany({
    where: { birthdayMessageEnabled: true },
    select: {
      tenantId: true,
      birthdayMessage: true,
      birthdayDiscountPercent: true,
      birthdayDiscountDays: true,
      marketingWindowStartMinutes: true,
      marketingWindowEndMinutes: true,
      tenant: { select: { slug: true, name: true, status: true, branding: { select: { businessName: true, timeZone: true } } } },
    },
  });

  let greetings = 0;
  let devices = 0;
  let held = 0;

  for (const clinic of clinics) {
    if (clinic.tenant.status !== "ACTIVE") continue;

    // A greeting goes out when this clinic's window opens, in this clinic's
    // timezone — so "today" and "the morning" are both the clinic's own.
    const window = windowFrom(clinic, clinic.tenant.branding?.timeZone);
    if (!isWithinWindow(now, window)) {
      held += 1;
      continue;
    }
    const { day, month } = localDayAndMonth(now, window.timeZone);
    const year = localYear(now, window.timeZone);

    // Postgres can't index "same day and month", so the day is matched here.
    // Clinics have thousands of clients, not millions; this stays cheap.
    const withBirthdays = await rawDb.customerProfile.findMany({
      where: {
        tenantId: clinic.tenantId,
        dateOfBirth: { not: null },
        marketingConsent: true,
        user: { status: "ACTIVE", pushSubscriptions: { some: {} } },
        birthdayGreetings: { none: { year } },
      },
      select: { id: true, userId: true, firstName: true, marketingConsent: true, dateOfBirth: true },
      take: 2000,
    });

    const clinicName = clinic.tenant.branding?.businessName ?? clinic.tenant.name;

    for (const client of withBirthdays) {
      const dob = client.dateOfBirth!;
      // Stored as a date with no meaningful time; read it in UTC so a clinic
      // in any timezone sees the day the client typed.
      if (dob.getUTCDate() !== day || dob.getUTCMonth() + 1 !== month) continue;

      // The unique row is the once-a-year guarantee. Written first: if the
      // push then fails, the client gets no message this year rather than one
      // every five minutes until it succeeds.
      let promotionId: string | null = null;
      try {
        if (clinic.birthdayDiscountPercent > 0) {
          const endAt = new Date(now.getTime() + Math.max(1, clinic.birthdayDiscountDays) * 24 * 60 * 60 * 1000);
          const promotion = await rawDb.promotion.create({
            data: {
              tenantId: clinic.tenantId,
              title: `Happy birthday, ${client.firstName}`,
              startAt: now,
              endAt,
              discountType: "PERCENT",
              discountValue: clinic.birthdayDiscountPercent,
              autoApply: true,
              customerProfileId: client.id,
              perCustomerLimit: 1,
              appOnly: true,
            },
            select: { id: true },
          });
          promotionId = promotion.id;
        }

        await rawDb.birthdayGreeting.create({
          data: { tenantId: clinic.tenantId, customerProfileId: client.id, year, promotionId },
        });
      } catch {
        // Unique violation: another run got there first this year.
        continue;
      }

      const body =
        clinic.birthdayMessage?.trim() ||
        (clinic.birthdayDiscountPercent > 0
          ? `Happy birthday! Here's ${clinic.birthdayDiscountPercent}% off from us.`
          : "Happy birthday from all of us!");

      const outcome = await sendMarketingTo(
        { customerProfileId: client.id, userId: client.userId, marketingConsent: client.marketingConsent },
        {
          tenantId: clinic.tenantId,
          now,
          // Already read for this clinic; no need to fetch it per client.
          window,
          // Their birthday shouldn't be swallowed by the day's general cap.
          exemptFromDailyCap: true,
          message: {
            title: clinicName,
            body,
            url: clinicPath(clinic.tenant.slug, "/shop"),
            icon: clinicPath(clinic.tenant.slug, "/app-icon/192.png"),
          },
        },
      );

      greetings += 1;
      devices += outcome.sent;
    }
  }

  return { greetings, devices, held };
}

/**
 * Everything the scheduler runs. Safe to call every five minutes, twice at
 * once, or once a day after an outage.
 */
export async function runMarketing(now: Date = new Date()): Promise<MarketingRunResult> {
  const campaigns = await sendDueCampaigns(now);
  const birthdays = await sendBirthdayGreetings(now);

  return {
    campaigns: campaigns.campaigns,
    campaignDevices: campaigns.devices,
    birthdays: birthdays.greetings,
    birthdayDevices: birthdays.devices,
    heldForQuietHours: campaigns.held + birthdays.held,
  };
}
