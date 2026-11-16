import { dayRange, todayIn } from "@/lib/clinic-time";

/**
 * Calendar-day boundaries in a clinic's own time zone. "Checked in today"
 * means the clinic's today — a server running in UTC would otherwise roll the
 * day over at 01:00 or 02:00 in Amsterdam. Kept for its callers; the
 * arithmetic lives in lib/clinic-time.ts.
 */

/** The instant the current day began in `timeZone`. */
export function startOfDayIn(timeZone: string, now = new Date()): Date {
  return dayRange(timeZone, todayIn(timeZone, now)).start;
}
