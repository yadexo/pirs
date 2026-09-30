/**
 * When a marketing notification may be sent.
 *
 * Each clinic keeps its own sending window — by default 09:00 to 22:00 in its
 * own timezone. The platform holds the outer edges: nothing before 07:00,
 * nothing after 22:00, and a window has to be at least an hour wide, so a
 * clinic cannot narrow it into something that never opens or widen it into
 * someone's evening.
 *
 * Service notifications — an order, a refund, a redemption — ignore all of
 * this. The client caused them and is waiting for them.
 *
 * Pure and timezone-explicit: every function takes the moment to judge and
 * the window to judge it against, and none of them reads the clock.
 */

/** A day, in minutes. 1440 as an end means midnight, i.e. round the clock. */
export const DAY_MINUTES = 24 * 60;
/** Hours a client is likely to be asleep — a warning, not a rule. */
export const NIGHT_BEFORE_MINUTES = 8 * 60; // 08:00
export const NIGHT_AFTER_MINUTES = 22 * 60; // 22:00
/** Birthday greetings aim for this, or the window's start if that is later. */
export const BIRTHDAY_MINUTES = 9 * 60; // 09:00
/** What a clinic gets until it says otherwise. */
export const DEFAULT_WINDOW_START = 9 * 60; // 09:00
export const DEFAULT_WINDOW_END = 22 * 60; // 22:00
/** Steps the settings form offers, and the only ones accepted. */
export const WINDOW_STEP_MINUTES = 15;

export const MARKETING_TIMEZONE = "Europe/Amsterdam";

export interface SendingWindow {
  /** Minutes from local midnight. */
  startMinutes: number;
  endMinutes: number;
  timeZone: string;
}

export const DEFAULT_WINDOW: SendingWindow = {
  startMinutes: DEFAULT_WINDOW_START,
  endMinutes: DEFAULT_WINDOW_END,
  timeZone: MARKETING_TIMEZONE,
};

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

/** Minutes since local midnight, in the given timezone. */
export function minutesOfDay(at: Date, timeZone: string): number {
  const { hour, minute } = parts(at, timeZone);
  return hour * 60 + minute;
}

// ---------------------------------------------------------------------------
// Validating a clinic's choice
// ---------------------------------------------------------------------------

export type WindowProblem =
  | { ok: true }
  | { ok: false; field: "start" | "end"; message: string };

/**
 * Whether a clinic may have this window.
 *
 * The platform no longer picks the hours — a clinic may send round the
 * clock if it wants to. All that is left is arithmetic: quarter hours, in
 * a day, ending after they start. Whether late-night notifications are a
 * good idea is a judgement, and the form says so rather than refusing.
 */
export function checkWindow(startMinutes: number, endMinutes: number): WindowProblem {
  for (const [value, field, max] of [
    [startMinutes, "start", DAY_MINUTES - WINDOW_STEP_MINUTES],
    [endMinutes, "end", DAY_MINUTES],
  ] as const) {
    if (!Number.isInteger(value) || value % WINDOW_STEP_MINUTES !== 0 || value < 0 || value > max) {
      return { ok: false, field, message: "Pick a time from the list." };
    }
  }
  if (startMinutes >= endMinutes) {
    return { ok: false, field: "end", message: "The end has to be after the start." };
  }
  return { ok: true };
}

/** Round the clock: what the "send any time" checkbox stores. */
export function isAllDay(window: SendingWindow): boolean {
  return window.startMinutes === 0 && window.endMinutes >= DAY_MINUTES;
}

/**
 * Whether this window reaches into the hours people are asleep. Drives a
 * warning on the form; nothing refuses to send.
 */
export function includesNight(startMinutes: number, endMinutes: number): boolean {
  return startMinutes < NIGHT_BEFORE_MINUTES || endMinutes > NIGHT_AFTER_MINUTES;
}

/**
 * When a birthday greeting should go: nine in the morning, or the window's
 * start if the clinic does not open until later. Never at midnight because
 * a clinic switched on 24/7 for its offers.
 */
export function birthdayMinutes(window: SendingWindow): number {
  return Math.max(BIRTHDAY_MINUTES, window.startMinutes);
}

/** A stored window, corrected to something sane if the row predates the rules. */
export function windowFrom(settings: { marketingWindowStartMinutes?: number | null; marketingWindowEndMinutes?: number | null } | null, timeZone?: string | null): SendingWindow {
  const start = settings?.marketingWindowStartMinutes ?? DEFAULT_WINDOW_START;
  const end = settings?.marketingWindowEndMinutes ?? DEFAULT_WINDOW_END;
  const valid = checkWindow(start, end).ok;
  return {
    startMinutes: valid ? start : DEFAULT_WINDOW_START,
    endMinutes: valid ? end : DEFAULT_WINDOW_END,
    timeZone: timeZone || MARKETING_TIMEZONE,
  };
}

