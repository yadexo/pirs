/**
 * Who the platform admins are, and whether anything is locking them out.
 * Reads only.
 *
 *   npm run prod:admins
 *
 * For each platform admin: status, whether two-factor is confirmed, and their
 * last sign-in. Then every sign-in rate-limit counter that is still running,
 * with how long until it resets — a counter over its limit is a lockout, and
 * the window is fixed, so that is the longest it can last.
 *
 * Also the things that make a correct password still fail, which no lockout
 * shows: sessions the account refuses until a moment still in the future (a
 * reset stamped by a clock that ran ahead), the gap between this computer's
 * clock and the database's, and the same email being on another account.
 *
 * Never selects passwordHash or the TOTP secret, so there is nothing secret to
 * print — and no other account's name or address either, only their roles.
 * One SELECT now() for the clock; everything else is find, count and groupBy.
 * This script has no way to write.
 */
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { LOGIN_ATTEMPTS_PER_ACCOUNT, LOGIN_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS } from "../lib/login-limits";
import { describeDatabase, exitWith } from "./admin-cli";

export interface AdminRow {
  email: string;
  name: string | null;
  status: string;
  twoFactorConfirmed: boolean;
  lastLoginAt: string | null;
  /** Sessions that began before this are refused. Null when none was ever revoked. */
  sessionsValidAfter: string | null;
  /** Milliseconds until sessionsValidAfter has passed, by the database's clock; 0 when it already has. */
  sessionsRefusedForMs: number;
  /** Other accounts (any role) on the same address, by role. Roles only — nothing that identifies them. */
  otherAccountsWithEmail: { role: string; count: number }[];
  /** Another staff-type account has this address: sign-in finds two matches and refuses both. */
  emailBlocksSignIn: boolean;
  /** A client account has this address: which sign-in it is sent to is then up to the database. */
  emailMayReroute: boolean;
  /** Stored with capitals. Sign-in looks up the lowercase address, so this account can never be found. */
  emailNotLowercase: boolean;
}

export interface Clocks {
  databaseNow: string;
  localNow: string;
  /** Local minus database. Positive: this computer is ahead. */
  skewMs: number;
}

export interface LoginBucket {
  kind: "account" | "ip";
  /** The email (account) or address (ip) the counter is for. */
  subject: string;
  /** The portal an account counter belongs to; null for an IP. */
  portal: string | null;
  attempts: number;
  limit: number;
  /** Over the limit: further sign-ins are refused until it resets. */
  locked: boolean;
  remainingMs: number;
  resetsAt: string;
  /** Whether the account is one of the platform admins listed above. */
  platformAdmin: boolean;
}

export interface AdminsReport {
  clocks: Clocks;
  admins: AdminRow[];
  buckets: LoginBucket[];
}

/** Roles whose accounts sign in through the staff door, where an address must match exactly one. */
const STAFF_ROLES = new Set(["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"]);

export async function listPlatformAdmins(db: PrismaClient, now = new Date()): Promise<AdminsReport> {
  // The database's own clock, which is what a session's start and a reset's
  // cut-off are both compared against by the app running next to it.
  const databaseNow = (await db.$queryRaw<{ now: Date }[]>`SELECT now() AS now`)[0]!.now;
  const clocks: Clocks = { databaseNow: databaseNow.toISOString(), localNow: now.toISOString(), skewMs: now.getTime() - databaseNow.getTime() };

  const users = await db.user.findMany({
    where: { role: "PLATFORM_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      lastLoginAt: true,
      sessionsValidAfter: true,
      twoFactor: { select: { confirmedAt: true } },
    },
  });

  const admins: AdminRow[] = [];
  for (const u of users) {
    // Case-insensitive on purpose: an address that differs only by case is
    // still worth knowing about, even though sign-in would not match it.
    const others = await db.user.groupBy({
      by: ["role"],
      where: { id: { not: u.id }, email: { equals: u.email, mode: "insensitive" } },
      _count: { _all: true },
    });
    const otherAccountsWithEmail = others.map((o) => ({ role: o.role, count: o._count._all })).sort((a, b) => a.role.localeCompare(b.role));
    const refusedForMs = u.sessionsValidAfter ? Math.max(0, u.sessionsValidAfter.getTime() - databaseNow.getTime()) : 0;

    admins.push({
      email: u.email,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
      status: u.status,
      // A secret that was never confirmed is not protection: sign-in ignores it.
      twoFactorConfirmed: u.twoFactor?.confirmedAt != null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      sessionsValidAfter: u.sessionsValidAfter?.toISOString() ?? null,
      sessionsRefusedForMs: refusedForMs,
      otherAccountsWithEmail,
      // Exact-address matches only: that is all sign-in looks for.
      emailBlocksSignIn: otherAccountsWithEmail.some((o) => STAFF_ROLES.has(o.role)) && (await db.user.count({ where: { id: { not: u.id }, email: u.email, role: { in: [...STAFF_ROLES] as never } } })) > 0,
      emailMayReroute: otherAccountsWithEmail.some((o) => o.role === "CUSTOMER") && (await db.user.count({ where: { id: { not: u.id }, email: u.email, role: "CUSTOMER" } })) > 0,
      emailNotLowercase: u.email !== u.email.toLowerCase(),
    });
  }
  const adminEmails = new Set(admins.map((a) => a.email.toLowerCase()));

  const rows = await db.rateLimitBucket.findMany({
    where: { key: { startsWith: "login:" }, resetAt: { gt: now } },
    orderBy: { resetAt: "desc" },
    select: { key: true, count: true, resetAt: true },
  });

  const buckets: LoginBucket[] = rows.map((row) => {
    // login:ip:<address>  or  login:<portal>:<email>
    const isIp = row.key.startsWith("login:ip:");
    const [, portalOrIp = "", ...rest] = row.key.split(":");
    const subject = isIp ? row.key.slice("login:ip:".length) : rest.join(":");
    const limit = isIp ? LOGIN_ATTEMPTS_PER_IP : LOGIN_ATTEMPTS_PER_ACCOUNT;
    return {
      kind: isIp ? "ip" : "account",
      subject,
      portal: isIp ? null : portalOrIp,
      attempts: row.count,
      limit,
      locked: row.count > limit,
      remainingMs: Math.max(0, row.resetAt.getTime() - now.getTime()),
      resetsAt: row.resetAt.toISOString(),
      platformAdmin: !isIp && adminEmails.has(subject.toLowerCase()),
    };
  });

  return { clocks, admins, buckets };
}

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

