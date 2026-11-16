import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Calendar days and wall-clock times in a clinic's own time zone.
 *
 * The one place a day or a wall-clock time becomes an instant, or the other
 * way round. Instants are stored in UTC; a day is passed around as the string
 * "2026-11-19", which means the same day on every server and every phone.
 *
 * Nothing here reads the process's own zone. The booking sheet once built
 * "midnight" in the browser's zone and the slot engine read it in the
 * server's, so a client who picked Thursday was booked on another day at
 * another hour.
 *
 * The two nights a year the clocks change are handled, not ignored: a day
 * can be 23 or 25 hours long, a time the clocks skip does not exist, and a
 * time that happens twice means its first occurrence.
 */

/** A calendar day, "YYYY-MM-DD". */
export type DayKey = string;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL = "yyyy-MM-dd'T'HH:mm";
const pad = (n: number) => String(n).padStart(2, "0");

export function isDayKey(value: string): value is DayKey {
  const m = DAY_KEY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The clinic's calendar day at an instant. */
export function todayIn(timeZone: string, at: Date = new Date()): DayKey {
  return formatInTimeZone(at, timeZone, "yyyy-MM-dd");
}

/** A calendar day n days later (or earlier). Pure date arithmetic, no zone involved. */
export function addDays(day: DayKey, n: number): DayKey {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 for Sunday to 6 for Saturday, as StaffAvailability.dayOfWeek counts. */
export function weekdayOf(day: DayKey): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/**
 * The instant of a wall-clock time on a clinic's calendar day, or null when
 * the clocks skip it. When the clocks go back the hour happens twice; this is
 * the first.
 */
export function instantAt(timeZone: string, day: DayKey, minuteOfDay: number): Date | null {
  const wall = `${day}T${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
  const instant = fromZonedTime(`${wall}:00`, timeZone);
  if (Number.isNaN(instant.getTime()) || formatInTimeZone(instant, timeZone, WALL) !== wall) return null;
  // date-fns-tz answers the second of two occurrences; an hour earlier may be the first.
  const earlier = new Date(instant.getTime() - 3_600_000);
  return formatInTimeZone(earlier, timeZone, WALL) === wall ? earlier : instant;
}

/** The first instant of a clinic's calendar day, even where the clocks skip midnight. */
function dayStart(timeZone: string, day: DayKey): Date {
  for (let minute = 0; minute < 24 * 60; minute += 15) {
    const at = instantAt(timeZone, day, minute);
    if (at) return at;
  }
  throw new Error(`No time exists on ${day} in ${timeZone}`);
}

/** From the clinic's local midnight to the next one: 23 or 25 hours on the days the clocks change. */
export function dayRange(timeZone: string, day: DayKey): { start: Date; end: Date } {
  return { start: dayStart(timeZone, day), end: dayStart(timeZone, addDays(day, 1)) };
}

/**
 * Minutes into a clinic's calendar day at an instant: 0 if it falls before
 * that day, 1440 if after. For laying appointments over a day's schedule.
 */
export function wallMinutes(timeZone: string, at: Date, day: DayKey): number {
  const local = formatInTimeZone(at, timeZone, WALL);
  const localDay = local.slice(0, 10);
  if (localDay < day) return 0;
  if (localDay > day) return 24 * 60;
  return Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
}

/**
 * The same local date and time n months later — the 31st becomes the last
 * day of a shorter month. Across a clock change the local time stays; the
 * UTC instant moves by the hour.
 */
export function addCalendarMonths(timeZone: string, at: Date, months: number): Date {
  const local = formatInTimeZone(at, timeZone, "yyyy-MM-dd'T'HH:mm:ss.SSS");
  const [y, m, d] = local.slice(0, 10).split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
  // A time the clocks skip on the new date moves forward with them.
  return fromZonedTime(`${day}T${local.slice(11)}`, timeZone);
}

/** "2026-07-02T15:30" for a datetime-local input, in the clinic's zone. */
export function toInputValue(timeZone: string, at: Date): string {
  return formatInTimeZone(at, timeZone, WALL);
}

/**
 * The instant a datetime-local value means in the clinic's zone, or null for
 * anything that is not one. A time the clocks skip moves forward with them,
 * which is what a person setting "02:30" on that night means.
 */
export function fromInputValue(timeZone: string, value: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m || !isDayKey(m[1]!)) return null;
  const minute = Number(m[2]) * 60 + Number(m[3]);
  if (minute >= 24 * 60) return null;
  return instantAt(timeZone, m[1]!, minute) ?? fromZonedTime(`${m[1]}T${m[2]}:${m[3]}:00`, timeZone);
}
