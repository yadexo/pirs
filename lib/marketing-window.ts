/**
 * When a marketing notification may go out.
 *
 * Two rules, both about the person receiving it rather than the clinic
 * sending it: nothing lands on a phone in the middle of the night, and one
 * clinic gets one promotional message per client per day. Service messages —
 * an order paid, an item redeemed — obey neither, because the client caused
 * them by doing something.
 *
 * Pure and timezone-explicit, so it can be tested at any hour: every function
 * takes the moment to judge and none of them reads the clock.
 */

/** Quiet from 21:00 up to 09:00, in the clinic's working timezone. */
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 9;
export const MARKETING_TIMEZONE = "Europe/Amsterdam";

/** The wall-clock parts of an instant in a timezone, without any date maths. */
function parts(at: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const found: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) if (p.type !== "literal") found[p.type] = p.value;
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // Midnight comes back as "24" from some runtimes; normalise it to 0.
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
  };
}

/** True when a marketing message would arrive during the quiet hours. */
export function isQuietHour(at: Date, timeZone: string = MARKETING_TIMEZONE): boolean {
  const { hour } = parts(at, timeZone);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/**
 * The instant a message due at `at` should actually be sent: itself when the
 * hour is decent, otherwise 09:00 on the next morning it reaches.
 *
 * Found by stepping forward rather than by arithmetic on the offset, because
 * the offset is the thing that moves: on the night the clocks change, 09:00
 * the next day is not a fixed number of hours after 21:00.
 */
export function nextSendableTime(at: Date, timeZone: string = MARKETING_TIMEZONE): Date {
  if (!isQuietHour(at, timeZone)) return at;

  const step = 15 * 60 * 1000;
  let cursor = new Date(at.getTime());
  for (let i = 0; i < 4 * 26; i++) {
    cursor = new Date(cursor.getTime() + step);
    if (!isQuietHour(cursor, timeZone)) {
      // Trim back to the top of the hour we just stepped into, so the message
      // goes at 09:00 rather than a few minutes past it.
      const { minute } = parts(cursor, timeZone);
      return new Date(cursor.getTime() - minute * 60 * 1000);
    }
  }
  return cursor;
}

/** The calendar day in the clinic's timezone, as "2026-09-28". */
export function localDayKey(at: Date, timeZone: string = MARKETING_TIMEZONE): string {
  const { year, month, day } = parts(at, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The local calendar year, for the once-a-year birthday guarantee. */
export function localYear(at: Date, timeZone: string = MARKETING_TIMEZONE): number {
  return parts(at, timeZone).year;
}

/** The local day and month, for matching a birthday. */
export function localDayAndMonth(at: Date, timeZone: string = MARKETING_TIMEZONE): { day: number; month: number } {
  const { day, month } = parts(at, timeZone);
  return { day, month };
}

/**
 * The instants that bound the local day containing `at` — used to ask "has
 * this client already had a marketing message today?" without comparing
 * strings in the database.
 */
export function localDayRange(at: Date, timeZone: string = MARKETING_TIMEZONE): { start: Date; end: Date } {
  const { hour, minute } = parts(at, timeZone);
  const start = new Date(at.getTime() - (hour * 60 + minute) * 60 * 1000);
  start.setUTCSeconds(0, 0);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}
