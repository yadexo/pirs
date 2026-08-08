import "server-only";
import type { TenantDb } from "@/lib/tenant-db";

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

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function minutesToDate(day: Date, minutes: number) {
  const d = startOfDay(day);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

const SLOT_INCREMENT_MINUTES = 15;

export async function getAvailableSlots(
  db: TenantDb,
  params: { staffProfileId: string; locationId: string; serviceDurationMinutes: number; date: Date },
): Promise<Date[]> {
  const dayStart = startOfDay(params.date);
  const dayEnd = minutesToDate(params.date, 24 * 60);
  const dayOfWeek = dayStart.getDay();

  const [availabilityRows, appointments, blockedTimes] = await Promise.all([
    db.staffAvailability.findMany({
      where: { staffProfileId: params.staffProfileId, dayOfWeek, active: true },
    }),
    db.appointment.findMany({
      where: {
        staffProfileId: params.staffProfileId,
        status: { in: ["REQUESTED", "CONFIRMED"] },
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

  const toMinutes = (d: Date) => Math.round((d.getTime() - dayStart.getTime()) / 60000);

  for (const appt of appointments) {
    windows = subtractInterval(windows, Math.max(0, toMinutes(appt.startAt)), Math.min(24 * 60, toMinutes(appt.endAt)));
  }
  for (const block of blockedTimes) {
    windows = subtractInterval(windows, Math.max(0, toMinutes(block.startAt)), Math.min(24 * 60, toMinutes(block.endAt)));
  }

  const now = new Date();
  const isToday = dayStart.toDateString() === now.toDateString();
  const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : -1;

  const slots: Date[] = [];
  for (const w of windows) {
    for (let t = w.start; t + params.serviceDurationMinutes <= w.end; t += SLOT_INCREMENT_MINUTES) {
      if (t <= nowMinutes) continue;
      slots.push(minutesToDate(params.date, t));
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}
