/**
 * Empties the platform: every clinic and everything inside it, and every
 * platform admin account. Keeps the platform's own settings.
 *
 *   npm run prod:reset-all                     # DRY RUN: prints what would go
 *   npm run prod:reset-all -- --include-admins # the real thing, after a typed phrase
 *
 * This is the most destructive thing in the repository. Three things stand
 * between a typo and an empty production database:
 *
 *   1. it does nothing at all unless --include-admins is passed — the default
 *      is a dry run that only counts rows;
 *   2. it then asks for a phrase that names the database host it is pointed at,
 *      so the sentence you type cannot be true of the wrong database;
 *   3. scripts/prod.ps1 asks its own "yes" before any of this runs.
 *
 * The flag is named for the part that cannot be undone from inside the app:
 * deleting the platform admins leaves nobody who can sign in. It prints how to
 * get back in before it starts, and again when it finishes.
 *
 * WHAT GOES
 *   every Tenant, and everything that belongs to one (clients, staff, orders,
 *   items, packages, memberships, campaigns, push subscriptions, upload
 *   references, that clinic's audit log — almost all of it by ON DELETE
 *   CASCADE; see lib/tenant-cascade.ts for the handful Postgres makes us
 *   delete in order first), and every User whose role is PLATFORM_ADMIN,
 *   with their two-factor secrets, backup codes and password-reset tokens.
 *
 * WHAT STAYS
 *   AgencySettings — the white-label name, logo, colours and support links;
 *   the global Permission rows (the catalogue every clinic's roles are built
 *   from, not anybody's data); platform-level audit log rows, which have no
 *   clinic — their actorUserId becomes null, so the trail of what was done
 *   survives the account that did it; and the migration history.
 *
 * STRIPE IS NEVER TOUCHED. Deleting a clinic here does not close its connected
 * account at Stripe; it only forgets the id. Every id it orphans is printed so
 * you can deactivate those accounts in the Stripe dashboard yourself.
 *
 * Each clinic is deleted in its own transaction, and the admins in one more.
 * Not all of it in a single transaction on purpose: on a database with real
 * volume that one would hold locks long enough to hit a statement timeout and
 * roll back the whole thing, every time. So this can stop part-way — it prints
 * what it got through, and running it again finishes the job.
 */
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { deleteTenantDependents } from "../lib/tenant-cascade";
import { AdminSetupError, arg, ask, describeDatabase, exitWith, flag } from "./admin-cli";

export interface ClinicToDelete {
  id: string;
  slug: string;
  name: string;
  /** The clinic's Stripe connected account, which this script orphans and never closes. */
  stripeAccountId: string | null;
}

export interface TableCount {
  table: string;
  rows: number;
}

export interface ResetPlan {
  /** The database host, as the confirmation phrase has to name it. */
  host: string;
  clinics: ClinicToDelete[];
  /** The platform admins that would go. Their own addresses — this is the operator's own database. */
  platformAdmins: { email: string; status: string }[];
  /** Every table that has rows, before anything is deleted. */
  counts: TableCount[];
  /** Rows deliberately left behind, so nothing survives unnoticed. */
  kept: { agencySettings: number; permissions: number; platformAuditLogs: number; otherUsersWithoutClinic: number };
}

/** "delete everything on ep-frosty-cloud-zal3mzce.eu-central-1.aws.neon.tech" */
export function confirmationPhrase(host: string): string {
  return `delete everything on ${host}`;
}

export function databaseHost(url: string | undefined): string {
  if (!url) throw new AdminSetupError("DATABASE_URL is not set, so there is no database to reset.");
  try {
    const host = new URL(url).hostname;
    if (!host) throw new Error("no host");
    return host;
  } catch {
    throw new AdminSetupError("DATABASE_URL could not be read, so the confirmation phrase cannot name the database. Nothing was changed.");
  }
}

