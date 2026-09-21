/**
 * Sets a new password for an existing platform admin — and nothing else.
 *
 *   npx tsx prisma/reset-platform-admin-password.ts --email you@yourdomain.com
 *
 * Changes exactly one row: that admin's user record gets
 *   - the new password (bcrypt, as everywhere else in the app), and
 *   - sessionsValidAfter = now, which signs out every session that account had,
 *     the same as the app's own "forgot password" reset.
 * No other account, clinic or setting is touched.
 *
 * Refuses (changing nothing) when the email is not a platform admin — clinic
 * owners and staff reset their passwords in the app — or when the account is
 * disabled, since a new password would not let it sign in.
 *
 * `--clear-lockout` additionally removes the sign-in rate-limit counters for
 * this email, for when too many failed attempts have locked it out for 10
 * minutes. Off unless asked for.
 */
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { AdminSetupError, arg, ask, checkPassword, confirmOrCancel, exitWith, flag, readNewPassword } from "./admin-cli";

export async function resetPlatformAdminPassword(
  db: PrismaClient,
  input: { email: string; password: string; clearLockout?: boolean },
  now = new Date(),
): Promise<{ id: string; email: string; lockoutCleared: number }> {
  const email = input.email.trim().toLowerCase();
  checkPassword(input.password);

  const admin = await db.user.findFirst({
    where: { email, role: "PLATFORM_ADMIN" },
    select: { id: true, email: true, status: true },
  });
  if (!admin) {
    const other = await db.user.findFirst({ where: { email }, select: { role: true } });
    throw new AdminSetupError(
      other
        ? `${email} is a ${other.role} account, not a platform admin. This script only resets platform admins. Nothing was changed.`
        : `There is no platform admin with the email ${email}. Nothing was changed.`,
    );
  }
  if (admin.status !== "ACTIVE") {
    throw new AdminSetupError(`${email} is ${admin.status}, so a new password would not let it sign in. Nothing was changed.`);
  }

  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    // Conditional on still being an active platform admin, in case that changed meanwhile.
    const updated = await tx.user.updateMany({
      where: { id: admin.id, role: "PLATFORM_ADMIN", status: "ACTIVE" },
      data: { passwordHash, sessionsValidAfter: now },
    });
    if (updated.count !== 1) throw new AdminSetupError(`${email} changed while this ran. Nothing was changed.`);

    let lockoutCleared = 0;
    if (input.clearLockout) {
      // Only the sign-in counters for this email, e.g. "login:unified:<email>".
      lockoutCleared = (await tx.rateLimitBucket.deleteMany({ where: { key: { startsWith: "login:", endsWith: `:${email}` } } })).count;
    }
    return { id: admin.id, email: admin.email, lockoutCleared };
  });
}

async function main() {
  const email = arg("email") ?? (await ask("Email of the platform admin: "));
  const password = await readNewPassword("New password");
  const clearLockout = flag("clear-lockout");
  await confirmOrCancel(
    `About to set a new password for platform admin ${email.trim().toLowerCase()} and sign out its existing sessions` +
      (clearLockout ? ", and clear its sign-in lockout" : ""),
  );

  const db = new PrismaClient();
  try {
    const result = await resetPlatformAdminPassword(db, { email, password, clearLockout });
    console.log(`\nPassword updated for ${result.email}. Existing sessions for this account are signed out.`);
    if (clearLockout) console.log(`Sign-in lockout counters removed: ${result.lockoutCleared}.`);
    console.log("Nothing else was changed.");
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
