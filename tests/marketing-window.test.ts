import { describe, it, expect } from "vitest";
import { isQuietHour, localDayAndMonth, localDayKey, localYear, nextSendableTime } from "@/lib/marketing-window";

/**
 * Quiet hours are the rule most likely to be got wrong twice a year, so these
 * pin the clock changes as well as the ordinary days. Every instant is written
 * in UTC and judged in Amsterdam, which is the whole point.
 */
const utc = (iso: string) => new Date(iso);

describe("quiet hours", () => {
  it("is quiet from 21:00 to 09:00 Amsterdam time", () => {
    // Summer: Amsterdam is UTC+2.
    expect(isQuietHour(utc("2026-07-01T18:59:00Z"))).toBe(false); // 20:59 local
    expect(isQuietHour(utc("2026-07-01T19:00:00Z"))).toBe(true); // 21:00 local
    expect(isQuietHour(utc("2026-07-02T06:59:00Z"))).toBe(true); // 08:59 local
    expect(isQuietHour(utc("2026-07-02T07:00:00Z"))).toBe(false); // 09:00 local
  });

  it("follows the winter offset, not a fixed number of hours", () => {
    // Winter: Amsterdam is UTC+1, so the same UTC instant is an hour earlier.
    expect(isQuietHour(utc("2026-01-15T19:00:00Z"))).toBe(false); // 20:00 local
    expect(isQuietHour(utc("2026-01-15T20:00:00Z"))).toBe(true); // 21:00 local
    expect(isQuietHour(utc("2026-01-16T08:00:00Z"))).toBe(false); // 09:00 local
  });

  it("leaves a message alone when the hour is decent", () => {
    const at = utc("2026-07-01T10:00:00Z"); // noon local
    expect(nextSendableTime(at)).toEqual(at);
  });

  it("holds a late-night message until nine the next morning", () => {
    const sent = nextSendableTime(utc("2026-07-01T21:30:00Z")); // 23:30 local
    expect(sent.toISOString()).toBe("2026-07-02T07:00:00.000Z"); // 09:00 local
  });

  it("holds an early-morning message until nine the same day", () => {
    const sent = nextSendableTime(utc("2026-07-02T03:00:00Z")); // 05:00 local
    expect(sent.toISOString()).toBe("2026-07-02T07:00:00.000Z"); // 09:00 local
  });

  it("gets 09:00 right on the night the clocks go forward", () => {
    // 2026-03-29: Amsterdam jumps from 02:00 to 03:00, so that night is 23
    // hours long and arithmetic on the offset would land an hour out.
    const sent = nextSendableTime(utc("2026-03-28T22:00:00Z")); // 23:00 local, winter
    expect(sent.toISOString()).toBe("2026-03-29T07:00:00.000Z"); // 09:00 local, summer
  });

  it("gets 09:00 right on the night the clocks go back", () => {
    // 2026-10-25: that night is 25 hours long.
    const sent = nextSendableTime(utc("2026-10-24T22:00:00Z")); // 00:00 local
    expect(sent.toISOString()).toBe("2026-10-25T08:00:00.000Z"); // 09:00 local, winter
  });
});

describe("local calendar", () => {
  it("reads the day in Amsterdam, not UTC", () => {
    // 23:30 UTC in summer is already the next day in Amsterdam.
    expect(localDayKey(utc("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(localDayKey(utc("2026-07-01T09:30:00Z"))).toBe("2026-07-01");
  });

  it("reads the year for the birthday guarantee", () => {
    expect(localYear(utc("2026-12-31T23:30:00Z"))).toBe(2027); // already new year locally
    expect(localYear(utc("2026-06-01T12:00:00Z"))).toBe(2026);
  });

  it("reads the day and month a birthday is matched on", () => {
    expect(localDayAndMonth(utc("2026-03-14T10:00:00Z"))).toEqual({ day: 14, month: 3 });
  });
});
