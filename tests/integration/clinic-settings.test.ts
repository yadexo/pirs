import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
const emails = vi.hoisted(() => ({ sent: [] as { to: string; body: string }[] }));
vi.mock("@/lib/providers/notifications", () => ({
  getEmailProvider: () => ({
    send: async (p: { to: string; body: string }) => {
      emails.sent.push(p);
      return { providerMessageId: "t", status: "SENT" };
    },
  }),
}));

const S = await import("@/lib/actions/clinic-settings");
const { loadLiveAccount } = await import("@/lib/live-account");
const { POST: upload } = await import("@/app/api/uploads/route");

const fd = (fields: Record<string, string | string[] | boolean | undefined>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === false) continue;
    if (v === true) f.set(k, "on");
    else if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
};
const errorsOf = (r: unknown) => (r as { fieldErrors?: Record<string, string> }).fieldErrors ?? {};

const allWeek = (open = "09:00", close = "17:00") =>
  Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].flatMap((d) => [[`${d}.open`, open], [`${d}.close`, close]]));

describe("clinic settings", () => {
  const stamp = Date.now();
  let clinic: string;
  let ownerId: string;
  let staffId: string;

  const asOwner = () =>
    authMock.auth.mockResolvedValue({ user: { id: ownerId, email: "o@x.com", name: "o", role: "TENANT_ADMIN", tenantId: clinic, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" } });
  const asStaff = () =>
    authMock.auth.mockResolvedValue({ user: { id: staffId, email: "s@x.com", name: "s", role: "STAFF", tenantId: clinic, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" } });

  beforeAll(async () => {
    clinic = (await rawDb.tenant.create({ data: { slug: `set-${stamp}`, name: "Settings Clinic" } })).id;
    ownerId = (await rawDb.user.create({ data: { tenantId: clinic, email: `owner-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } })).id;
    const role = await rawDb.role.create({ data: { tenantId: clinic, name: "Front desk" } });
    for (const key of ["loyalty.adjust", "appointments.manage"]) {
      const p = await rawDb.permission.findUniqueOrThrow({ where: { key } });
      await rawDb.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
    }
    staffId = (await rawDb.user.create({ data: { tenantId: clinic, email: `staff-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } })).id;
    await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: staffId, firstName: "Front", lastName: "Desk", roleId: role.id } });
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  describe("general", () => {
    it("saves tax, banner copy and legal text, creating rows the clinic did not have", async () => {
      asOwner();
      const res = await S.saveGeneralSettingsAction(clinic, fd({ taxRatePercent: "8,25", shopBannerHeadline: "Feel better", payLaterEnabled: true, termsContent: "Our terms" }));
      expect(res).toMatchObject({ ok: true });
      const settings = await rawDb.tenantSettings.findUniqueOrThrow({ where: { tenantId: clinic } });
      expect(settings).toMatchObject({ taxRateBasisPoints: 825, shopBannerHeadline: "Feel better", payLaterEnabled: true, publiclyListed: false });
      expect((await rawDb.tenantBranding.findUniqueOrThrow({ where: { tenantId: clinic } })).termsContent).toBe("Our terms");
    });

    it("rejects a tax rate with more than two decimals", async () => {
      asOwner();
      expect(errorsOf(await S.saveGeneralSettingsAction(clinic, fd({ taxRatePercent: "7.125" }))).taxRatePercent).toMatch(/two decimals/);
    });

    it("is owner-only, whatever permissions staff hold", async () => {
      asStaff();
      expect(await S.saveGeneralSettingsAction(clinic, fd({ taxRatePercent: "0" }))).toMatchObject({ error: expect.stringMatching(/access/) });
    });
  });

  describe("branding", () => {
    const branding = (over: Record<string, string> = {}) =>
      fd({ businessName: "Settings Clinic", primaryColor: "#112233", currency: "EUR", timeZone: "Europe/Amsterdam", ...over });

    it("validates colour, currency, time zone and website", async () => {
      asOwner();
      const errs = errorsOf(await S.saveBrandingAction(clinic, branding({ primaryColor: "red", currency: "XXQ", timeZone: "Mars/Olympus", website: "http://insecure.example" })));
      expect(Object.keys(errs).sort()).toEqual(["currency", "primaryColor", "timeZone", "website"]);
    });

    it("locks the currency once money has been taken", async () => {
      asOwner();
      expect(await S.saveBrandingAction(clinic, branding({ currency: "GBP" }))).toMatchObject({ ok: true });

      const u = await rawDb.user.create({ data: { tenantId: clinic, email: `buyer-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
      const p = await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: u.id, firstName: "B", lastName: "Y" } });
      await rawDb.order.create({ data: { tenantId: clinic, customerProfileId: p.id, orderNumber: `O-${stamp}`, status: "PAID", subtotalCents: 100, totalCents: 100, currency: "GBP" } as never });

      expect(errorsOf(await S.saveBrandingAction(clinic, branding({ currency: "EUR" }))).currency).toMatch(/already taken payments/);
      // Everything else still saves.
      expect(await S.saveBrandingAction(clinic, branding({ currency: "GBP", businessName: "Renamed Clinic" }))).toMatchObject({ ok: true });
    });
  });

  describe("team", () => {
    it("invites staff who must set their own password, and can't sign in until then", async () => {
      asOwner();
      emails.sent.length = 0;
      const res = await S.inviteStaffAction(clinic, fd({ firstName: "Nia", lastName: "New", email: `Nia.New-${stamp}@X.com` }));
      expect(res).toMatchObject({ ok: true, emailed: true, inviteLink: expect.stringContaining("/set-password?token=") });

      const user = await rawDb.user.findFirstOrThrow({ where: { email: `nia.new-${stamp}@x.com` }, include: { staffProfile: true } });
      expect(user).toMatchObject({ status: "INVITED", role: "STAFF" });
      expect(user.staffProfile!.invitedAt).not.toBeNull();
      expect(emails.sent[0]!.to).toBe(`nia.new-${stamp}@x.com`);
      expect(await loadLiveAccount(user.id, Date.now())).toBeNull();

      expect(errorsOf(await S.inviteStaffAction(clinic, fd({ firstName: "N", lastName: "N", email: `nia.new-${stamp}@x.com` }))).email).toMatch(/already uses/);
    });

    it("builds roles from known permissions only", async () => {
      asOwner();
      const bad = await S.saveRoleAction(clinic, null, fd({ name: "Hacker", permissions: ["catalog.manage", "everything.admin"] }));
      expect(bad).toMatchObject({ error: expect.any(String) });

      const good = await S.saveRoleAction(clinic, null, fd({ name: "Therapist", permissions: ["appointments.manage", "customers.view"] }));
      const roleId = (good as { id: string }).id;
      const keys = await rawDb.rolePermission.findMany({ where: { roleId }, include: { permission: true } });
      expect(keys.map((k) => k.permission.key).sort()).toEqual(["appointments.manage", "customers.view"]);

      expect(errorsOf(await S.saveRoleAction(clinic, null, fd({ name: "therapist" }))).name).toMatch(/already a role/);
    });

    it("deactivating staff cuts their access on the next request", async () => {
      asOwner();
      const profile = await rawDb.staffProfile.findUniqueOrThrow({ where: { userId: staffId } });
      expect(await loadLiveAccount(staffId, Date.now())).not.toBeNull();
      await S.setStaffActiveAction(clinic, profile.id, false);
      expect(await loadLiveAccount(staffId, Date.now())).toBeNull();
      await S.setStaffActiveAction(clinic, profile.id, true);
    });

    it("won't delete a role someone still has", async () => {
      asOwner();
      const profile = await rawDb.staffProfile.findUniqueOrThrow({ where: { userId: staffId } });
      expect(await S.deleteRoleAction(clinic, profile.roleId!)).toMatchObject({ error: expect.stringMatching(/has this role/) });
    });
  });

  describe("locations", () => {
    it("keeps exactly one primary location", async () => {
      asOwner();
      const first = await S.saveLocationAction(clinic, null, fd({ name: "Main", ...allWeek() }));
      const firstId = (first as { id: string }).id;
      expect((await rawDb.location.findUniqueOrThrow({ where: { id: firstId } })).isPrimary).toBe(true);

      const second = await S.saveLocationAction(clinic, null, fd({ name: "Annex", isPrimary: true, ...allWeek(), "sun.closed": true }));
      const secondId = (second as { id: string }).id;
      const rows = await rawDb.location.findMany({ where: { tenantId: clinic, active: true } });
      expect(rows.filter((r) => r.isPrimary).map((r) => r.id)).toEqual([secondId]);
      expect((rows.find((r) => r.id === secondId)!.openingHours as Record<string, unknown>).sun).toBeNull();

      // Archiving the primary promotes the other.
      await S.archiveLocationAction(clinic, secondId);
      expect((await rawDb.location.findUniqueOrThrow({ where: { id: firstId } })).isPrimary).toBe(true);
      // And the last one can't go.
      expect(await S.archiveLocationAction(clinic, firstId)).toMatchObject({ error: expect.stringMatching(/at least one location/) });
    });

    it("validates opening hours", async () => {
      asOwner();
      const res = await S.saveLocationAction(clinic, null, fd({ name: "Odd", ...allWeek(), "mon.open": "18:00", "mon.close": "09:00" }));
      expect(errorsOf(res)["mon.open"]).toMatch(/after opening/);
    });
  });

  describe("loyalty and booking (delegable to staff)", () => {
    it("stores points per currency unit, and review points need a review link", async () => {
      asStaff(); // front desk holds loyalty.adjust
      const missing = await S.saveLoyaltyRulesAction(clinic, fd({ active: true, pointsPerUnit: "2", reviewPoints: "80" }));
      expect(errorsOf(missing).googleReviewUrl).toBeDefined();

      const ok = await S.saveLoyaltyRulesAction(clinic, fd({ active: true, pointsPerUnit: "2", pointsPerVisit: "60", reviewPoints: "80", googleReviewUrl: "https://g.page/r/example/review" }));
      expect(ok).toMatchObject({ ok: true });
      const programme = await rawDb.loyaltyProgramme.findUniqueOrThrow({ where: { tenantId: clinic } });
      expect(programme).toMatchObject({ pointsPerCents: 0.02, pointsPerVisit: 60, reviewPoints: 80 });
    });

    it("requires an https link when booking happens elsewhere", async () => {
      asStaff(); // holds appointments.manage
      expect(errorsOf(await S.saveBookingSettingsAction(clinic, fd({ bookingMode: "EXTERNAL", appointmentCancellationHours: "24", appointmentReminderHours: "24" }))).externalBookingUrl).toBeDefined();
      expect(errorsOf(await S.saveBookingSettingsAction(clinic, fd({ bookingMode: "EXTERNAL", externalBookingUrl: "http://book.example", appointmentCancellationHours: "24", appointmentReminderHours: "24" }))).externalBookingUrl).toBeDefined();
      expect(await S.saveBookingSettingsAction(clinic, fd({ bookingMode: "EXTERNAL", externalBookingUrl: "https://book.example/riverside", appointmentCancellationHours: "48", appointmentReminderHours: "2" }))).toMatchObject({ ok: true });
      expect(await rawDb.tenantSettings.findUniqueOrThrow({ where: { tenantId: clinic } })).toMatchObject({ bookingMode: "EXTERNAL", appointmentCancellationHours: 48 });
    });
  });

  describe("app icon upload", () => {
    const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: "#123456" } }).png().toBuffer();
    const send = async (buffer: Buffer) => {
      const body = new FormData();
      body.set("merchantId", clinic);
      body.set("purpose", "app-icon");
      body.set("file", new File([buffer], "icon.png", { type: "image/png" }));
      const res = await upload(new NextRequest("http://localhost/api/uploads", { method: "POST", body }));
      return { status: res.status, json: (await res.json()) as { error?: string; url?: string } };
    };

    it("refuses non-square and small icons, and accepts a proper one", async () => {
      asOwner();
      expect((await send(await png(600, 400))).json.error).toMatch(/must be square/);
      expect((await send(await png(256, 256))).json.error).toMatch(/at least 512/);
      const ok = await send(await png(1024, 1024));
      expect(ok.status).toBe(200);
      expect(ok.json.url).toMatch(/\.png$/);
    });
  });
});
