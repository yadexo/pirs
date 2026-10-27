import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { totpCode as computeTotpCode } from "@/lib/totp";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ ...authMock, signOut: vi.fn() }));
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

let currentPathname = "/";
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-pathname": currentPathname })),
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {} })),
}));

const { requireMerchantContext, requireAgencyContext } = await import("@/lib/merchant-context");
const { startTwoFactorSetupAction, confirmTwoFactorSetupAction, disableTwoFactorAction } = await import("@/lib/actions/two-factor");
const { authorizeCredentials } = await import("@/lib/auth-credentials");

/**
 * The production bug this covers: a clinic owner who finishes 2FA setup
 * couldn't reach their dashboard — every portal page bounced them straight
 * back to /account/two-factor, and turning 2FA off (which a required role
 * should never even be offered) just put them back at square one. The gate
 * itself (requireMerchantContext/requireAgencyContext) already read
 * twoFactorConfirmed fresh from the database on every call — this suite
 * exists to prove that end to end, not just at the loadLiveAccount layer
 * (see tests/integration/live-account-two-factor.test.ts for that).
 */
describe("two-factor: setup, gate, and the dead end it used to be", () => {
  const stamp = Date.now();
  const password = "correct-horse-battery-2";
  let tenant: { id: string };
  let ownerId: string;
  let platformAdminId: string;
  let staffId: string;

  const asUser = (id: string) => authMock.auth.mockResolvedValue({ user: { id, authTime: Date.now(), tenantSlug: null } });

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    tenant = await rawDb.tenant.create({ data: { slug: `2fa-flow-${stamp}`, name: "2FA Flow Clinic", status: "ACTIVE" } });
    ownerId = (await rawDb.user.create({ data: { tenantId: tenant.id, email: `owner-${stamp}@x.com`, passwordHash: await hashPassword(password), role: "TENANT_ADMIN" } })).id;
    platformAdminId = (await rawDb.user.create({ data: { email: `admin-${stamp}@x.com`, passwordHash: await hashPassword(password), role: "PLATFORM_ADMIN" } })).id;
    staffId = (await rawDb.user.create({ data: { tenantId: tenant.id, email: `staff-${stamp}@x.com`, passwordHash: await hashPassword(password), role: "STAFF" } })).id;
    await rawDb.staffProfile.create({ data: { tenantId: tenant.id, userId: staffId, firstName: "Sam", lastName: "Staff", active: true } });
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenant.id).catch(() => undefined);
    await rawDb.user.delete({ where: { id: platformAdminId } }).catch(() => undefined);
  });

  afterEach(() => {
    currentPathname = "/";
    authMock.auth.mockReset();
  });

  async function completeSetup(userId: string) {
    asUser(userId);
    const started = await startTwoFactorSetupAction();
    if ("error" in started) throw new Error(started.error);
    const res = await confirmTwoFactorSetupAction(computeTotpCode(started.secret));
    if ("error" in res) throw new Error(res.error);
    return { secret: started.secret, backupCodes: res.backupCodes };
  }

  describe("the gate", () => {
    it("sends an unconfirmed clinic owner to setup, carrying the page they wanted", async () => {
      currentPathname = `/m/${tenant.id}/clients`;
      asUser(ownerId);
      await expect(requireMerchantContext(tenant.id)).rejects.toThrow(
        `NEXT_REDIRECT:/account/two-factor?required=1&next=${encodeURIComponent(`/m/${tenant.id}/clients`)}`,
      );
    });

    it("sends an unconfirmed platform admin to setup from the agency console too", async () => {
      currentPathname = "/agency/settings";
      asUser(platformAdminId);
      await expect(requireAgencyContext()).rejects.toThrow(
        `NEXT_REDIRECT:/account/two-factor?required=1&next=${encodeURIComponent("/agency/settings")}`,
      );
    });

    it("never gates staff, who may turn 2FA on but aren't asked to", async () => {
      asUser(staffId);
      const ctx = await requireMerchantContext(tenant.id);
      expect(ctx.merchantId).toBe(tenant.id);
    });
  });

  describe("setup → continue → dashboard", () => {
    it("lets a clinic owner straight through once their 2FA is confirmed — no loop", async () => {
      const { backupCodes } = await completeSetup(ownerId);
      expect(backupCodes).toHaveLength(10);

      currentPathname = `/m/${tenant.id}`;
      asUser(ownerId);
      const ctx = await requireMerchantContext(tenant.id);
      expect(ctx.merchantId).toBe(tenant.id);

      const row = await rawDb.twoFactorSecret.findUnique({ where: { userId: ownerId } });
      expect(row?.confirmedAt).not.toBeNull();
    });

    it("lets a platform admin straight through the agency gate once confirmed", async () => {
      await completeSetup(platformAdminId);
      asUser(platformAdminId);
      const { user } = await requireAgencyContext();
      expect(user.role).toBe("PLATFORM_ADMIN");
    });

    it("signing out and back in with the TOTP code still works afterwards", async () => {
      const email = `owner-${stamp}@x.com`;
      // Already set up by the earlier test in this file; a fresh code from
      // the same secret proves the credential actually persisted.
      const secret = (await rawDb.twoFactorSecret.findUnique({ where: { userId: ownerId } }))!.secret;
      const result = await authorizeCredentials({ portal: "unified", email, password, totpCode: computeTotpCode(secret) }, "staff", "203.0.113.9");
      expect(result?.email).toBe(email);
    });
  });

  describe("turning 2FA off", () => {
    it("refuses for a clinic owner, and leaves the setup intact", async () => {
      asUser(ownerId);
      const res = await disableTwoFactorAction(password);
      expect(res).toEqual({ error: expect.stringContaining("platform admin") });

      const row = await rawDb.twoFactorSecret.findUnique({ where: { userId: ownerId } });
      expect(row?.confirmedAt).not.toBeNull();
    });

    it("refuses for a platform admin the same way", async () => {
      asUser(platformAdminId);
      const res = await disableTwoFactorAction(password);
      expect(res).toEqual({ error: expect.stringContaining("platform admin") });
    });

    it("still works for staff, who were never required to have it on", async () => {
      await completeSetup(staffId);
      asUser(staffId);
      const res = await disableTwoFactorAction(password);
      expect(res).toEqual({ ok: true });

      const row = await rawDb.twoFactorSecret.findUnique({ where: { userId: staffId } });
      expect(row).toBeNull();
    });
  });
});
