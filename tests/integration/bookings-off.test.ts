/**
 * With in-app bookings off, every booking action refuses — even when called
 * directly, not through the app.
 *
 * Clinics book through their own software; the app's own booking is off until
 * a platform admin switches it on (Tenant.inAppBookings). Hiding the buttons
 * is not enough: a server action is a public endpoint, so each one checks the
 * switch for itself and answers with a plain error, writing nothing. With the
 * switch on, the same calls work as before.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { addDays, instantAt, todayIn } from "@/lib/clinic-time";

const rbacMocks = vi.hoisted(() => ({
  requireCustomerContext: vi.fn(),
  requireStaffContext: vi.fn(),
  requirePermission: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/rbac", () => rbacMocks);

const clientApp = await import("@/lib/actions/client-app");
const { updateAppointmentStatusAction } = await import("@/lib/actions/appointments");
const { BOOKINGS_OFF } = await import("@/lib/in-app-bookings");

const ZONE = "Europe/Amsterdam";

describe("booking actions with in-app bookings off", () => {
  const stamp = Date.now();
  const slug = `bookings-off-${stamp}`;
  let tenantId: string;
  let db: TenantDb;
  let serviceId: string;
  let staffProfileId: string;
  let locationId: string;
  let appointmentId: string;
  const day = addDays(todayIn(ZONE), 5);
  const tenAm = () => instantAt(ZONE, day, 10 * 60)!.toISOString();

  const appointmentRow = () => rawDb.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  const count = () => rawDb.appointment.count({ where: { tenantId } });

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "No Booking Clinic" } })).id;
    db = getTenantDb(tenantId);
    await rawDb.tenantBranding.create({ data: { tenantId, businessName: "No Booking Clinic", currency: "EUR", timeZone: ZONE } });
    await rawDb.tenantSettings.create({ data: { tenantId, vatRateBasisPoints: 0 } });
    locationId = (await rawDb.location.create({ data: { tenantId, name: "Main", isPrimary: true } })).id;
    const category = await rawDb.serviceCategory.create({ data: { tenantId, name: "General" } });
    serviceId = (await rawDb.service.create({ data: { tenantId, categoryId: category.id, name: "Consult", durationMinutes: 60, priceCents: 5000 } })).id;
    const staffUser = await rawDb.user.create({ data: { tenantId, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffProfileId = (await rawDb.staffProfile.create({ data: { tenantId, userId: staffUser.id, firstName: "Pat", lastName: "Staff", active: true } })).id;
    await rawDb.staffService.create({ data: { staffProfileId, serviceId } });
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      await rawDb.staffAvailability.create({ data: { tenantId, staffProfileId, dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 } });
    }
    const clientUser = await rawDb.user.create({ data: { tenantId, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    const profile = await rawDb.customerProfile.create({ data: { tenantId, userId: clientUser.id, firstName: "Nora", lastName: "Client" } });
    // An appointment from before the switch went off: kept, never touched.
    appointmentId = (
      await rawDb.appointment.create({
        data: { tenantId, customerProfileId: profile.id, serviceId, staffProfileId, locationId, startAt: instantAt(ZONE, day, 14 * 60)!, endAt: instantAt(ZONE, day, 15 * 60)!, status: "REQUESTED" },
      })
    ).id;

    const clientUserCtx = { id: clientUser.id, email: clientUser.email, role: "CUSTOMER", tenantId, tenantSlug: slug, staffProfileId: null, customerProfileId: profile.id, permissions: [] };
    rbacMocks.requireCustomerContext.mockResolvedValue({ db, user: clientUserCtx });
    rbacMocks.requireStaffContext.mockResolvedValue({ db, user: { id: staffUser.id, email: staffUser.email, role: "TENANT_ADMIN", tenantId, tenantSlug: null, staffProfileId, customerProfileId: null, permissions: "ALL" } });
    rbacMocks.requirePermission.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });

  it("is off for this clinic, as for every new one", async () => {
    expect((await rawDb.tenant.findUniqueOrThrow({ where: { id: tenantId } })).inAppBookings).toBe(false);
  });

  it("refuses booking options and slots", async () => {
    expect(await clientApp.getBookingOptionsForServiceAction(serviceId)).toEqual({ error: BOOKINGS_OFF });
    expect(await clientApp.getClientSlotsAction(staffProfileId, locationId, 60, day)).toEqual({ error: BOOKINGS_OFF });
  });

  it("refuses a booking and a reschedule, and writes nothing", async () => {
    const before = await count();
    expect(await clientApp.clientBookAction(slug, { serviceId, staffProfileId, locationId, startAtIso: tenAm() })).toEqual({ error: BOOKINGS_OFF });
    expect(await clientApp.clientBookAction(slug, { serviceId, staffProfileId, locationId, startAtIso: tenAm(), appointmentId })).toEqual({ error: BOOKINGS_OFF });
    expect(await count()).toBe(before);
    expect((await appointmentRow()).startAt.toISOString()).toBe(instantAt(ZONE, day, 14 * 60)!.toISOString());
  });

  it("refuses a cancellation, and the appointment stays as it was", async () => {
    expect(await clientApp.clientCancelAppointmentAction(slug, appointmentId)).toEqual({ error: BOOKINGS_OFF });
    expect((await appointmentRow()).status).toBe("REQUESTED");
  });

  it("refuses the portal's appointment changes", async () => {
    expect(await updateAppointmentStatusAction(appointmentId, "CONFIRMED")).toEqual({ error: BOOKINGS_OFF });
    expect((await appointmentRow()).status).toBe("REQUESTED");
  });

  it("with the switch on, the same calls work", async () => {
    await rawDb.tenant.update({ where: { id: tenantId }, data: { inAppBookings: true } });
    const options = await clientApp.getBookingOptionsForServiceAction(serviceId);
    expect(options && !("error" in options) && options.staff.map((s) => s.id)).toContain(staffProfileId);
    const slots = await clientApp.getClientSlotsAction(staffProfileId, locationId, 60, day);
    expect(Array.isArray(slots) && slots).toContain(tenAm());
    expect(await clientApp.clientBookAction(slug, { serviceId, staffProfileId, locationId, startAtIso: tenAm() })).toEqual({ ok: true, when: tenAm() });
    expect(await updateAppointmentStatusAction(appointmentId, "CONFIRMED")).toEqual({ ok: true });
    expect((await appointmentRow()).status).toBe("CONFIRMED");
  });
});
