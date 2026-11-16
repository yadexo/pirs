/**
 * Rescheduling is booking: the same rules, and nothing a client sends can
 * reach beyond their own appointment.
 *
 * docs/security/review-2026-11-pass2.md, I-3, B-1 and R-3. An object sent as
 * `appointmentId` matched the client's own appointment in the ownership
 * check and then every appointment of the clinic in the update; and a
 * reschedule skipped availability altogether, so a client could move onto a
 * taken slot, a closed hour, or another clinic's practitioner.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { getAvailableSlots } from "@/lib/availability";

const rbacMocks = vi.hoisted(() => ({
  requireCustomerContext: vi.fn(),
  requireStaffContext: vi.fn(),
  requirePermission: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/rbac", () => rbacMocks);

const { clientBookAction } = await import("@/lib/actions/client-app");
const { INVALID_REQUEST } = await import("@/lib/action-args");

const SLUG = "reschedule-safety";

async function makeClinic(label: string) {
  const tenant = await rawDb.tenant.create({ data: { slug: `${SLUG}-${label}-${Date.now()}`, name: `Clinic ${label}` } });
  const tenantId = tenant.id;
  await rawDb.tenantSettings.create({ data: { tenantId, vatRateBasisPoints: 0 } });
  const location = await rawDb.location.create({ data: { tenantId, name: "Main", isPrimary: true } });
  const category = await rawDb.serviceCategory.create({ data: { tenantId, name: "General" } });
  const service = await rawDb.service.create({ data: { tenantId, categoryId: category.id, name: "Consult", durationMinutes: 60, priceCents: 5000 } });
  const other = await rawDb.service.create({ data: { tenantId, categoryId: category.id, name: "Premium", durationMinutes: 60, priceCents: 50000 } });
  const staffUser = await rawDb.user.create({ data: { tenantId, email: `staff-${label}-${Date.now()}@example.com`, role: "STAFF", passwordHash: "unused" } });
  const staff = await rawDb.staffProfile.create({ data: { tenantId, userId: staffUser.id, firstName: "Pat", lastName: label, active: true } });
  await rawDb.staffService.create({ data: { staffProfileId: staff.id, serviceId: service.id } });
  await rawDb.staffService.create({ data: { staffProfileId: staff.id, serviceId: other.id } });
  // Open 09:00–17:00 every day, closed overnight.
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    await rawDb.staffAvailability.create({ data: { tenantId, staffProfileId: staff.id, dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 } });
  }
  return { tenantId, locationId: location.id, serviceId: service.id, otherServiceId: other.id, staffProfileId: staff.id };
}

async function makeClient(tenantId: string, label: string) {
  const user = await rawDb.user.create({ data: { tenantId, email: `client-${label}-${Date.now()}@example.com`, role: "CUSTOMER", passwordHash: "unused" } });
  const profile = await rawDb.customerProfile.create({ data: { tenantId, userId: user.id, firstName: label, lastName: "Client" } });
  return { user, profileId: profile.id };
}

describe("rescheduling follows the booking rules", () => {
  let clinic: Awaited<ReturnType<typeof makeClinic>>;
  let elsewhere: Awaited<ReturnType<typeof makeClinic>>;
  let db: TenantDb;
  let mine: string;
  let theirs: string;
  let slots: Date[];

  function signInAs(client: Awaited<ReturnType<typeof makeClient>>) {
    rbacMocks.requireCustomerContext.mockResolvedValue({
      db,
      user: { id: client.user.id, email: client.user.email, role: "CUSTOMER", tenantId: clinic.tenantId, tenantSlug: SLUG, staffProfileId: null, customerProfileId: client.profileId, permissions: [] },
    });
  }

  async function appointmentsSnapshot() {
    const rows = await rawDb.appointment.findMany({ where: { tenantId: clinic.tenantId }, orderBy: { id: "asc" } });
    return rows.map((r) => `${r.id}:${r.startAt.toISOString()}:${r.staffProfileId}:${r.locationId}:${r.status}:${r.serviceId}`);
  }

  beforeAll(async () => {
    clinic = await makeClinic("a");
    elsewhere = await makeClinic("b");
    db = getTenantDb(clinic.tenantId);

    // Four free slots, a few days out, so "now" never gets in the way.
    const day = new Date();
    day.setDate(day.getDate() + 4);
    slots = await getAvailableSlots(db, { staffProfileId: clinic.staffProfileId, locationId: clinic.locationId, serviceDurationMinutes: 60, date: day });
    slots = slots.filter((s) => s.getMinutes() === 0);
    expect(slots.length).toBeGreaterThanOrEqual(4);

    const me = await makeClient(clinic.tenantId, "Me");
    const them = await makeClient(clinic.tenantId, "Them");
    const base = { tenantId: clinic.tenantId, serviceId: clinic.serviceId, staffProfileId: clinic.staffProfileId, locationId: clinic.locationId, status: "CONFIRMED" as const };
    mine = (await rawDb.appointment.create({ data: { ...base, customerProfileId: me.profileId, startAt: slots[0]!, endAt: new Date(slots[0]!.getTime() + 3_600_000) } })).id;
    theirs = (await rawDb.appointment.create({ data: { ...base, customerProfileId: them.profileId, startAt: slots[1]!, endAt: new Date(slots[1]!.getTime() + 3_600_000) } })).id;
    signInAs(me);
  });

  afterAll(async () => {
    for (const id of [clinic.tenantId, elsewhere.tenantId]) {
      await rawDb.appointment.deleteMany({ where: { tenantId: id } });
      await rawDb.tenant.delete({ where: { id } });
    }
  });

  const move = (over: Record<string, unknown>) =>
    clientBookAction(SLUG, {
      serviceId: clinic.serviceId,
      staffProfileId: clinic.staffProfileId,
      locationId: clinic.locationId,
      startAtIso: slots[2]!.toISOString(),
      appointmentId: mine,
      ...over,
    } as never);

  it("refuses an object as the appointment id, and changes nothing (I-3)", async () => {
    const before = await appointmentsSnapshot();
    expect(await move({ appointmentId: { not: "x" } })).toEqual({ error: INVALID_REQUEST });
    expect(await move({ appointmentId: { in: [mine, theirs] } })).toEqual({ error: INVALID_REQUEST });
    expect(await appointmentsSnapshot()).toEqual(before);
  });

  it("refuses an object in any other field, and keys it does not know", async () => {
    expect(await move({ staffProfileId: { not: "x" } })).toEqual({ error: INVALID_REQUEST });
    expect(await move({ status: "CONFIRMED" })).toEqual({ error: INVALID_REQUEST });
  });

  it("refuses a date that is not a date, without a server error (R-3)", async () => {
    expect(await move({ startAtIso: "not-a-date" })).toEqual({ error: INVALID_REQUEST });
  });

  it("refuses another client's appointment", async () => {
    const before = await appointmentsSnapshot();
    expect(await move({ appointmentId: theirs })).toEqual({ error: "Appointment not found." });
    expect(await appointmentsSnapshot()).toEqual(before);
  });

  it("refuses a slot somebody else holds (B-1)", async () => {
    const res = await move({ startAtIso: slots[1]!.toISOString() });
    expect(res).toEqual({ error: "That time was just taken. Please pick another." });
  });

  it("refuses a closed hour (B-1)", async () => {
    const night = new Date(slots[0]!);
    night.setHours(3, 0, 0, 0);
    const res = await move({ startAtIso: night.toISOString() });
    expect(res).toEqual({ error: "That time was just taken. Please pick another." });
  });

  it("refuses another clinic's practitioner and location (B-1)", async () => {
    expect("error" in (await move({ staffProfileId: elsewhere.staffProfileId }))).toBe(true);
    expect("error" in (await move({ locationId: elsewhere.locationId }))).toBe(true);
    const row = await rawDb.appointment.findUniqueOrThrow({ where: { id: mine } });
    expect(row.staffProfileId).toBe(clinic.staffProfileId);
    expect(row.locationId).toBe(clinic.locationId);
  });

  it("refuses swapping the treatment for another one", async () => {
    expect("error" in (await move({ serviceId: clinic.otherServiceId }))).toBe(true);
  });

  it("refuses a time in the past", async () => {
    const past = new Date(slots[0]!);
    past.setDate(past.getDate() - 30);
    expect("error" in (await move({ startAtIso: past.toISOString() }))).toBe(true);
  });

  it("moves the client's own appointment to a free slot, and only that one", async () => {
    const before = await rawDb.appointment.findUniqueOrThrow({ where: { id: theirs } });
    const res = await move({});
    expect(res).toEqual({ ok: true, when: slots[2]!.toISOString() });
    const row = await rawDb.appointment.findUniqueOrThrow({ where: { id: mine } });
    expect(row.startAt.toISOString()).toBe(slots[2]!.toISOString());
    // A reschedule does not confirm anything the clinic has not confirmed.
    expect(row.status).toBe("CONFIRMED");
    const after = await rawDb.appointment.findUniqueOrThrow({ where: { id: theirs } });
    expect(after.startAt.toISOString()).toBe(before.startAt.toISOString());
  });

  it("can move within its own time: the appointment does not conflict with itself", async () => {
    const res = await move({ startAtIso: slots[2]!.toISOString() });
    expect(res).toEqual({ ok: true, when: slots[2]!.toISOString() });
  });

  it("keeps a requested appointment requested", async () => {
    await rawDb.appointment.update({ where: { id: mine }, data: { status: "REQUESTED" } });
    expect(await move({ startAtIso: slots[3]!.toISOString() })).toEqual({ ok: true, when: slots[3]!.toISOString() });
    expect((await rawDb.appointment.findUniqueOrThrow({ where: { id: mine } })).status).toBe("REQUESTED");
  });
});
