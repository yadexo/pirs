/**
 * When scripts/test-time-zones.mjs runs the suite under a zone, this checks
 * the process really is in that zone — otherwise the matrix would prove
 * nothing (Git Bash on Windows silently drops TZ values like
 * "Europe/Amsterdam"). Outside the matrix it has nothing to check.
 */
import { describe, it, expect } from "vitest";

describe("the process time zone", () => {
  it.runIf(Boolean(process.env.EXPECT_TZ))("is the one the time zone matrix asked for", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(process.env.EXPECT_TZ);
  });

  it("is reported, so a failure in another test can be read against it", () => {
    expect(typeof Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("string");
  });
});
