/**
 * Creates the first platform admin account — and nothing else. No clinic, no
 * demo data, no other rows are created or changed.
 *
 *   npx tsx prisma/create-platform-admin.ts --email you@yourdomain.com
 *
 * The password is asked for without echoing it. `--password` is also accepted,
 * but it then ends up in your shell history, so prefer the prompt.
 *
 * Refuses when:
 *   - the email is already used by any agency, clinic admin or staff account
 *     (sign-in needs the address to be unique among those, or nobody can log in);
 *   - a platform admin already exists, unless `--additional` is passed.
 * Before writing it shows which database it is about to change and asks for
 * "yes"; `--yes` skips that for automation.
 */
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { AdminSetupError, arg, ask, checkPassword, confirmOrCancel, exitWith, flag, readNewPassword } from "./admin-cli";

export { AdminSetupError, MIN_ADMIN_PASSWORD_LENGTH } from "./admin-cli";

const STAFF_ROLES = ["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"] as const;

export async function createPlatformAdmin(
  db: PrismaClient,
  input: { email: string; password: string; allowAdditional?: boolean },
): Promise<{ id: string; email: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AdminSetupError("That isn't a valid email address.");
  checkPassword(input.password);

  const passwordHash = await hashPassword(input.password);

  // One transaction, so two runs at once cannot both pass the checks.
  return db.$transaction(
    async (tx) => {
      const taken = await tx.user.findFirst({ where: { email, role: { in: [...STAFF_ROLES] } }, select: { role: true } });
      if (taken) throw new AdminSetupError(`${email} already has a ${taken.role} account. Nothing was changed.`);

      if (!input.allowAdditional) {
        const existing = await tx.user.count({ where: { role: "PLATFORM_ADMIN" } });
        if (existing > 0) {
          throw new AdminSetupError(`This database already has ${existing} platform admin account(s). Pass --additional to add another. Nothing was changed.`);
        }
      }

      return tx.user.create({
        data: { email, passwordHash, role: "PLATFORM_ADMIN", tenantId: null, status: "ACTIVE" },
        select: { id: true, email: true },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

async function main() {
  const email = arg("email") ?? (await ask("Email: "));
  const password = await readNewPassword();
  await confirmOrCancel(`About to create a PLATFORM_ADMIN account for ${email.trim().toLowerCase()}`);

  const db = new PrismaClient();
  try {
    const user = await createPlatformAdmin(db, { email, password, allowAdditional: flag("additional") });
    console.log(`\nCreated platform admin ${user.email} (id ${user.id}). Nothing else was changed.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
