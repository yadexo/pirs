#!/usr/bin/env node
/**
 * Runs the time-sensitive tests under three process time zones.
 *
 * Production runs in UTC; this machine may run in Amsterdam; a developer
 * abroad runs in another. Everything that turns days and wall-clock times
 * into instants is meant to answer the same in all of them — the clinic's
 * zone decides, never the process's. The tests use fixed expected instants,
 * so passing under every zone here means identical results under every zone.
 *
 * TZ is set by this script for each child process. Setting it on the command
 * line is not enough on Windows: Git Bash drops TZ values such as
 * "Europe/Amsterdam" before Node sees them. tests/tz-guard.test.ts fails a
 * run whose zone is not the one it was asked for.
 */
import { spawnSync } from "node:child_process";

const ZONES = ["UTC", "Europe/Amsterdam", "America/Los_Angeles"];

export const TIME_SENSITIVE_TESTS = [
  "tests/tz-guard.test.ts",
  "tests/clinic-time.test.ts",
  "tests/zoned-time.test.ts",
  "tests/marketing-window.test.ts",
  "tests/local-time.test.ts",
  "tests/integration/slot-time-zones.test.ts",
  "tests/integration/reschedule-safety.test.ts",
  "tests/integration/once-only-races.test.ts",
  "tests/integration/client-app-roundtrip.test.ts",
  "tests/integration/business-flows.test.ts",
  "tests/integration/client-payments.test.ts",
  "tests/integration/check-in.test.ts",
];

const files = [...TIME_SENSITIVE_TESTS, ...process.argv.slice(2)];
let failed = false;
for (const zone of ZONES) {
  process.stdout.write(`\n== TZ=${zone}\n`);
  const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...files], {
    stdio: "inherit",
    env: { ...process.env, TZ: zone, EXPECT_TZ: zone },
  });
  if (run.status !== 0) {
    failed = true;
    process.stdout.write(`\n!! failed under TZ=${zone}\n`);
  }
}
process.exit(failed ? 1 : 0);
