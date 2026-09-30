/**
 * Why a clinic's notifications did or didn't arrive. Reads only.
 *
 *   npx tsx prisma/push-debug.ts --clinic testclinic2
 *
 * Prints, for each client: whether they agreed to notifications and to
 * offers, how many devices they have, and what this clinic has already sent
 * them today — which is what the daily cap counts. Then the last ten
 * campaigns, with their times in UTC and in the clinic's own zone side by
 * side, because a two-hour gap between those two is the shape of a timezone
 * bug.
 */
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { formatWindowTime, localDayRange, localInputValue, windowFrom } from "../lib/marketing-window";
import { AdminSetupError, arg, describeDatabase, exitWith } from "./admin-cli";

export interface PushDebugReport {
  clinic: string;
  timeZone: string;
  window: string;
  vapidConfigured: boolean;
  clients: {
    name: string;
    email: string;
    pushConsent: boolean;
    marketingConsent: boolean;
    devices: number;
    deliveriesToday: number;
  }[];
  campaigns: {
    name: string;
    status: string;
    scheduledUtc: string | null;
    scheduledLocal: string | null;
    sentUtc: string | null;
    devicesReached: number;
    note: string | null;
  }[];
}

export async function pushDebug(db: PrismaClient, clinicSlug: string, now = new Date()): Promise<PushDebugReport> {
  const slug = clinicSlug.trim().toLowerCase();
  const clinic = await db.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true, branding: { select: { timeZone: true } } },
  });
  if (!clinic) throw new AdminSetupError(`There is no clinic with the address "${slug}".`);

  const settings = await db.tenantSettings.findFirst({
    where: { tenantId: clinic.id },
    select: { marketingWindowStartMinutes: true, marketingWindowEndMinutes: true },
  });
  const window = windowFrom(settings, clinic.branding?.timeZone);
  const { start, end } = localDayRange(now, window.timeZone);

  const profiles = await db.customerProfile.findMany({
    where: { tenantId: clinic.id },
    select: {
      firstName: true,
      lastName: true,
      marketingConsent: true,
      pushConsent: true,
      user: { select: { email: true, status: true, _count: { select: { pushSubscriptions: true } } } },
      _count: { select: { notificationDeliveries: { where: { sentAt: { gte: start, lt: end }, channel: "PUSH" } } } },
    },
    orderBy: { firstName: "asc" },
    take: 200,
  });

  const campaigns = await db.notificationCampaign.findMany({
    where: { tenantId: clinic.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      name: true,
      status: true,
      scheduledAt: true,
      sentAt: true,
      devicesReached: true,
      outcomeNote: true,
      skippedNoConsent: true,
      skippedDailyCap: true,
      skippedOutsideHours: true,
      skippedNoDevices: true,
    },
  });

  return {
    clinic: clinic.name,
    timeZone: window.timeZone,
    window: `${formatWindowTime(window.startMinutes)}–${formatWindowTime(window.endMinutes)}`,
    vapidConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT),
    clients: profiles.map((p) => ({
      name: `${p.firstName} ${p.lastName}`.trim(),
      email: p.user?.email ?? "(no login)",
      pushConsent: p.pushConsent,
      marketingConsent: p.marketingConsent,
      devices: p.user?._count.pushSubscriptions ?? 0,
      deliveriesToday: p._count.notificationDeliveries,
    })),
    campaigns: campaigns.map((c) => ({
      name: c.name,
      status: c.status,
      scheduledUtc: c.scheduledAt?.toISOString() ?? null,
      scheduledLocal: c.scheduledAt ? localInputValue(c.scheduledAt, window.timeZone) : null,
      sentUtc: c.sentAt?.toISOString() ?? null,
      devicesReached: c.devicesReached,
      note:
        c.outcomeNote ??
        (c.skippedNoConsent + c.skippedDailyCap + c.skippedOutsideHours + c.skippedNoDevices > 0
          ? `skipped — consent ${c.skippedNoConsent}, daily cap ${c.skippedDailyCap}, hours ${c.skippedOutsideHours}, no devices ${c.skippedNoDevices}`
          : null),
    })),
  };
}

function print(report: PushDebugReport, now: Date) {
  const yesNo = (v: boolean) => (v ? "yes" : "no ");
  console.log(`\n${report.clinic}`);
  console.log(`Timezone:       ${report.timeZone}  (now ${localInputValue(now, report.timeZone)} there, ${now.toISOString()} UTC)`);
  console.log(`Sending hours:  ${report.window}`);
  console.log(`VAPID keys set: ${report.vapidConfigured ? "yes" : "NO — nothing can be sent"}`);

  console.log(`\nClients (${report.clients.length})`);
  console.log("  push  offers  devices  sent today  who");
  for (const c of report.clients) {
    console.log(`  ${yesNo(c.pushConsent)}   ${yesNo(c.marketingConsent)}     ${String(c.devices).padStart(3)}      ${String(c.deliveriesToday).padStart(3)}       ${c.name} <${c.email}>`);
  }
  const reachable = report.clients.filter((c) => c.marketingConsent && c.devices > 0);
  console.log(`\n${reachable.length} of ${report.clients.length} can receive marketing right now.`);
  const capped = reachable.filter((c) => c.deliveriesToday > 0);
  if (capped.length > 0) {
    console.log(`${capped.length} of those already had something today, so the daily cap will skip them until midnight ${report.timeZone}.`);
  }

  console.log(`\nLast ${report.campaigns.length} campaigns`);
  for (const c of report.campaigns) {
    console.log(`  ${c.status.padEnd(9)} ${c.name}`);
    if (c.scheduledUtc) console.log(`            scheduled ${c.scheduledUtc} UTC  =  ${c.scheduledLocal} ${report.timeZone}`);
    if (c.sentUtc) console.log(`            sent ${c.sentUtc} UTC to ${c.devicesReached} device(s)`);
    if (c.note) console.log(`            ${c.note}`);
  }
  console.log("");
}

async function main() {
  const clinicSlug = arg("clinic");
  if (!clinicSlug) throw new AdminSetupError("Which clinic? Pass --clinic <address>, e.g. --clinic testclinic2.");

  console.log(`Reading ${describeDatabase(process.env.DATABASE_URL)}`);
  const db = new PrismaClient();
  try {
    const now = new Date();
    print(await pushDebug(db, clinicSlug, now), now);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