/** Every table in the public schema that has at least one row. Counts, not estimates. */
export async function tableCounts(db: PrismaClient): Promise<TableCount[]> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  const counts: TableCount[] = [];
  for (const { tablename } of tables) {
    // The name comes from pg_tables, not from input, and is double-quoted.
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM "${tablename.replace(/"/g, '""')}"`);
    const value = Number(rows[0]?.count ?? 0);
    if (value > 0) counts.push({ table: tablename, rows: value });
  }
  return counts;
}

/** What is there now, and what would go. Reads only. */
export async function planReset(db: PrismaClient): Promise<ResetPlan> {
  const [clinics, platformAdmins, agencySettings, permissions, platformAuditLogs, otherUsersWithoutClinic, counts] = await Promise.all([
    db.tenant.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, slug: true, name: true, stripeAccountId: true } }),
    db.user.findMany({ where: { role: "PLATFORM_ADMIN" }, orderBy: { createdAt: "asc" }, select: { email: true, status: true } }),
    db.agencySettings.count(),
    db.permission.count(),
    db.auditLog.count({ where: { tenantId: null } }),
    db.user.count({ where: { tenantId: null, role: { not: "PLATFORM_ADMIN" } } }),
    tableCounts(db),
  ]);
  return {
    host: databaseHost(process.env.DATABASE_URL),
    clinics,
    platformAdmins,
    counts,
    kept: { agencySettings, permissions, platformAuditLogs, otherUsersWithoutClinic },
  };
}

export interface ResetResult {
  clinicsDeleted: string[];
  adminsDeleted: number;
  /** Sign-in counters for the deleted admins' addresses, so a new account is not locked out by an old lockout. */
  loginCountersCleared: number;
  countsAfter: TableCount[];
}

/**
 * Does it. Call only behind both gates — this function itself asks nothing.
 *
 * One transaction per clinic (see the note at the top of this file on why not
 * one for everything), and one for the admins.
 */
export async function applyReset(db: PrismaClient, plan: ResetPlan, log: (line: string) => void = () => {}): Promise<ResetResult> {
  const clinicsDeleted: string[] = [];
  for (const clinic of plan.clinics) {
    await db.$transaction(async (tx) => {
      await deleteTenantDependents(tx, clinic.id);
      await tx.tenant.delete({ where: { id: clinic.id } });
    });
    clinicsDeleted.push(clinic.slug);
    log(`  deleted clinic ${clinic.slug} (${clinic.name})`);
  }

  const emails = plan.platformAdmins.map((a) => a.email);
  const { adminsDeleted, loginCountersCleared } = await db.$transaction(async (tx) => {
    const deleted = await tx.user.deleteMany({ where: { role: "PLATFORM_ADMIN" } });
    // Their own sign-in counters. A fixed window of a few minutes would
    // otherwise greet the replacement account with a lockout it did not earn.
    let cleared = 0;
    for (const email of emails) {
      cleared += (await tx.rateLimitBucket.deleteMany({ where: { key: { startsWith: "login:", endsWith: `:${email}` } } })).count;
    }
    return { adminsDeleted: deleted.count, loginCountersCleared: cleared };
  });
  log(`  deleted ${adminsDeleted} platform admin account(s)`);

  return { clinicsDeleted, adminsDeleted, loginCountersCleared, countsAfter: await tableCounts(db) };
}

