#!/usr/bin/env node
/**
 * One-command bootstrap: brings the whole local stack up from any state
 * (fresh clone, or after a machine restart that stopped Docker).
 *
 *   node scripts/dev-up.mjs          # start database, migrate, seed if empty
 *   node scripts/dev-up.mjs --reset  # additionally wipe and reseed the data
 *
 * Idempotent — safe to re-run at any time.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESET = process.argv.includes("--reset");

const log = (msg) => console.log(`\x1b[36m›\x1b[0m ${msg}`);
const ok = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`\x1b[33m!\x1b[0m ${msg}`);
const die = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}
function quiet(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: "pipe" }).toString().trim();
  } catch {
    return null;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. Docker daemon
// ---------------------------------------------------------------------------
function dockerUp() {
  return quiet("docker info --format {{.ServerVersion}}") !== null;
}

/** Docker Desktop installs to a few different places depending on OS/version. */
function dockerDesktopPath() {
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          path.join(home, "AppData", "Local", "Programs", "DockerDesktop", "Docker Desktop.exe"),
          "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Docker.app"]
        : [];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function ensureDocker() {
  if (dockerUp()) {
    ok("Docker daemon is running");
    return;
  }

  const app = dockerDesktopPath();
  if (!app) {
    die(
      "Docker daemon is not running and Docker Desktop was not found.\n" +
        "  Start Docker manually, or point DATABASE_URL at your own PostgreSQL.",
    );
  }

  log(`Docker is not running — starting Docker Desktop…`);
  if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", "", app], { cwd: ROOT, stdio: "ignore" });
  } else {
    spawnSync("open", ["-a", app], { cwd: ROOT, stdio: "ignore" });
  }

  process.stdout.write("  waiting for the Docker engine ");
  for (let i = 0; i < 60; i++) {
    if (dockerUp()) {
      process.stdout.write("\n");
      ok("Docker daemon is running");
      return;
    }
    process.stdout.write(".");
    await sleep(5000);
  }
  process.stdout.write("\n");
  die("Docker did not become ready within 5 minutes. Start Docker Desktop manually and re-run.");
}

// ---------------------------------------------------------------------------
// 2. Database container
// ---------------------------------------------------------------------------
async function ensureDatabase() {
  if (RESET) {
    warn("--reset: destroying the database volume");
    quiet("docker compose down -v");
  }

  log("Starting PostgreSQL container…");
  run("docker compose up -d");

  process.stdout.write("  waiting for PostgreSQL to accept connections ");
  for (let i = 0; i < 60; i++) {
    const health = quiet(`docker inspect --format {{.State.Health.Status}} clinic-postgres`);
    if (health === "healthy") {
      process.stdout.write("\n");
      ok("PostgreSQL is healthy");
      return;
    }
    process.stdout.write(".");
    await sleep(2000);
  }
  process.stdout.write("\n");
  die("PostgreSQL container never became healthy. Check `docker compose logs postgres`.");
}

// ---------------------------------------------------------------------------
// 3. Environment file
// ---------------------------------------------------------------------------
function ensureEnv() {
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    ok(".env present");
    return;
  }
  log("No .env found — creating one from .env.example with a generated AUTH_SECRET");
  const secret = randomBytes(32).toString("base64");
  const contents = readFileSync(path.join(ROOT, ".env.example"), "utf8").replace(
    "replace-with-a-random-32-byte-secret",
    secret,
  );
  writeFileSync(envPath, contents);
  ok(".env created");
}

// ---------------------------------------------------------------------------
// 4. Schema + seed
// ---------------------------------------------------------------------------
function migrate() {
  log("Applying migrations to app_dev…");
  run("npx prisma migrate deploy");
  log("Applying migrations to app_test…");
  run("npx dotenv -e .env.test -- prisma migrate deploy");
  ok("Schema up to date on both databases");
}

function seedIfNeeded() {
  const count = quiet(
    `docker exec clinic-postgres psql -U app_user -d app_dev -t -A -c "SELECT COUNT(*) FROM \\"Tenant\\""`,
  );
  const isEmpty = count === null || count === "0";

  if (RESET || isEmpty) {
    log(isEmpty ? "No tenants found — seeding demo data…" : "--reset: reseeding demo data…");
    run("npm run seed");
  } else {
    ok(`Demo data already present (${count} tenant(s)) — skipping seed`);
  }
}

// ---------------------------------------------------------------------------
// 5. Clear a stale Next.js build cache
// ---------------------------------------------------------------------------
function clearNextCache() {
  // OneDrive's sync filter can leave `.next` in a state that makes `next dev`
  // die with `EINVAL: readlink`. Clearing it before a cold start is cheap.
  const next = path.join(ROOT, ".next");
  if (!existsSync(next)) return;
  try {
    rmSync(next, { recursive: true, force: true });
    ok("Cleared stale .next build cache");
  } catch {
    warn("Could not remove .next — if `next dev` fails, delete it manually");
  }
}

// ---------------------------------------------------------------------------
await ensureDocker();
ensureEnv();
await ensureDatabase();
migrate();
seedIfNeeded();
clearNextCache();

console.log(`
\x1b[32mStack is ready.\x1b[0m  Start the app with:

    npm run dev        → http://localhost:3000

Demo logins (password: Password123!) — all three portals are linked from /
    Admin           /login                      platform-admin@example.com
    Clinic          /login                      clinic-admin@example.com
    Client          /app/riverside-wellness     emma.johnson0@example.com
`);