/** This computer's clock against the database's, in words. */
export function describeSkew(clocks: Clocks): string {
  const abs = Math.abs(clocks.skewMs);
  if (abs < 5000) return "in step (within 5 seconds)";
  const gap = formatRemaining(abs);
  return `this computer is ${gap} ${clocks.skewMs > 0 ? "AHEAD of" : "behind"} the database${abs >= 60_000 ? " — enough to matter" : ""}`;
}

/** What is wrong, or worth knowing, about one admin beyond the table row. Empty when nothing. */
export function adminNotes(a: AdminRow): string[] {
  const notes: string[] = [];
  if (a.sessionsValidAfter) {
    if (a.sessionsRefusedForMs > 0) {
      notes.push(
        `!! Sessions are refused until ${a.sessionsValidAfter} (${formatRemaining(a.sessionsRefusedForMs)} from now by the database's clock). Signing in works, then the app sends you back to /login saying access changed. A reset run from a computer whose clock was ahead does this; it ends by itself.`,
      );
    } else {
      notes.push(`Sessions that began before ${a.sessionsValidAfter} are signed out (the last password reset). That moment has passed.`);
    }
  }
  if (a.emailBlocksSignIn) {
    notes.push("!! This address is also on another staff-type account. Sign-in finds two matches and refuses both, even with the right password.");
  }
  if (a.emailMayReroute) {
    notes.push("!  This address is also a client account. Which of the two sign-ins it is sent to is left to the database, so it can land on the client one and fail.");
  }
  if (a.otherAccountsWithEmail.length > 0) {
    notes.push(`Same address on ${a.otherAccountsWithEmail.map((o) => `${o.count} ${o.role}`).join(", ")} (roles only; nothing else is read).`);
  }
  if (a.emailNotLowercase) {
    notes.push("!! The address is stored with capital letters. Sign-in looks up the lowercase form, so this account can never be found.");
  }
  return notes;
}

function print(report: AdminsReport) {
  const yesNo = (v: boolean) => (v ? "yes" : "no ");

  console.log(`
Clocks: database ${report.clocks.databaseNow}, this computer ${report.clocks.localNow}`);
  console.log(`        ${describeSkew(report.clocks)}`);

  console.log(`
Platform admins (${report.admins.length})`);
  if (report.admins.length === 0) console.log("  none");
  else console.log("  status    2FA   last sign-in              who");
  for (const a of report.admins) {
    const last = a.lastLoginAt ?? "never";
    console.log(`  ${a.status.padEnd(8)}  ${yesNo(a.twoFactorConfirmed)}   ${last.padEnd(24)}  ${a.email}${a.name ? ` (${a.name})` : ""}`);
    for (const note of adminNotes(a)) console.log(`              ${note}`);
  }

  const locked = report.buckets.filter((b) => b.locked);
  const mins = LOGIN_WINDOW_MS / 60000;
  console.log(`\nSign-in rate limits: ${LOGIN_ATTEMPTS_PER_ACCOUNT} attempts per account and ${LOGIN_ATTEMPTS_PER_IP} per address, per ${mins}-minute window.`);
  console.log(`The window starts at the first attempt and resets ${mins} minutes later, so a lock never lasts longer than ${mins} minutes.`);

  if (report.buckets.length === 0) {
    console.log("\nNo sign-in counters are running right now: nobody is locked out.\n");
    return;
  }
  console.log(`\n${locked.length === 0 ? "Nobody is locked out" : `${locked.length} LOCKED`}; ${report.buckets.length} counter(s) running`);
  for (const b of report.buckets) {
    const what = b.kind === "ip" ? `address ${b.subject}` : `${b.subject} (${b.portal} portal)${b.platformAdmin ? "  <- platform admin" : ""}`;
    const state = b.locked ? `LOCKED, unlocks in ${formatRemaining(b.remainingMs)} (${b.resetsAt})` : `${b.attempts} of ${b.limit} used, resets in ${formatRemaining(b.remainingMs)}`;
    console.log(`  ${b.locked ? "!!" : "  "} ${what}\n       ${state}`);
  }
  console.log("");
}

async function main() {
  console.log(`Reading ${describeDatabase(process.env.DATABASE_URL)}`);
  const db = new PrismaClient();
  try {
    print(await listPlatformAdmins(db));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