function printPlan(plan: ResetPlan) {
  console.log(`\nDatabase: ${describeDatabase(process.env.DATABASE_URL)}`);

  console.log(`\nWould delete ${plan.clinics.length} clinic(s):`);
  if (plan.clinics.length === 0) console.log("  none");
  for (const c of plan.clinics) console.log(`  ${c.slug.padEnd(24)} ${c.name}${c.stripeAccountId ? `   [Stripe ${c.stripeAccountId}]` : ""}`);

  console.log(`\nWould delete ${plan.platformAdmins.length} platform admin account(s):`);
  if (plan.platformAdmins.length === 0) console.log("  none");
  for (const a of plan.platformAdmins) console.log(`  ${a.status.padEnd(8)} ${a.email}`);

  console.log(`\nRows now (tables with any):`);
  const total = plan.counts.reduce((sum, c) => sum + c.rows, 0);
  for (const c of plan.counts) console.log(`  ${String(c.rows).padStart(8)}  ${c.table}`);
  console.log(`  ${String(total).padStart(8)}  TOTAL`);

  console.log(`\nWould keep:`);
  console.log(`  ${plan.kept.agencySettings} AgencySettings row(s) — the white-label name, logo, colours, support links`);
  console.log(`  ${plan.kept.permissions} Permission row(s) — the catalogue clinic roles are built from`);
  console.log(`  ${plan.kept.platformAuditLogs} platform-level audit log row(s) — kept, with their actor set to null`);
  if (plan.kept.otherUsersWithoutClinic > 0) {
    console.log(`  ${plan.kept.otherUsersWithoutClinic} user(s) with no clinic that are not platform admins — not touched; look into them`);
  }
  console.log(`  the migration history`);

  const stripeIds = plan.clinics.map((c) => c.stripeAccountId).filter((id): id is string => !!id);
  console.log(`\nStripe is never touched by this script.`);
  if (stripeIds.length === 0) console.log(`  No clinic has a connected account, so nothing is orphaned.`);
  else {
    console.log(`  These ${stripeIds.length} connected account(s) would be orphaned — deactivate them in the Stripe dashboard:`);
    for (const id of stripeIds) console.log(`    ${id}`);
  }

  console.log(`\nAfterwards, to get back in:`);
  console.log(`  npm run prod:admin -- --email you@example.com      create the first platform admin again`);
  console.log(`  or open https://admin.<your domain>/register/admin and use the registration code`);
}

async function main() {
  const db = new PrismaClient();
  try {
    const plan = await planReset(db);
    printPlan(plan);

    if (!flag("include-admins")) {
      console.log(`\nThis was a dry run. Nothing was changed.`);
      console.log(`To delete all of the above, including every platform admin:`);
      console.log(`  npm run prod:reset-all -- --include-admins\n`);
      return;
    }

    const phrase = confirmationPhrase(plan.host);
    console.log(`\n!! This deletes everything listed above and leaves nobody who can sign in.`);
    const typed = arg("confirm") ?? (await ask(`Type exactly:  ${phrase}\n> `));
    if (typed.trim() !== phrase) throw new AdminSetupError("That is not the phrase. Nothing was changed.");

    console.log(`\nDeleting…`);
    const result = await applyReset(db, plan, (line) => console.log(line));

    console.log(`\nRows left (tables with any):`);
    const total = result.countsAfter.reduce((sum, c) => sum + c.rows, 0);
    for (const c of result.countsAfter) console.log(`  ${String(c.rows).padStart(8)}  ${c.table}`);
    console.log(`  ${String(total).padStart(8)}  TOTAL`);

    console.log(
      `\nDeleted ${result.clinicsDeleted.length} clinic(s) and ${result.adminsDeleted} platform admin account(s).` +
        (result.loginCountersCleared > 0 ? ` Cleared ${result.loginCountersCleared} sign-in counter(s) for those addresses.` : ""),
    );
    console.log(`\nNobody can sign in now. To get back in:`);
    console.log(`  npm run prod:admin -- --email you@example.com`);
    console.log(`  or https://admin.<your domain>/register/admin with the registration code (REGISTRATION_CODE must be set)`);
    const stripeIds = plan.clinics.map((c) => c.stripeAccountId).filter((id): id is string => !!id);
    if (stripeIds.length > 0) {
      console.log(`\nStill to do by hand — deactivate these orphaned Stripe connected accounts:`);
      for (const id of stripeIds) console.log(`  ${id}`);
    }
    console.log("");
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
