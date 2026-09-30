import { describe, it, expect } from "vitest";
import { instantFromLocal, localInputValue } from "@/lib/marketing-window";

/**
 * A clinic types a wall-clock time. What it means is fixed by the clinic's
 * timezone, never by the machine that happens to read it — on Vercel that
 * machine is in UTC, which is how "half past three" became half past five.
 */
describe("reading a wall-clock time in a clinic's timezone", () => {
  it("reads a summer afternoon as Amsterdam, not as UTC", () => {
    // What a Dutch clinic means by 15:30 on 30 September is 13:30 UTC.
    expect(instantFromLocal("2026-09-30T15:30", "Europe/Amsterdam")!.toISOString()).toBe("2026-09-30T13:30:00.000Z");
    // The bug this replaces: the same string read as UTC, two hours late.
    expect(new Date("2026-09-30T15:30Z").toISOString()).toBe("2026-09-30T15:30:00.000Z");
  });

  it("reads a winter afternoon with the winter offset", () => {
    expect(instantFromLocal("2026-01-15T15:30", "Europe/Amsterdam")!.toISOString()).toBe("2026-01-15T14:30:00.000Z");
  });

  it("is right on the evening the clocks go forward", () => {
    // 29 March 2026: Amsterdam moves from +01:00 to +02:00 at 02:00 local.
    expect(instantFromLocal("2026-03-28T23:00", "Europe/Amsterdam")!.toISOString()).toBe("2026-03-28T22:00:00.000Z"); // still +01:00
    expect(instantFromLocal("2026-03-29T12:00", "Europe/Amsterdam")!.toISOString()).toBe("2026-03-29T10:00:00.000Z"); // now +02:00
  });

  it("is right on the evening the clocks go back", () => {
    // 25 October 2026: Amsterdam moves from +02:00 to +01:00 at 03:00 local.
    expect(instantFromLocal("2026-10-24T23:00", "Europe/Amsterdam")!.toISOString()).toBe("2026-10-24T21:00:00.000Z"); // +02:00
    expect(instantFromLocal("2026-10-25T12:00", "Europe/Amsterdam")!.toISOString()).toBe("2026-10-25T11:00:00.000Z"); // +01:00
  });

  it("picks one of the two answers on an hour that happens twice", () => {
    // 02:30 on 25 October exists at both +02:00 and +01:00. Either is a
    // defensible reading; what matters is that it is one of them, not a
    // crash and not an hour outside the pair.
    const both = ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"];
    expect(both).toContain(instantFromLocal("2026-10-25T02:30", "Europe/Amsterdam")!.toISOString());
  });

  it("gives an answer for an hour that never happens", () => {
    // 02:30 on 29 March does not exist; the clocks jump straight past it.
    const at = instantFromLocal("2026-03-29T02:30", "Europe/Amsterdam");
    expect(at).not.toBeNull();
    expect(Number.isNaN(at!.getTime())).toBe(false);
  });

  it("works for a clinic in another timezone", () => {
    expect(instantFromLocal("2026-09-30T15:30", "Europe/Lisbon")!.toISOString()).toBe("2026-09-30T14:30:00.000Z");
    expect(instantFromLocal("2026-09-30T15:30", "UTC")!.toISOString()).toBe("2026-09-30T15:30:00.000Z");
  });

  it("refuses anything that isn't a wall-clock time", () => {
    expect(instantFromLocal("", "Europe/Amsterdam")).toBeNull();
    expect(instantFromLocal("tomorrow", "Europe/Amsterdam")).toBeNull();
    expect(instantFromLocal("30-09-2026 15:30", "Europe/Amsterdam")).toBeNull();
  });

  it("round-trips: what the form shows is what the clinic picked", () => {
    const picked = "2026-09-30T15:30";
    const instant = instantFromLocal(picked, "Europe/Amsterdam")!;
    expect(localInputValue(instant, "Europe/Amsterdam")).toBe(picked);

    // And in winter, across the change.
    const winter = "2026-12-24T18:45";
    expect(localInputValue(instantFromLocal(winter, "Europe/Amsterdam")!, "Europe/Amsterdam")).toBe(winter);
  });
});
