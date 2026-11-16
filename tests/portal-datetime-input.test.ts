/**
 * Editing an offer's start or end does not move it.
 *
 * The form filled its datetime inputs in the laptop's zone, while the server
 * read them back in the clinic's (lib/actions/app-builder.ts, via
 * instantFromLocal). A staff member abroad who opened an offer and saved it
 * unchanged shifted it by the difference. Filled and read back in the same
 * zone, the instant survives — under every process zone in npm run test:tz.
 */
import { describe, it, expect } from "vitest";
import { toLocalInput } from "@/components/merchant/form";
import { instantFromLocal } from "@/lib/marketing-window";

describe("datetime inputs round-trip in the clinic's zone", () => {
  it.each([
    ["Europe/Amsterdam", "2026-07-02T13:30:00.000Z", "2026-07-02T15:30"],
    ["Europe/Amsterdam", "2026-12-31T23:30:00.000Z", "2027-01-01T00:30"],
    ["America/Los_Angeles", "2026-11-19T17:00:00.000Z", "2026-11-19T09:00"],
  ])("in %s, %s is shown as %s and saved back unchanged", (zone, iso, wall) => {
    const shown = toLocalInput(iso, zone);
    expect(shown).toBe(wall);
    expect(instantFromLocal(shown, zone)?.toISOString()).toBe(iso);
  });
});
