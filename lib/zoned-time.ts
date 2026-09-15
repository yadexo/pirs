/**
 * Calendar-day boundaries in a clinic's own time zone. "Checked in today"
 * means the clinic's today — a server running in UTC would otherwise roll the
 * day over at 01:00 or 02:00 in Amsterdam.
 */

/** Milliseconds the zone is ahead of UTC at a given instant. */
function offsetMs(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the current day began in `timeZone`. */
export function startOfDayIn(timeZone: string, now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const utcMidnight = new Date(`${ymd}T00:00:00Z`);
  // Correct by the offset at that moment, then once more in case a DST change
  // falls between the guess and the answer.
  let result = new Date(utcMidnight.getTime() - offsetMs(timeZone, utcMidnight));
  result = new Date(utcMidnight.getTime() - offsetMs(timeZone, result));
  return result;
}
