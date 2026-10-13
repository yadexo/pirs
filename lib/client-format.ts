/**
 * Dates, times and numbers for the client app, formatted the same everywhere.
 *
 * Every function here pins both the locale and the time zone, and none of them
 * may be replaced by a bare toLocaleString. The page is rendered twice — once
 * on the server and once on the phone — and those two machines do not agree:
 * Node resolved toLocaleTimeString([]) to "15:00" while Chrome resolved it to
 * "03:00 PM", which React saw as a text that changed under it and threw out
 * the whole hydrated tree (#418).
 *
 * The time zone is the clinic's, not the phone's. An appointment at 15:00 is
 * at 15:00 at the clinic; a client reading the app from another country wants
 * the time they have to be there, not the time it is for them.
 */

/** One locale for the whole app, so the server and the phone agree. */
export const APP_LOCALE = "en-GB";

/** Used when a clinic has no time zone set. */
export const FALLBACK_TIME_ZONE = "Europe/Amsterdam";

const dayCache = new Map<string, Intl.DateTimeFormat>();
function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = dayCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(APP_LOCALE, options);
    dayCache.set(key, f);
  }
  return f;
}

const zone = (timeZone?: string | null) => timeZone || FALLBACK_TIME_ZONE;

/** "22 Aug" — for a shelf label or an offer's end date. */
export function formatShortDay(iso: string | Date, timeZone?: string | null): string {
  const tz = zone(timeZone);
  return formatter(`short:${tz}`, { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
}

/** "22 Aug 2026" — for anything a client may need to quote back. */
export function formatDay(iso: string | Date, timeZone?: string | null): string {
  const tz = zone(timeZone);
  return formatter(`day:${tz}`, { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));
}

/** "15:00", always 24-hour: the clinic's own way of writing an appointment. */
export function formatTime(iso: string | Date, timeZone?: string | null): string {
  const tz = zone(timeZone);
  return formatter(`time:${tz}`, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));
}

/** "Mon 22 Aug" — the label on a day in the booking picker. */
export function formatWeekday(iso: string | Date, timeZone?: string | null): string {
  const tz = zone(timeZone);
  return formatter(`wd:${tz}`, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
}

/** "1,234" — pinned, because a phone set to Dutch would write "1.234". */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(APP_LOCALE).format(value);
}

/* Money stays in components/client-app/ui.tsx: its locale is "en" and must
   not become "en-GB", which writes a US price as "US$49.00". That one is
   already pinned, which is all hydration asks of it. */
