/**
 * The in-app bookings switch: off for every clinic until a platform admin
 * turns it on.
 *
 * Clinics book through their own third-party software, so the app's own
 * booking stays hidden and refused unless the platform switches it on for a
 * clinic. A clinic owner cannot switch it themselves, and neither can an admin
 * without two-factor or one who is impersonating a clinic.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { INVALID_REQUEST } from "@/lib/action-args";
import { ENROLLED } from "../helpers/enrolled";

const authMock = vi.hoisted(() => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

let impersonating: string | null = null;
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "impersonate_merchant" && impersonating ? { value: impersonating } : undefined),
    set: () => undefined,
    delete: () => undefined,
  })),
}));

const { setInAppBookingsAction } = await import("@/lib/actions/merchants");

describe("the in-app bookings switch", () => {
  const stamp = Date.now();
  let clinic: string;
  let adminId: string;
  let bareAdminId: string;
  let ownerId: string;

  const as = (id: string, role: "PLATFORM_ADMIN" | "TENANT_ADMIN", tenantId: string | null = null) =>
    authMock.auth.mockResolvedValue({
      user: { id, email: `${id}@x.com`, name: "Someone", role, tenantId, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" },
    });
  const state = async () => (await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } })).inAppBookings;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `switch-${stamp}`, name: "Switch Clinic" } })).id;
    adminId = (await rawDb.user.create({ data: { email: `sw-admin-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN", twoFactor: ENROLLED } })).id;
    bareAdminId = (await rawDb.user.create({ data: { email: `sw-bare-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
    ownerId = (await rawDb.user.create({ data: { tenantId: clinic, email: `sw-owner-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN", twoFactor: ENROLLED } })).id;
  });

  afterEach(() => {
    impersonating = null;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
    await rawDb.user.deleteMany({ where: { id: { in: [adminId, bareAdminId] } } });
  });

  it("is off for a new clinic", async () => {
    expect(await state()).toBe(false);
  });

  it("a platform admin can switch it on and off, and each change is audited", async () => {
    as(adminId, "PLATFORM_ADMIN");
    expect(await setInAppBookingsAction(clinic, true)).toEqual({ ok: true, inAppBookings: true });
    expect(await state()).toBe(true);
    expect(await setInAppBookingsAction(clinic, false)).toEqual({ ok: true, inAppBookings: false });
    expect(await state()).toBe(false);
    const audits = await rawDb.auditLog.findMany({ where: { tenantId: clinic, action: { startsWith: "merchant.in_app_bookings" } } });
    expect(audits.map((a) => a.action).sort()).toEqual(["merchant.in_app_bookings_off", "merchant.in_app_bookings_on"]);
  });

  it("a clinic owner cannot switch it", async () => {
    as(ownerId, "TENANT_ADMIN", clinic);
    expect(await setInAppBookingsAction(clinic, true)).toMatchObject({ error: expect.any(String) });
    expect(await state()).toBe(false);
  });

  it("an admin without two-factor, or one impersonating a clinic, cannot switch it", async () => {
    as(bareAdminId, "PLATFORM_ADMIN");
    expect(await setInAppBookingsAction(clinic, true)).toMatchObject({ error: expect.any(String) });
    as(adminId, "PLATFORM_ADMIN");
    impersonating = clinic;
    expect(await setInAppBookingsAction(clinic, true)).toEqual({ error: "Not available while impersonating." });
    expect(await state()).toBe(false);
  });

  it("refuses anything but a clinic id and a boolean", async () => {
    as(adminId, "PLATFORM_ADMIN");
    const call = setInAppBookingsAction as unknown as (...a: unknown[]) => Promise<unknown>;
    expect(await call({ not: "x" }, true)).toEqual({ error: INVALID_REQUEST });
    expect(await call(clinic, "true")).toEqual({ error: INVALID_REQUEST });
  });
});
