import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import { dayRange, instantAt, todayIn, wallMinutes, weekdayOf, type DayKey } from "@/lib/clinic-time";

export interface FreeWindow {
  start: number; // minutes after midnight
  end: number;
}

function subtractInterval(windows: FreeWindow[], busyStart: number, busyEnd: number): FreeWindow[] {
  const result: FreeWindow[] = [];
  for (const w of windows) {
    if (busyEnd <= w.start || busyStart >= w.end) {
      result.push(w);
      continue;
    }
    if (busyStart > w.start) result.push({ start: w.start, end: Math.min(busyStart, w.end) });
    if (busyEnd < w.end) result.push({ start: Math.max(busyEnd, w.start), end: w.end });
  }
  return result.filter((w) => w.end > w.start);
}

const SLOT_INCREMENT_MINUTES = 15;

/**
 * The times a practitioner can start a treatment on one of the clinic's
 * calendar days.
 *
 * Everything is the clinic's: the day is a "YYYY-MM-DD" in the clinic's time
 * zone, the practitioner's hours are minutes of that day, and appointments
 * and blocked times are read as minutes of that day too (lib/clinic-time.ts).
 * Only the free wall-clock times are turned into instants, at the end. This
 * once worked from an instant and the server's own zone, so a client in
 * Amsterdam picking Thursday got Wednesday's hours, an hour or two off.
 *
 * A wall-clock time the clocks skip is not offered; one that happens twice is
 * offered once. A past day has no slots; today has none before "now".
 */
export async function getAvailableSlots(
  db: TenantDb,
  params: {
    staffProfileId: string;
    locationId: string;
    serviceDurationMinutes: number;
    day: DayKey;
    timeZone: string;
    /** The appointment being moved: it does not stand in its own way. */
    excludeAppointmentId?: string;
    now?: Date;
  },
): Promise<Date[]> {
  const { day, timeZone } = params;
  const now = params.now ?? new Date();
  if (day < todayIn(timeZone, now)) return [];
  const { start: dayStart, end: dayEnd } = dayRange(timeZone, day);
  const dayOfWeek = weekdayOf(day);

  const [availabilityRows, appointments, blockedTimes] = await Promise.all([
    db.staffAvailability.findMany({
      where: { staffProfileId: params.staffProfileId, dayOfWeek, active: true },
    }),
    db.appointment.findMany({
      where: {
        staffProfileId: params.staffProfileId,
        status: { in: ["REQUESTED", "CONFIRMED"] },
        ...(params.excludeAppointmentId ? { id: { not: params.excludeAppointmentId } } : {}),
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
    }),
    db.blockedTime.findMany({
      where: {
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
        OR: [
          { staffProfileId: params.staffProfileId },
          { staffProfileId: null, locationId: params.locationId },
          { staffProfileId: null, locationId: null },
        ],
      },
    }),
  ]);

  let windows: FreeWindow[] = availabilityRows.map((a) => ({ start: a.startMinute, end: a.endMinute }));

  for (const a of availabilityRows) {
    if (a.breakStartMinute != null && a.breakEndMinute != null) {
      windows = subtractInterval(windows, a.breakStartMinute, a.breakEndMinute);
    }
  }

  for (const busy of [...appointments, ...blockedTimes]) {
    windows = subtractInterval(windows, wallMinutes(timeZone, busy.startAt, day), wallMinutes(timeZone, busy.endAt, day));
  }

  const seen = new Set<number>();
  const slots: Date[] = [];
  for (const w of windows) {
    for (let t = w.start; t + params.serviceDurationMinutes <= w.end; t += SLOT_INCREMENT_MINUTES) {
      const at = instantAt(timeZone, day, t);
      if (!at || at.getTime() <= now.getTime() || seen.has(at.getTime())) continue;
      seen.add(at.getTime());
      slots.push(at);
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}
