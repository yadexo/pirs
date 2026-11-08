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
 * Never selects passwordHash or the TOTP secret, so there is nothing secret to
 * print. Only find* calls: this script has no way to write.
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
  admins: AdminRow[];
  buckets: LoginBucket[];
}

export async function listPlatformAdmins(db: PrismaClient, now = new Date()): Promise<AdminsReport> {
  const users = await db.user.findMany({
    where: { role: "PLATFORM_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      lastLoginAt: true,
      twoFactor: { select: { confirmedAt: true } },
    },
  });
  const admins: AdminRow[] = users.map((u) => ({
    email: u.email,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
    status: u.status,
    // A secret that was never confirmed is not protection: sign-in ignores it.
    twoFactorConfirmed: u.twoFactor?.confirmedAt != null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  }));
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

  return { admins, buckets };
}

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function print(report: AdminsReport) {
  const yesNo = (v: boolean) => (v ? "yes" : "no ");

  console.log(`\nPlatform admins (${report.admins.length})`);
  if (report.admins.length === 0) console.log("  none");
  else console.log("  status    2FA   last sign-in              who");
  for (const a of report.admins) {
    const last = a.lastLoginAt ?? "never";
    console.log(`  ${a.status.padEnd(8)}  ${yesNo(a.twoFactorConfirmed)}   ${last.padEnd(24)}  ${a.email}${a.name ? ` (${a.name})` : ""}`);
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
