/**
 * Platform-admin and sign-in actions refuse arguments the app never sends.
 *
 * The last files the argument check reached (docs/security/review-2026-11-pass2.md,
 * the root cause of I-3 and I-4). An object where an id belongs, or a
 * string where a switch belongs, is refused before anything is looked up.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { INVALID_REQUEST, InvalidActionArgsError } from "@/lib/action-args";
import { ENROLLED } from "../helpers/enrolled";

const authMock = vi.hoisted(() => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined })),
}));

const merchants = await import("@/lib/actions/merchants");
const admins = await import("@/lib/actions/platform-admins");
const twoFactor = await import("@/lib/actions/two-factor");
const domains = await import("@/lib/actions/clinic-domains");
const auth = await import("@/lib/actions/auth");
const session = await import("@/lib/actions/session");

const call = (fn: (...a: never[]) => unknown, ...a: unknown[]) => (fn as (...x: unknown[]) => Promise<unknown>)(...a);

describe("admin and sign-in actions refuse objects and wrong types", () => {
  const stamp = Date.now();
  let adminId: string;
  let clinic: string;
  const anything = { not: "x" };

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    adminId = (await rawDb.user.create({ data: { email: `pa-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN", twoFactor: ENROLLED } })).id;
    clinic = (await rawDb.tenant.create({ data: { slug: `admin-args-${stamp}`, name: "Admin Args" } })).id;
    authMock.auth.mockResolvedValue({
      user: { id: adminId, email: `pa-${stamp}@x.com`, name: "Admin", role: "PLATFORM_ADMIN", tenantId: null, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" },
    });
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic).catch(() => undefined);
    await rawDb.user.deleteMany({ where: { id: adminId } });
  });

  it("clinic management refuses an object id and keeps every clinic", async () => {
    const clinics = await rawDb.tenant.count();
    await expect(call(merchants.deleteMerchantAction, anything)).rejects.toBeInstanceOf(InvalidActionArgsError);
    await expect(call(merchants.setMerchantActiveAction, anything, false)).rejects.toBeInstanceOf(InvalidActionArgsError);
    await expect(call(merchants.setMerchantActiveAction, clinic, "false")).rejects.toBeInstanceOf(InvalidActionArgsError);
    expect(await call(merchants.setMembershipFeeAction, clinic, "5")).toEqual({ error: INVALID_REQUEST });
    expect(await rawDb.tenant.count()).toBe(clinics);
    expect((await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } })).status).toBe("ACTIVE");
  });

  it("admin accounts and two-factor resets refuse an object id", async () => {
    expect(await call(admins.setAdminActiveAction, anything, false)).toEqual({ error: INVALID_REQUEST });
    expect(await call(twoFactor.resetTwoFactorForUserAction, anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(twoFactor.resetTwoFactorByEmailAction, { contains: "@" })).toEqual({ error: INVALID_REQUEST });
    expect(await rawDb.twoFactorSecret.count({ where: { userId: adminId } })).toBe(1);
  });

  it("domains refuse an object clinic id and a form that is not a form", async () => {
    expect(await call(domains.removeClinicDomainAction, anything)).toEqual({ error: INVALID_REQUEST });
    expect(await call(domains.attachClinicDomainAction, clinic, { domain: "x.example" })).toEqual({ error: INVALID_REQUEST });
  });

  it("sign-in refuses a slug that is not a slug, and a form that is not a form", async () => {
    expect(await call(auth.customerSignInAction, "../admin", undefined, new FormData())).toEqual({ error: INVALID_REQUEST });
    expect(await call(auth.unifiedSignInAction, undefined, { email: "a@b.c" })).toEqual({ error: INVALID_REQUEST });
    await expect(call(session.signOutOfClinicAction, { slug: "x" })).rejects.toBeInstanceOf(InvalidActionArgsError);
  });
});
