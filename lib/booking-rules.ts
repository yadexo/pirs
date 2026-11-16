import "server-only";
import type { TenantDb } from "@/lib/tenant-db";
import type { Prisma } from "@prisma/client";
import { rawDb } from "@/lib/db";
import { getAvailableSlots } from "@/lib/availability";
import { lockRow, LOCKED_CLAIM } from "@/lib/row-lock";

export const SLOT_TAKEN = "That time was just taken. Please pick another.";
export const CHOOSE_AGAIN = "That staff member or location isn't available any more. Please choose again.";

/**
 * Everything that must be true for a client to hold this time, whether the
 * appointment is new or being moved. One function, so a reschedule cannot be
 * held to fewer rules than a booking (docs/security/review-2026-11-pass2.md,
 * B-1).
 *
 * Every lookup goes through the clinic's own scoped client: another clinic's
 * practitioner or location is simply not found.
 *
 * Returns the message to show, or null when the time can be booked.
 */
export async function bookingProblem(
  db: TenantDb,
  params: {
    serviceId: string;
    durationMinutes: number;
    staffProfileId: string;
    locationId: string;
    startAt: Date;
    excludeAppointmentId?: string;
  },
): Promise<string | null> {
  if (params.startAt.getTime() <= Date.now()) return SLOT_TAKEN;

  const [staff, location, assigned] = await Promise.all([
    db.staffProfile.findFirst({
      where: { id: params.staffProfileId, active: true },
      select: { id: true, services: { where: { serviceId: params.serviceId }, select: { serviceId: true } } },
    }),
    db.location.findFirst({ where: { id: params.locationId, active: true }, select: { id: true } }),
    // A service with practitioners assigned is booked with one of them. One
    // with none assigned, in a clinic that never set that up, is open to any.
    db.staffService.count({ where: { serviceId: params.serviceId } }),
  ]);
  if (!staff || !location) return CHOOSE_AGAIN;
  if (assigned > 0 && staff.services.length === 0) return CHOOSE_AGAIN;

  const slots = await getAvailableSlots(db, {
    staffProfileId: staff.id,
    locationId: location.id,
    serviceDurationMinutes: params.durationMinutes,
    date: params.startAt,
    excludeAppointmentId: params.excludeAppointmentId,
  });
  if (!slots.some((s) => s.getTime() === params.startAt.getTime())) return SLOT_TAKEN;
  return null;
}

/**
 * Writes a booking only if the slot is still free, with nobody else able to
 * take it in between.
 *
 * `bookingProblem` decides whether the time is bookable at all; this is the
 * last step. It locks the practitioner's row, checks for an overlapping
 * appointment on the transaction's own connection, and runs `write` in the
 * same transaction. Simultaneous bookings of one slot queue on the lock, and
 * every one after the first finds the first one's appointment. Eight at once
 * used to all succeed (docs/security/review-2026-11-pass2.md, B-2).
 *
 * Returns null when the slot was taken.
 */
export async function holdSlot<T>(
  slot: { tenantId: string; staffProfileId: string; startAt: Date; endAt: Date; excludeAppointmentId?: string },
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  return rawDb.$transaction(async (tx) => {
    if (!(await lockRow(tx, "StaffProfile", slot.staffProfileId, slot.tenantId))) return null;
    const clash = await tx.appointment.findFirst({
      where: {
        tenantId: slot.tenantId,
        staffProfileId: slot.staffProfileId,
        status: { in: ["REQUESTED", "CONFIRMED"] },
        startAt: { lt: slot.endAt },
        endAt: { gt: slot.startAt },
        ...(slot.excludeAppointmentId ? { id: { not: slot.excludeAppointmentId } } : {}),
      },
      select: { id: true },
    });
    if (clash) return null;
    return write(tx);
  }, LOCKED_CLAIM);
}
