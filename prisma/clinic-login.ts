/**
 * Shows who can sign in to a clinic's portal, and sets a new password for one
 * of them.
 *
 *   npx tsx prisma/clinic-login.ts --clinic testclinic2
 *   npx tsx prisma/clinic-login.ts --clinic testclinic2 --email owner@example.com
 *
 * With only --clinic it lists the clinic's staff accounts and changes nothing.
 * With --email as well it sets that account's password, which is the only way
 * to get back in: passwords are stored as bcrypt hashes, so nobody — including
 * whoever runs this — can read an existing one.
 *
 * Changes exactly one row: that user's password, and sessionsValidAfter = now,
 * which signs out any session the account still had. No other account, clinic
 * or setting is touched.
 */
import { pathToFileURL } from "node:url";
import { PrismaClient, type UserRole } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { AdminSetupError, arg, confirmOrCancel, describeDatabase, exitWith, readNewPassword } from "./admin-cli";

const STAFF_ROLES: UserRole[] = ["TENANT_ADMIN", "STAFF"];

export interface ClinicLogin {
  email: string;
  role: UserRole;
  status: string;
  name: string | null;
  lastLoginAt: Date | null;
}

/** Everyone who can open this clinic's portal. */
export async function listClinicLogins(db: PrismaClient, clinicSlug: string): Promise<{ clinic: string; logins: ClinicLogin[] }> {
  const slug = clinicSlug.trim().toLowerCase();
  const clinic = await db.tenant.findUnique({ where: { slug }, select: { id: true, name: true, status: true } });
  if (!clinic) throw new AdminSetupError(`There is no clinic with the address "${slug}".`);

  const users = await db.user.findMany({
    where: { tenantId: clinic.id, role: { in: STAFF_ROLES } },
    select: {
      email: true,
      role: true,
      status: true,
      lastLoginAt: true,
      staffProfile: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  return {
    clinic: `${clinic.name} (${clinic.status})`,
    logins: users.map((u) => ({
      email: u.email,
      role: u.role,
      status: u.status,
      name: u.staffProfile ? `${u.staffProfile.firstName} ${u.staffProfile.lastName}`.trim() : null,
      lastLoginAt: u.lastLoginAt,
    })),
  };
}

/** Sets a new password for one of those accounts. */
export async function resetClinicLogin(
  db: PrismaClient,
  input: { clinicSlug: string; email: string; password: string },
  now = new Date(),
): Promise<{ email: string; role: UserRole }> {
  const slug = input.clinicSlug.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();

  const clinic = await db.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!clinic) throw new AdminSetupError(`There is no clinic with the address "${slug}". Nothing was changed.`);

  const user = await db.user.findFirst({
    where: { tenantId: clinic.id, email, role: { in: STAFF_ROLES } },
    select: { id: true, email: true, role: true, status: true },
  });
  if (!user) {
    throw new AdminSetupError(
      `${email} isn't a staff account at ${clinic.name}. Run without --email to see who is. Nothing was changed.`,
    );
  }
  if (user.status !== "ACTIVE") {
    throw new AdminSetupError(`${email} is ${user.status}, so a new password wouldn't let it sign in. Nothing was changed.`);
  }

  const passwordHash = await hashPassword(input.password);
  await db.user.updateMany({ where: { id: user.id }, data: { passwordHash, sessionsValidAfter: now } });
  return { email: user.email, role: user.role };
}

async function main() {
  const clinicSlug = arg("clinic");
  if (!clinicSlug) throw new AdminSetupError("Which clinic? Pass --clinic <address>, e.g. --clinic testclinic2.");
  const email = arg("email");

  console.log(`Reading ${describeDatabase(process.env.DATABASE_URL)}`);
  const db = new PrismaClient();
  try {
    if (!email) {
      const { clinic, logins } = await listClinicLogins(db, clinicSlug);
      console.log(`\n${clinic}`);
      if (logins.length === 0) {
        console.log("No staff accounts. Nobody can sign in to this clinic's portal yet.");
        return;
      }
      for (const login of logins) {
        const last = login.lastLoginAt ? login.lastLoginAt.toISOString().slice(0, 10) : "never signed in";
        console.log(`  ${login.email}  ${login.role}  ${login.status}  ${login.name ?? ""}  (${last})`);
      }
      console.log("\nPasswords are hashed and cannot be read. To set one:");
      console.log(`  npm run prod:clinic-login -- --clinic ${clinicSlug} --email ${logins[0]!.email}`);
      return;
    }

    const password = await readNewPassword();
    await confirmOrCancel(`About to set a new password for ${email.trim().toLowerCase()} at clinic "${clinicSlug.trim().toLowerCase()}"`);
    const result = await resetClinicLogin(db, { clinicSlug, email, password });
    console.log(`\nPassword set for ${result.email} (${result.role}). Any sessions it had are signed out. Nothing else was changed.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
