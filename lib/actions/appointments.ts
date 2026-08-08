"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCustomerContext, requireStaffContext, requirePermission } from "@/lib/rbac";
import { getAvailableSlots } from "@/lib/availability";
import { writeAuditLog } from "@/lib/audit";

export async function getBookingOptionsAction(serviceId: string) {
  const { db } = await requireCustomerContext();
  const service = await db.service.findFirst({ where: { id: serviceId, active: true } });
  if (!service) return null;

  const staff = await db.staffProfile.findMany({
    where: { active: true, services: { some: { serviceId } } },
    include: { locations: { include: { location: true } } },
  });
  const locations = await db.location.findMany({ where: { active: true } });

  return { service, staff, locations };
}

export async function getSlotsAction(staffProfileId: string, locationId: string, serviceDurationMinutes: number, dateIso: string) {
  const { db } = await requireCustomerContext();
  const slots = await getAvailableSlots(db, {
    staffProfileId,
    locationId,
    serviceDurationMinutes,
    date: new Date(dateIso),
  });
  return slots.map((s) => s.toISOString());
}

export async function bookAppointmentAction(
  tenantSlug: string,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error: string } | undefined> {
  const { db, user } = await requireCustomerContext();

  const serviceId = String(formData.get("serviceId") ?? "");
  const staffProfileId = String(formData.get("staffProfileId") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  const startAtIso = String(formData.get("startAt") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || undefined;

  if (!serviceId || !staffProfileId || !locationId || !startAtIso) return { error: "Please choose a service, staff member, and time." };

  const service = await db.service.findFirst({ where: { id: serviceId, active: true } });
  if (!service) return { error: "Service not found." };

  const startAt = new Date(startAtIso);
  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60000);

  const slots = await getAvailableSlots(db, {
    staffProfileId,
    locationId,
    serviceDurationMinutes: service.durationMinutes,
    date: startAt,
  });
  const stillAvailable = slots.some((s) => s.getTime() === startAt.getTime());
  if (!stillAvailable) return { error: "That time was just booked. Please choose another slot." };

  await db.appointment.create({
    data: {
      customerProfileId: user.customerProfileId!,
      serviceId,
      staffProfileId,
      locationId,
      startAt,
      endAt,
      status: "CONFIRMED",
      notes,
    } as never,
  });

  revalidatePath(`/${tenantSlug}/appointments`);
  redirect(`/${tenantSlug}/appointments?booked=1`);
}

async function assertCancellable(db: Awaited<ReturnType<typeof requireCustomerContext>>["db"], startAt: Date) {
  const settings = await db.tenantSettings.findFirst({ where: {} });
  const hoursNeeded = settings?.appointmentCancellationHours ?? 24;
  const hoursUntil = (startAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < hoursNeeded) {
    throw new Error(`Cancellations require at least ${hoursNeeded} hours notice.`);
  }
}

export async function cancelAppointmentAction(tenantSlug: string, appointmentId: string) {
  const { db, user } = await requireCustomerContext();
  const appt = await db.appointment.findFirst({ where: { id: appointmentId, customerProfileId: user.customerProfileId! } });
  if (!appt) throw new Error("Appointment not found.");
  await assertCancellable(db, appt.startAt);

  await db.appointment.updateMany({
    where: { id: appointmentId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "CUSTOMER" },
  });
  revalidatePath(`/${tenantSlug}/appointments`);
}

export async function rescheduleAppointmentAction(tenantSlug: string, appointmentId: string, newStartIso: string) {
  const { db, user } = await requireCustomerContext();
  const appt = await db.appointment.findFirst({ where: { id: appointmentId, customerProfileId: user.customerProfileId! }, include: { service: true } });
  if (!appt) throw new Error("Appointment not found.");
  await assertCancellable(db, appt.startAt);

  const newStart = new Date(newStartIso);
  const slots = await getAvailableSlots(db, {
    staffProfileId: appt.staffProfileId,
    locationId: appt.locationId,
    serviceDurationMinutes: appt.service.durationMinutes,
    date: newStart,
  });
  if (!slots.some((s) => s.getTime() === newStart.getTime())) throw new Error("That time is no longer available.");

  const newEnd = new Date(newStart.getTime() + appt.service.durationMinutes * 60000);
  await db.appointment.updateMany({
    where: { id: appointmentId },
    data: { startAt: newStart, endAt: newEnd, status: "CONFIRMED" },
  });
  revalidatePath(`/${tenantSlug}/appointments`);
}

// ---------------------------------------------------------------------------
// Staff / admin
// ---------------------------------------------------------------------------

export async function updateAppointmentStatusAction(
  appointmentId: string,
  status: "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW",
) {
  await requirePermission("appointments.manage");
  const { db, user } = await requireStaffContext();

  await db.appointment.updateMany({
    where: { id: appointmentId },
    data: {
      status,
      cancelledAt: status === "CANCELLED" ? new Date() : undefined,
      cancelledBy: status === "CANCELLED" ? "STAFF" : undefined,
    },
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: `appointment.${status.toLowerCase()}`,
    entityType: "Appointment",
    entityId: appointmentId,
  });

  revalidatePath("/admin/appointments");
  revalidatePath("/admin/calendar");
}

export async function setStaffAvailabilityAction(_prevState: unknown, formData: FormData) {
  await requirePermission("appointments.manage");
  const { db } = await requireStaffContext();

  const staffProfileId = String(formData.get("staffProfileId") ?? "");
  const dayOfWeek = Number(formData.get("dayOfWeek") ?? -1);
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");

  if (!staffProfileId || dayOfWeek < 0 || !startTime || !endTime) return { error: "All fields are required." };

  const [sh = 0, sm = 0] = startTime.split(":").map(Number);
  const [eh = 0, em = 0] = endTime.split(":").map(Number);
  const startMinute = sh * 60 + sm;
  const endMinute = eh * 60 + em;
  if (endMinute <= startMinute) return { error: "End time must be after start time." };

  await db.staffAvailability.create({
    data: { staffProfileId, dayOfWeek, startMinute, endMinute, active: true } as never,
  });

  revalidatePath("/admin/staff");
  return { success: true };
}

export async function removeStaffAvailabilityAction(id: string) {
  await requirePermission("appointments.manage");
  const { db } = await requireStaffContext();
  await db.staffAvailability.deleteMany({ where: { id } });
  revalidatePath("/admin/staff");
}
