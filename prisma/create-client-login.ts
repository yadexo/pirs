/**
 * Creates a client login for one clinic — and nothing else. For testing a
 * deployment where sign-ups happen in the app and no demo data exists.
 *
 *   npx tsx prisma/create-client-login.ts --clinic testclinic --email you@example.com
 *
 * The password is asked for without echoing it. If the client already exists,
 * their password is reset instead (and their existing sessions signed out),
 * so a forgotten test login is never a dead end.
 *
 * Refuses, changing nothing, when the clinic doesn't exist or isn't active, or
 * when the email already belongs to a clinic's own staff account.
 */
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { AdminSetupError, arg, ask, checkPassword, confirmOrCancel, exitWith, readNewPassword } from "./admin-cli";

export async function createClientLogin(
  db: PrismaClient,
  input: { clinicSlug: string; email: string; password: string; firstName?: string; lastName?: string },
  now = new Date(),
): Promise<{ id: string; email: string; clinic: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const slug = input.clinicSlug.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AdminSetupError("That isn't a valid email address.");
  checkPassword(input.password);

  const clinic = await db.tenant.findUnique({ where: { slug }, select: { id: true, name: true, status: true } });
  if (!clinic) throw new AdminSetupError(`There is no clinic with the address "${slug}". Nothing was changed.`);
  if (clinic.status !== "ACTIVE") throw new AdminSetupError(`${clinic.name} is ${clinic.status}, so its clients can't sign in. Nothing was changed.`);

  const staff = await db.user.findFirst({ where: { email, role: { in: ["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"] } }, select: { role: true } });
  if (staff) throw new AdminSetupError(`${email} is already a ${staff.role} account. Use a different address for a client. Nothing was changed.`);

  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    const existing = await tx.user.findFirst({ where: { tenantId: clinic.id, email, role: "CUSTOMER" }, select: { id: true } });
    if (existing) {
      await tx.user.updateMany({ where: { id: existing.id }, data: { passwordHash, status: "ACTIVE", sessionsValidAfter: now } });
      return { id: existing.id, email, clinic: clinic.name, created: false };
    }
    const user = await tx.user.create({ data: { tenantId: clinic.id, email, passwordHash, role: "CUSTOMER", status: "ACTIVE" }, select: { id: true } });
    await tx.customerProfile.create({
      data: {
        tenantId: clinic.id,
        userId: user.id,
        firstName: input.firstName?.trim() || "Test",
        lastName: input.lastName?.trim() || "Client",
        emailConsent: true,
      },
    });
    return { id: user.id, email, clinic: clinic.name, created: true };
  });
}

async function main() {
  const clinicSlug = arg("clinic") ?? (await ask("Clinic address (the part after the domain, e.g. testclinic): "));
  const email = arg("email") ?? (await ask("Client email: "));
  const password = await readNewPassword();
  await confirmOrCancel(`About to create (or reset) the client login ${email.trim().toLowerCase()} for clinic "${clinicSlug.trim().toLowerCase()}"`);

  const db = new PrismaClient();
  try {
    const result = await createClientLogin(db, { clinicSlug, email, password, firstName: arg("first-name"), lastName: arg("last-name") });
    console.log(`\n${result.created ? "Created" : "Password reset for"} client ${result.email} at ${result.clinic}. Nothing else was changed.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
