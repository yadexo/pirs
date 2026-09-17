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
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";

export const MIN_ADMIN_PASSWORD_LENGTH = 12;
const STAFF_ROLES = ["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF"] as const;

export class AdminSetupError extends Error {}

export async function createPlatformAdmin(
  db: PrismaClient,
  input: { email: string; password: string; allowAdditional?: boolean },
): Promise<{ id: string; email: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AdminSetupError("That isn't a valid email address.");
  if (input.password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new AdminSetupError(`Use a password of at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`);
  }
  if (input.password.length > 200) throw new AdminSetupError("Keep the password under 200 characters.");

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

      const user = await tx.user.create({
        data: { email, passwordHash, role: "PLATFORM_ADMIN", tenantId: null, status: "ACTIVE" },
        select: { id: true, email: true },
      });
      return user;
    },
    { isolationLevel: "Serializable" },
  );
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const flag = (name: string) => process.argv.includes(`--${name}`);

function ask(question: string, { hidden = false } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden && process.stdin.isTTY) {
      // Print the question, then swallow what readline would echo.
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.includes(question)) write.call(rl, s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** "ep-xxx.neon.tech / neondb" — enough to recognise the target, never the password. */
function describeDatabase(url: string | undefined): string {
  if (!url) return "(DATABASE_URL is not set)";
  try {
    const u = new URL(url);
    return `${u.hostname} / ${u.pathname.replace(/^\//, "") || "(default)"}`;
  } catch {
    return "(DATABASE_URL could not be read)";
  }
}

async function main() {
  const email = arg("email") ?? (await ask("Email: "));
  let password = arg("password");
  if (password) {
    console.warn("Note: --password is now in your shell history. Prefer the prompt next time.");
  } else {
    if (!process.stdin.isTTY) {
      console.warn("Warning: this terminal isn't interactive, so the password may be shown as you type. PowerShell or Windows Terminal hides it.");
    }
    password = await ask(`Password (min ${MIN_ADMIN_PASSWORD_LENGTH} characters): `, { hidden: true });
    const again = await ask("Repeat password: ", { hidden: true });
    if (again !== password) throw new AdminSetupError("The passwords don't match. Nothing was changed.");
  }

  const target = describeDatabase(process.env.DATABASE_URL);
  console.log(`\nAbout to create a PLATFORM_ADMIN account for ${email.trim().toLowerCase()}`);
  console.log(`in database: ${target}`);
  if (!flag("yes")) {
    const answer = await ask('Type "yes" to continue: ');
    if (answer.trim().toLowerCase() !== "yes") throw new AdminSetupError("Cancelled. Nothing was changed.");
  }

  const db = new PrismaClient();
  try {
    const user = await createPlatformAdmin(db, { email, password, allowAdditional: flag("additional") });
    console.log(`\nCreated platform admin ${user.email} (id ${user.id}). Nothing else was changed.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n${err instanceof AdminSetupError ? err.message : err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
