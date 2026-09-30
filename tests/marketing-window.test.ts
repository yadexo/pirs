import { describe, it, expect } from "vitest";
import {
  DEFAULT_WINDOW,
  DEFAULT_WINDOW_END,
  DEFAULT_WINDOW_START,
  DAY_MINUTES,
  birthdayMinutes,
  checkWindow,
  formatWindowTime,
  includesNight,
  isAllDay,
  isWithinWindow,
  localDayAndMonth,
  localDayKey,
  localYear,
  minutesOfDay,
  nextSendableTime,
  windowChoices,
  windowFrom,
  type SendingWindow,
} from "@/lib/marketing-window";

/**
 * The sending window is the rule most likely to be got wrong twice a year, so
 * these pin the clock changes as well as the ordinary days. Every instant is
 * written in UTC and judged in a named timezone, which is the whole point.
 */
const utc = (iso: string) => new Date(iso);
const window = (startHour: number, endHour: number, timeZone = "Europe/Amsterdam"): SendingWindow => ({
  startMinutes: startHour * 60,
  endMinutes: endHour * 60,
  timeZone,
});

describe("the default window", () => {
  it("is 09:00 to 22:00", () => {
    expect(DEFAULT_WINDOW_START).toBe(9 * 60);
    expect(DEFAULT_WINDOW_END).toBe(22 * 60);
    expect(formatWindowTime(DEFAULT_WINDOW.startMinutes)).toBe("09:00");
    expect(formatWindowTime(DEFAULT_WINDOW.endMinutes)).toBe("22:00");
  });

  it("is open through the evening, up to but not including the end", () => {
    // Summer: Amsterdam is UTC+2.
    expect(isWithinWindow(utc("2026-07-01T19:00:00Z"))).toBe(true); // 21:00 local — used to be quiet
    expect(isWithinWindow(utc("2026-07-01T19:59:00Z"))).toBe(true); // 21:59 local
    expect(isWithinWindow(utc("2026-07-01T20:00:00Z"))).toBe(false); // 22:00 local
    expect(isWithinWindow(utc("2026-07-02T06:59:00Z"))).toBe(false); // 08:59 local
    expect(isWithinWindow(utc("2026-07-02T07:00:00Z"))).toBe(true); // 09:00 local
  });

  it("follows the winter offset rather than a fixed number of hours", () => {
    expect(isWithinWindow(utc("2026-01-15T20:00:00Z"))).toBe(true); // 21:00 local
    expect(isWithinWindow(utc("2026-01-15T21:00:00Z"))).toBe(false); // 22:00 local
    expect(isWithinWindow(utc("2026-01-16T08:00:00Z"))).toBe(true); // 09:00 local
  });
});

