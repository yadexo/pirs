/**
 * Empties every table in the staging database, keeping the schema (and the
 * migrations history) so `npm run seed` has somewhere clean to put test
 * clinics and clients.
 *
 *   npm run stg:wipe
 *
 * This is the "copied from production's schema, not its client data" half of
 * the staging setup: the Neon branch starts as a snapshot of production
 * (schema *and* data, because that is how Neon branching works), and this
 * script is what turns that snapshot into an empty database with the same
 * shape. Run it once right after creating the branch, before the first seed.
 *
 * Refuses outright if DATABASE_URL looks like the production database, no
 * matter what answered the confirmation prompt — this file's only job is to
 * delete everything in whatever it is pointed at, so the usual "are you
 * sure" is not enough on its own.
 */
import { pathToFileURL } from "node:url";
import { rawDb } from "../lib/db";
import { AdminSetupError, confirmOrCancel, describeDatabase, exitWith } from "./admin-cli";

/** The production Neon endpoint, so this can never be run against it by mistake. */
const PRODUCTION_HOST_MARKER = "ep-frosty-cloud-zal3mzce";

export function assertNotProduction(databaseUrl: string | undefined): void {
  if (databaseUrl?.includes(PRODUCTION_HOST_MARKER)) {
    throw new AdminSetupError(
      "That connection string is the production database. Refusing to wipe it — this script only ever empties a database, never partially.",
    );
  }
}

/** Every table this Postgres user owns in the public schema, except Prisma's own bookkeeping. */
async function tableNames(): Promise<string[]> {
  const rows = await rawDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  return rows.map((r) => r.tablename);
}

export async function wipeAllData(): Promise<string[]> {
  const tables = await tableNames();
  if (tables.length === 0) return tables;
  // One statement, so partial failure can't leave half the tables emptied
  // and half still full of whatever was there before.
  const quoted = tables.map((t) => `"${t}"`).join(", ");
  await rawDb.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  return tables;
}

async function main() {
  assertNotProduction(process.env.DATABASE_URL);
  await confirmOrCancel(`This deletes every row in every table, keeping only the schema.\nRun "npm run seed" afterwards to put test clinics and clients back.`);
  const tables = await wipeAllData();
  console.log(`\nEmptied ${tables.length} tables in ${describeDatabase(process.env.DATABASE_URL)}.`);
  console.log(`Now run: npm run seed`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch(exitWith)
    .finally(() => rawDb.$disconnect());
}
