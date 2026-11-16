/**
 * Calendar days and wall-clock times in a clinic's own time zone.
 *
 * The booking sheet once built "midnight" in the browser's zone and the slot
 * engine read it in the server's, so a client who picked Thursday was booked
 * on another day at another hour. Everything that turns a day or a wall-clock
 * time into an instant now goes through lib/clinic-time.ts, and these tests
 * pin its answers — fixed instants, so they hold whatever zone the process
 * runs in (npm run test:tz runs them under three).
 */
import { describe, it, expect } from "vitest";
import {
  addCalendarMonths,
  addDays,
  dayRange,
  fromInputValue,
  instantAt,
  toInputValue,
  todayIn,
  wallMinutes,
  weekdayOf,
} from "@/lib/clinic-time";

const AMS = "Europe/Amsterdam";
const LA = "America/Los_Angeles";
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("calendar days", () => {
  it("today is the clinic's today, not the server's", () => {
    // 23:30 UTC on 18 November is already the 19th in Amsterdam, still the 18th in LA.
    const at = new Date("2026-11-18T23:30:00Z");
    expect(todayIn(AMS, at)).toBe("2026-11-19");
    expect(todayIn(LA, at)).toBe("2026-11-18");
    expect(todayIn("UTC", at)).toBe("2026-11-18");
  });

  it("adds days across month and year ends, and names the weekday", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-11-19")).toBe(4); // Thursday, as StaffAvailability.dayOfWeek counts
    expect(weekdayOf("2026-11-22")).toBe(0); // Sunday
  });
});

describe("wall-clock times to instants", () => {
  it("09:00 in Amsterdam is 08:00 UTC in winter and 07:00 UTC in summer", () => {
    expect(iso(instantAt(AMS, "2026-11-19", 9 * 60))).toBe("2026-11-19T08:00:00.000Z");
    expect(iso(instantAt(AMS, "2026-07-02", 9 * 60))).toBe("2026-07-02T07:00:00.000Z");
    expect(iso(instantAt(LA, "2026-11-19", 9 * 60))).toBe("2026-11-19T17:00:00.000Z");
  });

  it("a time the clocks skip does not exist (29 March 2026, 02:00-02:59)", () => {
    expect(instantAt(AMS, "2026-03-29", 2 * 60 + 30)).toBeNull();
    expect(iso(instantAt(AMS, "2026-03-29", 60 + 45))).toBe("2026-03-29T00:45:00.000Z");
    expect(iso(instantAt(AMS, "2026-03-29", 3 * 60))).toBe("2026-03-29T01:00:00.000Z");
  });

  it("a time that happens twice gives the first (25 October 2026, 02:00-02:59)", () => {
    expect(iso(instantAt(AMS, "2026-10-25", 2 * 60 + 30))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(instantAt(AMS, "2026-10-25", 3 * 60))).toBe("2026-10-25T02:00:00.000Z");
  });

  it("near midnight stays on its own day", () => {
    expect(iso(instantAt(AMS, "2026-11-19", 23 * 60 + 45))).toBe("2026-11-19T22:45:00.000Z");
    expect(iso(instantAt(AMS, "2026-11-19", 0))).toBe("2026-11-18T23:00:00.000Z");
  });
});

describe("the bounds of a day", () => {
  it("an ordinary day is 24 hours, from local midnight", () => {
    const { start, end } = dayRange(AMS, "2026-11-19");
    expect([iso(start), iso(end)]).toEqual(["2026-11-18T23:00:00.000Z", "2026-11-19T23:00:00.000Z"]);
  });

  it("the day the clocks go forward is 23 hours, and back is 25", () => {
    const spring = dayRange(AMS, "2026-03-29");
    const autumn = dayRange(AMS, "2026-10-25");
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000).toBe(25);
  });
});

describe("instants to minutes of a clinic day", () => {
  it("reads an instant as minutes into that local day, clamped at the edges", () => {
    expect(wallMinutes(AMS, new Date("2026-11-19T08:00:00Z"), "2026-11-19")).toBe(9 * 60);
    // 23:30 local on the 18th is before the 19th began; 00:30 local on the 20th is after it ended.
    expect(wallMinutes(AMS, new Date("2026-11-18T22:30:00Z"), "2026-11-19")).toBe(0);
    expect(wallMinutes(AMS, new Date("2026-11-19T23:30:00Z"), "2026-11-19")).toBe(24 * 60);
    // An appointment from 23:30 to 00:30 covers the last half hour of the 19th.
    expect(wallMinutes(AMS, new Date("2026-11-19T22:30:00Z"), "2026-11-19")).toBe(23 * 60 + 30);
  });
});

describe("calendar months", () => {
  it("keeps the local time of day across a clock change", () => {
    // 10:00 in Amsterdam on 15 March (UTC+1) is 10:00 on 15 April (UTC+2).
    expect(iso(addCalendarMonths(AMS, new Date("2026-03-15T09:00:00Z"), 1))).toBe("2026-04-15T08:00:00.000Z");
  });

  it("clamps the 31st to the end of a shorter month, and counts years in months", () => {
    expect(iso(addCalendarMonths(AMS, new Date("2026-01-31T09:00:00Z"), 1))).toBe("2026-02-28T09:00:00.000Z");
    expect(iso(addCalendarMonths(AMS, new Date("2026-02-15T09:00:00Z"), 12))).toBe("2027-02-15T09:00:00.000Z");
  });
});

describe("datetime inputs", () => {
  it("round-trip in the clinic's zone", () => {
    const at = new Date("2026-07-02T13:30:00Z");
    expect(toInputValue(AMS, at)).toBe("2026-07-02T15:30");
    expect(iso(fromInputValue(AMS, "2026-07-02T15:30"))).toBe(at.toISOString());
    expect(fromInputValue(AMS, "not a date")).toBeNull();
  });
});
