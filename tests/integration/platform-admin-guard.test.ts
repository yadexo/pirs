/**
 * Platform-admin actions use the full platform-admin guard.
 *
 * docs/security/review-2026-11-pass2.md:
 * - A-13: clinic management, white label, impersonation start and two-factor
 *   resets checked only the role, so an admin impersonating a clinic could
 *   still create, suspend or delete clinics. They now go through
 *   requirePlatformAdminAction, which refuses while impersonating.
 * - Note 1 under A-1: refusing an admin without two-factor surfaced as an
 *   unhandled server error; it is now the plain "set up two-factor first".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { TWO_FACTOR_FIRST } from "@/lib/two-factor";
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

const merchants = await import("@/lib/actions/merchants");
const twoFactor = await import("@/lib/actions/two-factor");
const impersonation = await import("@/lib/actions/impersonation");

describe("platform-admin actions refuse while impersonating, and explain a missing second factor", () => {
  const stamp = Date.now();
  let enrolledId: string;
  let bareId: string;
  let clinic: string;

  const signIn = (id: string) =>
    authMock.auth.mockResolvedValue({
      user: { id, email: `${id}@x.com`, name: "Admin", role: "PLATFORM_ADMIN", tenantId: null, tenantSlug: null, staffProfileId: null, customerProfileId: null, permissions: "ALL" },
    });

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    enrolledId = (await rawDb.user.create({ data: { email: `guard-a-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN", twoFactor: ENROLLED } })).id;
    bareId = (await rawDb.user.create({ data: { email: `guard-b-${stamp}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } })).id;
    clinic = (await rawDb.tenant.create({ data: { slug: `guard-${stamp}`, name: "Guarded Clinic" } })).id;
  });

  afterEach(() => {
    impersonating = null;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic).catch(() => undefined);
    await rawDb.user.deleteMany({ where: { id: { in: [enrolledId, bareId] } } });
  });

  it("while impersonating a clinic, clinic management is refused and nothing changes (A-13)", async () => {
    signIn(enrolledId);
    impersonating = clinic;
    const refused = { error: "Not available while impersonating." };
    expect(await merchants.deleteMerchantAction(clinic)).toEqual(refused);
    expect(await merchants.setMerchantActiveAction(clinic, false)).toEqual(refused);
    expect(await merchants.setMembershipFeeAction(clinic, 5)).toEqual(refused);
    expect(await merchants.createMerchantAction(undefined, new FormData())).toEqual(refused);
    expect(await twoFactor.resetTwoFactorForUserAction(bareId)).toEqual(refused);
    expect(await impersonation.startImpersonationAction(clinic)).toEqual(refused);
    const row = await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } });
    expect([row.status, row.membershipFeePercent]).toEqual(["ACTIVE", null]);
  });

  it("an admin without two-factor gets the plain message, not a server error (note 1)", async () => {
    signIn(bareId);
    expect(await merchants.deleteMerchantAction(clinic)).toEqual({ error: TWO_FACTOR_FIRST });
    expect(await merchants.setMerchantActiveAction(clinic, false)).toEqual({ error: TWO_FACTOR_FIRST });
    expect(await rawDb.tenant.count({ where: { id: clinic } })).toBe(1);
  });

  it("an enrolled admin, not impersonating, can still manage clinics", async () => {
    signIn(enrolledId);
    expect(await merchants.setMerchantActiveAction(clinic, false)).toEqual({ ok: true });
    expect((await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic } })).status).toBe("SUSPENDED");
    expect(await merchants.setMerchantActiveAction(clinic, true)).toEqual({ ok: true });
  });
});