// ---------------------------------------------------------------------------
// Judging a moment
// ---------------------------------------------------------------------------

/** True when a marketing message sent now would arrive inside the window. */
export function isWithinWindow(at: Date, window: SendingWindow = DEFAULT_WINDOW): boolean {
  const minutes = minutesOfDay(at, window.timeZone);
  return minutes >= window.startMinutes && minutes < window.endMinutes;
}

/** True when it would arrive outside it — the old name, kept for readability. */
export function isQuietHour(at: Date, window: SendingWindow = DEFAULT_WINDOW): boolean {
  return !isWithinWindow(at, window);
}

/**
 * The instant a message due at `at` should actually be sent: itself when the
 * window is open, otherwise the moment it next opens.
 *
 * Found by stepping forward rather than by arithmetic on the offset, because
 * the offset is the thing that moves: on the night the clocks change, the
 * next 09:00 is not a fixed number of hours away.
 */
export function nextSendableTime(at: Date, window: SendingWindow = DEFAULT_WINDOW): Date {
  if (isWithinWindow(at, window)) return at;

  const step = WINDOW_STEP_MINUTES * 60 * 1000;
  let cursor = new Date(at.getTime());
  // A day and a half of quarter hours is more than enough to reach the next
  // opening, whatever the window and whatever the clocks did overnight.
  for (let i = 0; i < 4 * 36; i++) {
    cursor = new Date(cursor.getTime() + step);
    if (isWithinWindow(cursor, window)) {
      // Trim back to the exact minute the window opens, so a message goes at
      // 09:00 rather than a few minutes past it.
      const minutes = minutesOfDay(cursor, window.timeZone);
      const overshoot = minutes - window.startMinutes;
      return overshoot > 0 && overshoot < WINDOW_STEP_MINUTES ? new Date(cursor.getTime() - overshoot * 60 * 1000) : cursor;
    }
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

/** The calendar day in a timezone, as "2026-09-28". */
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

/**
 * The instant meant by a wall-clock time in a timezone — "2026-09-30T15:30"
 * in Europe/Amsterdam, not on whatever machine happens to run this.
 *
 * `new Date("2026-09-30T15:30")` reads that string in the *server's* zone,
 * which on Vercel is UTC. A clinic scheduling something for half past three
 * would have it sent at half past five their time. So the offset is worked
 * out from the timezone itself, and checked a second time because the offset
 * can differ either side of the moment in question — which is exactly what
 * happens on the two nights a year the clocks change.
 *
 * Returns null for anything that isn't a wall-clock string.
 */
export function instantFromLocal(wallClock: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wallClock.trim());
  if (!m) return null;
  const [, year, month, day, hour, minute] = m.map(Number) as [number, number, number, number, number, number];

  // Start from the same wall clock read as UTC, then subtract the zone's
  // offset at that moment. One correction is enough for every hour except the
  // ones the clocks skip, so it is applied twice and the second is trusted.
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(naive - offsetAt(new Date(naive), timeZone));
  guess = new Date(naive - offsetAt(guess, timeZone));
  return Number.isNaN(guess.getTime()) ? null : guess;
}

/** How far ahead of UTC a zone is at an instant, in milliseconds. */
function offsetAt(at: Date, timeZone: string): number {
  const p = parts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Seconds and milliseconds are not part of a wall-clock input.
  const rounded = Math.floor(at.getTime() / 60000) * 60000;
  return asUtc - rounded;
}

/** The wall-clock string for an instant in a timezone, for a datetime-local input. */
export function localInputValue(at: Date, timeZone: string): string {
  const p = parts(at, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "09:00" for 540 — used by the settings form and in messages to clinics. */
export function formatWindowTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Every time a clinic may pick, in quarter hours across the allowed range. */
export function windowChoices(kind: "start" | "end" = "start"): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [];
  const first = kind === "start" ? 0 : WINDOW_STEP_MINUTES;
  const last = kind === "start" ? DAY_MINUTES - WINDOW_STEP_MINUTES : DAY_MINUTES;
  for (let m = first; m <= last; m += WINDOW_STEP_MINUTES) {
    // 1440 is midnight at the far end of the day, written as 24:00 so it
    // reads as "until the end of the day" rather than "until it began".
    out.push({ value: m, label: m === DAY_MINUTES ? "24:00" : formatWindowTime(m) });
  }
  return out;
}
