/**
 * Starts the app on http://localhost:3000, reliably — plus https on port 3443
 * so phones on the same Wi-Fi can use the camera (see https-proxy.mjs).
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
import { lanAddresses, startHttpsProxy } from "./https-proxy.mjs";

const PORT = 3000;
const HTTPS_PORT = 3443;
const forceBuild = process.argv.includes("--build");

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: "inherit", ...opts });
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
// Always check netstat: a busy server can miss the quick connect probe and
// then keep serving the old build.
freePort(PORT);
freePort(HTTPS_PORT);

// 3. Build.
if (forceBuild || !existsSync(".next/BUILD_ID")) {
  if (forceBuild && existsSync(".next")) rmSync(".next", { recursive: true, force: true });
  console.log("Building...");
  run(`"${process.execPath}" node_modules/next/dist/bin/next build`);
}

// 4. Serve.
console.log(`\n  On this computer`);
console.log(`    Sign in        http://localhost:${PORT}/login`);
console.log(`    Client app     http://localhost:${PORT}/app/riverside-wellness`);
try {
  await startHttpsProxy({ port: HTTPS_PORT, target: PORT });
  const ips = lanAddresses();
  if (ips.length) {
    console.log(`\n  On a phone on the same Wi-Fi (needed for the camera; accept the certificate warning once)`);
    for (const ip of ips) console.log(`    https://${ip}:${HTTPS_PORT}/app`);
  }
} catch (err) {
  console.warn(`  (HTTPS for phones not started: ${err instanceof Error ? err.message : err})`);
}
console.log("");
const nextBin = "node_modules/next/dist/bin/next";
spawn(process.execPath, [nextBin, "start"], { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
