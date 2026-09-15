import { describe, it, expect } from "vitest";
import { startOfDayIn } from "@/lib/zoned-time";

describe("startOfDayIn", () => {
  it("finds local midnight in summer and winter time", () => {
    // 15 Sep 2026, 14:00 UTC → Amsterdam is UTC+2 → midnight was 22:00 UTC the day before.
    expect(startOfDayIn("Europe/Amsterdam", new Date("2026-09-15T14:00:00Z")).toISOString()).toBe("2026-09-14T22:00:00.000Z");
    // 15 Jan 2026 → UTC+1.
    expect(startOfDayIn("Europe/Amsterdam", new Date("2026-01-15T14:00:00Z")).toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("uses the clinic's date, not the server's, near midnight", () => {
    // 23:30 UTC on the 15th is already 01:30 on the 16th in Amsterdam.
    expect(startOfDayIn("Europe/Amsterdam", new Date("2026-09-15T23:30:00Z")).toISOString()).toBe("2026-09-15T22:00:00.000Z");
    // …and still the 15th in New York.
    expect(startOfDayIn("America/New_York", new Date("2026-09-15T23:30:00Z")).toISOString()).toBe("2026-09-15T04:00:00.000Z");
  });

  it("is correct on the days the clocks change", () => {
    // 29 Mar 2026: Amsterdam springs forward at 02:00; midnight was still UTC+1.
    expect(startOfDayIn("Europe/Amsterdam", new Date("2026-03-29T12:00:00Z")).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    // 25 Oct 2026: falls back at 03:00; midnight was still UTC+2.
    expect(startOfDayIn("Europe/Amsterdam", new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("handles zones far from UTC and half-hour offsets", () => {
    expect(startOfDayIn("Pacific/Auckland", new Date("2026-09-15T14:00:00Z")).toISOString()).toBe("2026-09-15T12:00:00.000Z");
    expect(startOfDayIn("Asia/Kolkata", new Date("2026-09-15T14:00:00Z")).toISOString()).toBe("2026-09-14T18:30:00.000Z");
  });
});
