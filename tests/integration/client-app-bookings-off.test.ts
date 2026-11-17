/**
 * With in-app bookings off, the client app neither offers booking nor talks
 * about appointments.
 *
 * Clinics book through their own software; the app links to it per treatment,
 * and those links stay ("book on the clinic's booking page"). What goes is
 * the app's own booking: the Book button, the appointments list, and wording
 * that promises appointment updates the clinic will never send.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { getCatalog } from "@/lib/client-app-catalog";
import { getClientAppointments } from "@/lib/client-app-data";
import { welcomeClientEmail } from "@/lib/emails/templates";
import { BOOKING_COPY, clientAppDescription } from "@/lib/booking-copy";
import en from "@/messages/en.json";
import nl from "@/messages/nl.json";

/** Booking or appointment wording, in English and Dutch. */
const BOOKING_WORDS = /appointment|afspra|\bbook|\bboek/i;

const lookup = (messages: unknown, path: string): string => {
  const value = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
  if (typeof value !== "string") throw new Error(`missing message ${path}`);
  return value;
};

describe("the client app for a clinic with in-app bookings off", () => {
  const stamp = Date.now();
  let tenantId: string;
  let db: TenantDb;
  let profileId: string;
  let serviceId: string;

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug: `ca-off-${stamp}`, name: "Off Clinic" } })).id;
    db = getTenantDb(tenantId);
    await rawDb.tenantBranding.create({ data: { tenantId, businessName: "Off Clinic", currency: "EUR" } });
    const location = await rawDb.location.create({ data: { tenantId, name: "Main", isPrimary: true } });
    const category = await rawDb.serviceCategory.create({ data: { tenantId, name: "General" } });
    serviceId = (await rawDb.service.create({ data: { tenantId, categoryId: category.id, name: "Facial", durationMinutes: 60, priceCents: 5000 } })).id;
    const staffUser = await rawDb.user.create({ data: { tenantId, email: `s-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } });
    const staff = await rawDb.staffProfile.create({ data: { tenantId, userId: staffUser.id, firstName: "Pat", lastName: "Staff", active: true } });
    // A practitioner is assigned, so with bookings on this treatment is bookable.
    await rawDb.staffService.create({ data: { staffProfileId: staff.id, serviceId } });
    const user = await rawDb.user.create({ data: { tenantId, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    profileId = (await rawDb.customerProfile.create({ data: { tenantId, userId: user.id, firstName: "Olga", lastName: "Client" } })).id;
    await rawDb.appointment.create({
      data: { tenantId, customerProfileId: profileId, serviceId, staffProfileId: staff.id, locationId: location.id, startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000), status: "REQUESTED" },
    });
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });

  it("offers no treatment as bookable in the app, and every treatment is still for sale", async () => {
    const off = await getCatalog(db, { tenantId, customerProfileId: profileId, inAppBookings: false });
    const facial = off.treatments.find((s) => s.id === serviceId);
    expect(facial).toMatchObject({ bookable: false, soldOut: false });
    const on = await getCatalog(db, { tenantId, customerProfileId: profileId, inAppBookings: true });
    expect(on.treatments.find((s) => s.id === serviceId)?.bookable).toBe(true);
  });

  it("loads no appointments for the profile, and keeps them", async () => {
    expect(await getClientAppointments(db, profileId, false)).toEqual([]);
    expect(await getClientAppointments(db, profileId, true)).toHaveLength(1);
  });

  it("every text it uses instead says nothing about booking or appointments, in English and Dutch", () => {
    for (const [onKey, offKey] of Object.entries(BOOKING_COPY)) {
      for (const [name, messages] of [["en", en], ["nl", nl]] as const) {
        expect(lookup(messages, offKey), `${name} ${offKey}`).not.toMatch(BOOKING_WORDS);
        // The text it replaces exists, and is the one that did mention them.
        expect(lookup(messages, onKey), `${name} ${onKey}`).toMatch(BOOKING_WORDS);
      }
    }
    expect(Object.keys(BOOKING_COPY).length).toBeGreaterThanOrEqual(4);
  });

  it("the page description and the welcome email follow the switch", () => {
    expect(clientAppDescription("Off Clinic", false)).not.toMatch(BOOKING_WORDS);
    expect(clientAppDescription("Off Clinic", true)).toMatch(/bookings/);
    for (const locale of ["en", "nl"] as const) {
      const branding = { name: "Off Clinic", logoUrl: null, color: null };
      const off = welcomeClientEmail({ branding, firstName: "Olga", openAppUrl: "https://example.test/app", locale, inAppBookings: false });
      expect(off.html + off.text, locale).not.toMatch(BOOKING_WORDS);
      const on = welcomeClientEmail({ branding, firstName: "Olga", openAppUrl: "https://example.test/app", locale, inAppBookings: true });
      expect(on.html, locale).toMatch(BOOKING_WORDS);
    }
  });
});