describe("holding a message until the window opens", () => {
  it("leaves one alone when the window is open", () => {
    const at = utc("2026-07-01T10:00:00Z"); // noon local
    expect(nextSendableTime(at)).toEqual(at);
  });

  it("holds a late-night message until the next morning", () => {
    const sent = nextSendableTime(utc("2026-07-01T21:30:00Z")); // 23:30 local
    expect(sent.toISOString()).toBe("2026-07-02T07:00:00.000Z"); // 09:00 local
  });

  it("holds an early-morning message until the same morning", () => {
    const sent = nextSendableTime(utc("2026-07-02T03:00:00Z")); // 05:00 local
    expect(sent.toISOString()).toBe("2026-07-02T07:00:00.000Z"); // 09:00 local
  });

  it("opens at the clinic's own hour, not the default", () => {
    // A clinic that sends from 07:30: a 05:00 message waits two and a half
    // hours, not four.
    const early: SendingWindow = { startMinutes: 7 * 60 + 30, endMinutes: 20 * 60, timeZone: "Europe/Amsterdam" };
    const sent = nextSendableTime(utc("2026-07-02T03:00:00Z"), early); // 05:00 local
    expect(sent.toISOString()).toBe("2026-07-02T05:30:00.000Z"); // 07:30 local
  });

  it("holds until tomorrow when the clinic's window has already closed", () => {
    const shortDay = window(9, 17);
    const sent = nextSendableTime(utc("2026-07-01T16:00:00Z"), shortDay); // 18:00 local
    expect(sent.toISOString()).toBe("2026-07-02T07:00:00.000Z"); // 09:00 local next day
  });

  it("gets the opening right on the night the clocks go forward", () => {
    // 2026-03-29: Amsterdam jumps 02:00 to 03:00, so that night is 23 hours.
    const sent = nextSendableTime(utc("2026-03-28T22:00:00Z")); // 23:00 local, winter
    expect(sent.toISOString()).toBe("2026-03-29T07:00:00.000Z"); // 09:00 local, summer
  });

  it("gets the opening right on the night the clocks go back", () => {
    // 2026-10-25: that night is 25 hours.
    const sent = nextSendableTime(utc("2026-10-24T22:00:00Z")); // 00:00 local
    expect(sent.toISOString()).toBe("2026-10-25T08:00:00.000Z"); // 09:00 local, winter
  });

  it("works for a clinic in another timezone entirely", () => {
    const lisbon = window(9, 18, "Europe/Lisbon"); // UTC+1 in summer
    // The same instant is inside an Amsterdam window and outside a Lisbon one,
    // because Lisbon is an hour behind: 09:30 there, 08:30 here.
    expect(minutesOfDay(utc("2026-07-01T07:30:00Z"), "Europe/Lisbon")).toBe(8 * 60 + 30);
    expect(isWithinWindow(utc("2026-07-01T07:30:00Z"), lisbon)).toBe(false);
    expect(isWithinWindow(utc("2026-07-01T07:30:00Z"), window(9, 18))).toBe(true);
    // And it opens an hour later in UTC terms for the Lisbon clinic.
    expect(nextSendableTime(utc("2026-07-01T07:30:00Z"), lisbon).toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });
});

describe("what a clinic may choose", () => {
  it("accepts an ordinary window", () => {
    expect(checkWindow(9 * 60, 18 * 60)).toEqual({ ok: true });
    expect(checkWindow(7 * 60, 22 * 60)).toEqual({ ok: true });
  });

  it("accepts the night, and the whole day, because that is the clinic's call", () => {
    expect(checkWindow(0, DAY_MINUTES)).toEqual({ ok: true }); // 24/7
    expect(checkWindow(6 * 60, 23 * 60)).toEqual({ ok: true });
    expect(checkWindow(22 * 60, DAY_MINUTES)).toEqual({ ok: true });
    // A quarter of an hour is a real window, even if it is a small one.
    expect(checkWindow(9 * 60, 9 * 60 + 15)).toEqual({ ok: true });
  });

  it("still refuses a window that ends before it starts", () => {
    expect(checkWindow(18 * 60, 9 * 60)).toMatchObject({ ok: false, field: "end" });
    expect(checkWindow(9 * 60, 9 * 60)).toMatchObject({ ok: false, field: "end" });
  });

  it("refuses times that are not on the quarter hour, or off the clock", () => {
    expect(checkWindow(9 * 60 + 7, 18 * 60)).toMatchObject({ ok: false, field: "start" });
    expect(checkWindow(-15, 18 * 60)).toMatchObject({ ok: false, field: "start" });
    expect(checkWindow(9 * 60, DAY_MINUTES + 15)).toMatchObject({ ok: false, field: "end" });
    // Midnight is an end, not a start: a window has to have somewhere to go.
    expect(checkWindow(DAY_MINUTES, DAY_MINUTES)).toMatchObject({ ok: false, field: "start" });
  });

  it("offers every quarter hour, with 24:00 only as an end", () => {
    const starts = windowChoices("start");
    const ends = windowChoices("end");
    expect(starts[0]).toEqual({ value: 0, label: "00:00" });
    expect(starts[starts.length - 1]).toEqual({ value: DAY_MINUTES - 15, label: "23:45" });
    expect(ends[0]).toEqual({ value: 15, label: "00:15" });
    expect(ends[ends.length - 1]).toEqual({ value: DAY_MINUTES, label: "24:00" });
    expect(starts).toHaveLength(96);
    expect(ends).toHaveLength(96);
  });

  it("sends round the clock when the window is the whole day", () => {
    const allDay: SendingWindow = { startMinutes: 0, endMinutes: DAY_MINUTES, timeZone: "Europe/Amsterdam" };
    expect(isAllDay(allDay)).toBe(true);
    expect(isAllDay(window(9, 22))).toBe(false);
    for (const hour of [0, 3, 7, 13, 21, 23]) {
      const at = utc(`2026-07-01T${String((hour + 22) % 24).padStart(2, "0")}:00:00Z`);
      expect(isWithinWindow(at, allDay)).toBe(true);
      expect(nextSendableTime(at, allDay)).toEqual(at);
    }
  });

  it("warns about night hours without refusing them", () => {
    expect(includesNight(9 * 60, 22 * 60)).toBe(false);
    expect(includesNight(8 * 60, 22 * 60)).toBe(false);
    expect(includesNight(7 * 60, 22 * 60)).toBe(true);
    expect(includesNight(9 * 60, 22 * 60 + 15)).toBe(true);
    expect(includesNight(0, DAY_MINUTES)).toBe(true);
  });

  it("sends birthday greetings at nine, or later if the clinic opens later", () => {
    // 24/7 must not mean happy birthday at midnight.
    expect(birthdayMinutes({ startMinutes: 0, endMinutes: DAY_MINUTES, timeZone: "UTC" })).toBe(9 * 60);
    expect(birthdayMinutes(window(7, 20))).toBe(9 * 60);
    expect(birthdayMinutes(window(11, 20))).toBe(11 * 60);
  });
});

describe("reading a clinic's stored window", () => {
  it("uses what the clinic saved", () => {
    expect(windowFrom({ marketingWindowStartMinutes: 8 * 60, marketingWindowEndMinutes: 20 * 60 }, "Europe/Lisbon")).toEqual({
      startMinutes: 8 * 60,
      endMinutes: 20 * 60,
      timeZone: "Europe/Lisbon",
    });
  });

  it("falls back to the default for a clinic that never set one", () => {
    expect(windowFrom(null, null)).toEqual(DEFAULT_WINDOW);
  });

  it("keeps an early or late window, because that is now the clinic's to choose", () => {
    expect(windowFrom({ marketingWindowStartMinutes: 2 * 60, marketingWindowEndMinutes: 23 * 60 }, "Europe/Amsterdam")).toEqual({
      startMinutes: 2 * 60,
      endMinutes: 23 * 60,
      timeZone: "Europe/Amsterdam",
    });
  });

  it("ignores a stored pair that could never send at all", () => {
    // End before start: nothing would ever go out. The default is safer than
    // silence, and no form can produce this.
    expect(windowFrom({ marketingWindowStartMinutes: 20 * 60, marketingWindowEndMinutes: 8 * 60 }, "Europe/Amsterdam")).toEqual(DEFAULT_WINDOW);
  });
});

describe("local calendar", () => {
  it("reads the day in the clinic's timezone, not UTC", () => {
    expect(localDayKey(utc("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(localDayKey(utc("2026-07-01T09:30:00Z"))).toBe("2026-07-01");
  });

  it("reads the year for the birthday guarantee", () => {
    expect(localYear(utc("2026-12-31T23:30:00Z"))).toBe(2027);
    expect(localYear(utc("2026-06-01T12:00:00Z"))).toBe(2026);
  });

  it("reads the day and month a birthday is matched on", () => {
    expect(localDayAndMonth(utc("2026-03-14T10:00:00Z"))).toEqual({ day: 14, month: 3 });
  });
});
