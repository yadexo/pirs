/**
 * Starts the app on http://localhost:3000, reliably.
 *
 * `next dev` is unusable in this checkout — the project lives under OneDrive,
 * which breaks the dev server's symlink handling and makes compiles glacial.
 * So this serves the production build instead, and clears the two things that
 * actually go wrong: a stale process still holding port 3000, and a missing
 * or out-of-date build.
 *
 *   npm run serve            start (builds only if there is no build yet)
 *   npm run serve -- --build force a fresh build first
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createConnection } from "node:net";

const PORT = 3000;
const forceBuild = process.argv.includes("--build");

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(700);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
    socket.once("error", () => resolve(false));
  });
}

/** Kill whatever is listening on the port, so a stale server can't block us. */
function freePort(port) {
  let out = "";
  try {
    out = execSync(`netstat -ano -p tcp`, { encoding: "utf8" });
  } catch {
    return;
  }
  const pids = new Set();
  for (const line of out.split("\n")) {
    if (!line.includes("LISTENING")) continue;
    if (!new RegExp(`[:.]${port}\\s`).test(line)) continue;
    const pid = line.trim().split(/\s+/).pop();
    if (pid && pid !== "0") pids.add(pid);
  }
  for (const pid of pids) {
    console.log(`Stopping stale process ${pid} on port ${port}`);
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  }
}

// 1. Database. Without it every page 500s, which looks exactly like "site down".
try {
  const ps = execSync("docker ps --format {{.Names}}", { encoding: "utf8" });
  if (!ps.includes("clinic-postgres")) {
    console.log("Starting the database container...");
    run("docker compose up -d");
  }
} catch {
  console.error("Docker does not look available. Start Docker Desktop, then re-run this.");
  process.exit(1);
}

// 2. Port.
if (await portIsOpen(PORT)) freePort(PORT);

// 3. Build.
if (forceBuild || !existsSync(".next/BUILD_ID")) {
  if (forceBuild && existsSync(".next")) rmSync(".next", { recursive: true, force: true });
  console.log("Building...");
  run(`"${process.execPath}" node_modules/next/dist/bin/next build`);
}

// 4. Serve.
console.log(`\n  Clinic portal   http://localhost:${PORT}/login`);
console.log(`  Patient app     http://localhost:${PORT}/app/riverside-wellness\n`);
const nextBin = "node_modules/next/dist/bin/next";
spawn(process.execPath, [nextBin, "start"], { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
