/**
 * Slots are a clinic's own days and hours, wherever the server or the phone is.
 *
 * The bug this pins: the booking sheet sent "midnight" in the browser's zone
 * and the slot engine read it in the server's. On production (UTC) a client
 * in Amsterdam who picked Thursday got Wednesday's schedule, at hours shifted
 * by one or two, and was booked on Wednesday. Every expectation here is a
 * fixed instant, and npm run test:tz runs this file under UTC, Amsterdam and
 * Los Angeles: the answers must not change.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { getAvailableSlots } from "@/lib/availability";

const rbacMocks = vi.hoisted(() => ({
  requireCustomerContext: vi.fn(),
  requireStaffContext: vi.fn(),
  requirePermission: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/rbac", () => rbacMocks);

const { clientBookAction, getClientSlotsAction, getBookingOptionsForServiceAction } = await import("@/lib/actions/client-app");

const AMS = "Europe/Amsterdam";
// A clock fixed before every day used here, so "today" never gets in the way.
const NOW = new Date("2026-11-16T12:00:00Z");
const THU = "2026-11-26";
const WED = "2026-11-25";
const SPRING = "2027-03-28"; // Sunday the clocks go forward in the EU
const AUTUMN = "2027-10-31"; // Sunday they go back

describe("slots in the clinic's time zone", () => {
  const stamp = Date.now();
  const slug = `tz-slots-${stamp}`;
  let tenantId: string;
  let db: TenantDb;
  let locationId: string;
  let serviceId: string;
  let profileId: string;

  /** A practitioner who works only the given hours on the given weekdays (minutes of the clinic's day). */
  async function practitioner(days: number[], startMinute: number, endMinute: number) {
    const u = await rawDb.user.create({ data: { tenantId, email: `p-${Math.random()}@x.com`, passwordHash: "x", role: "STAFF" } });
    const staff = await rawDb.staffProfile.create({ data: { tenantId, userId: u.id, firstName: "Pat", lastName: "Zone", active: true } });
    await rawDb.staffService.create({ data: { staffProfileId: staff.id, serviceId } });
    for (const dayOfWeek of days) await rawDb.staffAvailability.create({ data: { tenantId, staffProfileId: staff.id, dayOfWeek, startMinute, endMinute } });
    return staff.id;
  }

  const slots = async (staffProfileId: string, day: string, duration = 60) =>
    (await getAvailableSlots(db, { staffProfileId, locationId, serviceDurationMinutes: duration, day, timeZone: AMS, now: NOW })).map((s) => s.toISOString());

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { inAppBookings: true, slug, name: "Zone Clinic" } })).id;
    db = getTenantDb(tenantId);
    await rawDb.tenantBranding.create({ data: { tenantId, businessName: "Zone Clinic", currency: "EUR", timeZone: AMS } });
    await rawDb.tenantSettings.create({ data: { tenantId, vatRateBasisPoints: 0 } });
    locationId = (await rawDb.location.create({ data: { tenantId, name: "Main", isPrimary: true } })).id;
    const category = await rawDb.serviceCategory.create({ data: { tenantId, name: "General" } });
    serviceId = (await rawDb.service.create({ data: { tenantId, categoryId: category.id, name: "Consult", durationMinutes: 60, priceCents: 5000 } })).id;
    const u = await rawDb.user.create({ data: { tenantId, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    profileId = (await rawDb.customerProfile.create({ data: { tenantId, userId: u.id, firstName: "Cleo", lastName: "Client" } })).id;
    rbacMocks.requireCustomerContext.mockResolvedValue({
      db,
      user: { id: u.id, email: u.email, role: "CUSTOMER", tenantId, tenantSlug: slug, staffProfileId: null, customerProfileId: profileId, permissions: [] },
    });
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });

  it("Thursday 09:00-11:00 in Amsterdam is 08:00-10:00 UTC, on Thursday", async () => {
    const pat = await practitioner([4], 9 * 60, 11 * 60);
    expect(await slots(pat, THU)).toEqual([
      "2026-11-26T08:00:00.000Z",
      "2026-11-26T08:15:00.000Z",
      "2026-11-26T08:30:00.000Z",
      "2026-11-26T08:45:00.000Z",
      "2026-11-26T09:00:00.000Z",
    ]);
    // Wednesday is not a working day for this practitioner, wherever the server is.
    expect(await slots(pat, WED)).toEqual([]);
  });

  it("an appointment blocks its own hours, read in the clinic's zone", async () => {
    const pat = await practitioner([4], 9 * 60, 11 * 60);
    // 10:00-11:00 Amsterdam.
    await rawDb.appointment.create({
      data: { tenantId, customerProfileId: profileId, serviceId, staffProfileId: pat, locationId, startAt: new Date("2026-11-26T09:00:00Z"), endAt: new Date("2026-11-26T10:00:00Z"), status: "CONFIRMED" },
    });
    expect(await slots(pat, THU)).toEqual(["2026-11-26T08:00:00.000Z"]);
  });

  it("the night the clocks go forward offers only times that exist", async () => {
    const pat = await practitioner([0], 60, 4 * 60); // 01:00-04:00 on Sundays
    const got = await slots(pat, SPRING, 30);
    // 01:00 and 01:30 local are 00:00Z and 00:30Z; 02:00-02:59 do not exist; 03:00 local is 01:00Z.
    expect(got).toContain("2027-03-28T00:00:00.000Z");
    expect(got).toContain("2027-03-28T01:00:00.000Z");
    expect(got).toContain("2027-03-28T01:30:00.000Z");
    expect(new Set(got).size).toBe(got.length);
    for (const s of got) expect(new Date(s).getTime()).toBeGreaterThanOrEqual(new Date("2027-03-28T00:00:00Z").getTime());
    // Nothing between 01:45 local (00:45Z) and 03:00 local (01:00Z) but the real instants.
    expect(got.filter((s) => s > "2027-03-28T00:45:00.000Z" && s < "2027-03-28T01:00:00.000Z")).toEqual([]);
  });

  it("the night the clocks go back offers each wall-clock time once, at its first occurrence", async () => {
    const pat = await practitioner([0], 2 * 60, 3 * 60); // 02:00-03:00 on Sundays
    expect(await slots(pat, AUTUMN, 30)).toEqual([
      "2027-10-31T00:00:00.000Z", // 02:00 CEST
      "2027-10-31T00:15:00.000Z",
      "2027-10-31T00:30:00.000Z",
    ]);
  });

  it("slots near midnight stay on their own day, and a late appointment from the day before does not spill over", async () => {
    const pat = await practitioner([3, 4], 22 * 60, 24 * 60); // 22:00-24:00 Wednesday and Thursday
    // Wednesday 23:00 to Thursday 00:30, Amsterdam: blocks the end of Wednesday only.
    await rawDb.appointment.create({
      data: { tenantId, customerProfileId: profileId, serviceId, staffProfileId: pat, locationId, startAt: new Date("2026-11-25T22:00:00Z"), endAt: new Date("2026-11-25T23:30:00Z"), status: "CONFIRMED" },
    });
    expect(await slots(pat, THU)).toEqual(["2026-11-26T21:00:00.000Z", "2026-11-26T21:15:00.000Z", "2026-11-26T21:30:00.000Z", "2026-11-26T21:45:00.000Z", "2026-11-26T22:00:00.000Z"]);
    expect(await slots(pat, WED)).toEqual(["2026-11-25T21:00:00.000Z"]);
  });

  it("past days have no slots", async () => {
    const pat = await practitioner([0, 1, 2, 3, 4, 5, 6], 9 * 60, 17 * 60);
    expect(await slots(pat, "2026-11-15")).toEqual([]);
  });

  it("the client app asks by calendar day, and books the day it was shown", async () => {
    const pat = await practitioner([4], 9 * 60, 11 * 60);
    const offered = await getClientSlotsAction(pat, locationId, 60, THU);
    if (!Array.isArray(offered)) throw new Error(offered.error);
    expect(offered[0]).toBe("2026-11-26T08:00:00.000Z");
    const res = await clientBookAction(slug, { serviceId, staffProfileId: pat, locationId, startAtIso: offered[0]! });
    expect(res).toEqual({ ok: true, when: "2026-11-26T08:00:00.000Z" });
    const stored = await rawDb.appointment.findFirstOrThrow({ where: { staffProfileId: pat } });
    expect(stored.startAt.toISOString()).toBe("2026-11-26T08:00:00.000Z");
  });

  it("booking options list the clinic's next seven days", async () => {
    const options = await getBookingOptionsForServiceAction(serviceId);
    if (!options || "error" in options) throw new Error("expected booking options");
    expect(options.days).toHaveLength(7);
    for (const d of options.days) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
