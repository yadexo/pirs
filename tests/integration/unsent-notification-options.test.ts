/**
 * Options for messages nothing sends are not offered (QA report, fix round 1
 * item 7).
 *
 * - The portal's "booking confirmation" and "appointment reminder" toggles
 *   switched nothing: no code reads either setting, so no such message goes
 *   out whatever they say. They are hidden, and a save keeps the stored
 *   values for the day a sender exists.
 * - The client's SMS preference: real SMS delivery is a stub
 *   (lib/providers/notifications/sms.ts), so the switch promised a channel
 *   that does not exist. Hidden, with the stored consent kept. So is the
 *   line saying appointment reminders are always sent.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { ENROLLED } from "../helpers/enrolled";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const { saveNotificationSettingsAction } = await import("@/lib/actions/clinic-settings");

describe("appointment notification toggles", () => {
  const stamp = Date.now();
  let clinic: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `unsent-${stamp}`, name: "Unsent Clinic", inAppBookings: true } })).id;
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, notifyBookingConfirmations: false, notifyAppointmentReminders: false } });
    const ownerId = (await rawDb.user.create({ data: { tenantId: clinic, email: `unsent-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN", twoFactor: ENROLLED } })).id;
    await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: ownerId, firstName: "Una", lastName: "Owner" } });
    authMock.auth.mockResolvedValue({
      user: { id: ownerId, email: `unsent-${stamp}@x.com`, name: "Una", role: "TENANT_ADMIN", tenantId: clinic, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" },
    });
  });
  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  it("are not on the portal's notification form", () => {
    const sections = readFileSync("app/m/[merchantId]/app-builder/settings/sections.tsx", "utf8");
    expect(sections).not.toMatch(/name="notifyBookingConfirmations"/);
    expect(sections).not.toMatch(/name="notifyAppointmentReminders"/);
  });

  it("keep their stored values when the form is saved, even for a clinic that books in the app", async () => {
    const fd = new FormData();
    fd.set("notifyPointsEarned", "on");
    // A hand-made request still cannot change them.
    fd.set("notifyBookingConfirmations", "on");
    fd.set("notifyAppointmentReminders", "on");
    expect(await saveNotificationSettingsAction(clinic, fd)).toMatchObject({ ok: true });
    const s = await rawDb.tenantSettings.findUniqueOrThrow({ where: { tenantId: clinic } });
    expect([s.notifyBookingConfirmations, s.notifyAppointmentReminders, s.notifyPointsEarned]).toEqual([false, false, true]);
  });
});

describe("the client's notification preferences", () => {
  const view = readFileSync("app/app/[merchantSlug]/profile/profile-view.tsx", "utf8");

  it("offer no SMS switch, but send the stored SMS consent back unchanged", () => {
    expect(view).not.toMatch(/\["smsConsent", t\("sms"\)\]/);
    expect(view).toMatch(/smsConsent: summary\.smsConsent/);
  });

  it("do not promise appointment reminders", () => {
    expect(view).not.toMatch(/appointmentRemindersNote/);
  });
});
