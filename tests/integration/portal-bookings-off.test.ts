/**
 * With in-app bookings off, the clinic portal hides the app's own booking.
 *
 * No Appointments item in the navigation (and the page itself sends staff
 * home), no Booking settings section, no appointment notification toggles —
 * and the settings that are hidden keep their stored values rather than being
 * cleared by the next save of the form they used to be on.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { ENROLLED } from "../helpers/enrolled";
import { merchantNav, settingsSections, isSettingsSection } from "@/lib/nav";
import { PORTAL_BOOKING_COPY } from "@/lib/booking-copy";
import en from "@/messages/en.json";
import nl from "@/messages/nl.json";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const { saveBookingSettingsAction, saveNotificationSettingsAction } = await import("@/lib/actions/clinic-settings");
const { BOOKINGS_OFF } = await import("@/lib/in-app-bookings");

const BOOKING_WORDS = /appointment|afspra|\bbook|\bboek/i;
const lookup = (messages: unknown, path: string): string => {
  const value = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
  if (typeof value !== "string") throw new Error(`missing message ${path}`);
  return value;
};

describe("the clinic portal with in-app bookings off", () => {
  const stamp = Date.now();
  let clinic: string;
  let ownerId: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `portal-off-${stamp}`, name: "Portal Off Clinic" } })).id;
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, notifyBookingConfirmations: true, notifyAppointmentReminders: true, appointmentCancellationHours: 24 } });
    ownerId = (await rawDb.user.create({ data: { tenantId: clinic, email: `po-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN", twoFactor: ENROLLED } })).id;
    await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: ownerId, firstName: "Owen", lastName: "Owner" } });
    authMock.auth.mockResolvedValue({
      user: { id: ownerId, email: `po-${stamp}@x.com`, name: "Owen", role: "TENANT_ADMIN", tenantId: clinic, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" },
    });
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  it("the navigation has no Appointments item, and has it when bookings are on", () => {
    expect(merchantNav(false).map((i) => i.segment)).not.toContain("appointments");
    expect(merchantNav(true).map((i) => i.segment)).toContain("appointments");
  });

  it("the settings have no Booking section, and an old link to it is not honoured", () => {
    expect(settingsSections(false).map((s) => s.key)).not.toContain("booking");
    expect(settingsSections(true).map((s) => s.key)).toContain("booking");
    expect(isSettingsSection("booking", false)).toBe(false);
    expect(isSettingsSection("booking", true)).toBe(true);
    expect(isSettingsSection("notifications", false)).toBe(true);
  });

  it("the Booking settings cannot be saved, and stay as they were", async () => {
    const fd = new FormData();
    fd.set("bookingMode", "IN_APP");
    fd.set("appointmentCancellationHours", "2");
    fd.set("appointmentReminderHours", "1");
    expect(await saveBookingSettingsAction(clinic, fd)).toEqual({ error: BOOKINGS_OFF });
    expect((await rawDb.tenantSettings.findUniqueOrThrow({ where: { tenantId: clinic } })).appointmentCancellationHours).toBe(24);
  });

  it("saving the notification settings keeps the hidden appointment toggles as they were", async () => {
    const fd = new FormData(); // the two booking toggles are not on the form
    fd.set("notifyPointsEarned", "on");
    expect(await saveNotificationSettingsAction(clinic, fd)).toMatchObject({ ok: true });
    const s = await rawDb.tenantSettings.findUniqueOrThrow({ where: { tenantId: clinic } });
    expect([s.notifyBookingConfirmations, s.notifyAppointmentReminders]).toEqual([true, true]);
  });

  it("the portal texts it uses instead say nothing about booking or appointments", () => {
    for (const [onKey, offKey] of Object.entries(PORTAL_BOOKING_COPY)) {
      for (const [name, messages] of [["en", en], ["nl", nl]] as const) {
        expect(lookup(messages, offKey), `${name} ${offKey}`).not.toMatch(BOOKING_WORDS);
        expect(lookup(messages, onKey), `${name} ${onKey}`).toMatch(BOOKING_WORDS);
      }
    }
  });
});
