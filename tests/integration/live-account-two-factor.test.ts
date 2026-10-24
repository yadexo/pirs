import { describe, it, expect, afterAll } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { loadLiveAccount } from "@/lib/live-account";
import { twoFactorRequiredForRole } from "@/lib/two-factor";

/**
 * loadLiveAccount's twoFactorConfirmed is what requireMerchantContext and
 * requireAgencyContext (lib/merchant-context.ts) read to decide whether to
 * redirect a clinic owner or platform admin to /account/two-factor — fresh
 * on every page load, the same way every other field on this type already
 * is, not trusted from the 30-day session token.
 */
describe("loadLiveAccount: two-factor status", () => {
  const stamp = Date.now();
  let tenant: { id: string };

  afterAll(async () => {
    if (tenant) await deleteTenantCompletely(tenant.id).catch(() => undefined);
  });

  it("is false with no 2FA row at all, false for an unconfirmed one, true once confirmed", async () => {
    tenant = await rawDb.tenant.create({ data: { slug: `live2fa-${stamp}`, name: "Live 2FA", status: "ACTIVE" } });
    const user = await rawDb.user.create({ data: { tenantId: tenant.id, email: `owner-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });

    expect((await loadLiveAccount(user.id))?.twoFactorConfirmed).toBe(false);

    const row = await rawDb.twoFactorSecret.create({ data: { userId: user.id, secret: "JBSWY3DPEHPK3PXP" } });
    expect((await loadLiveAccount(user.id))?.twoFactorConfirmed).toBe(false);

    await rawDb.twoFactorSecret.update({ where: { id: row.id }, data: { confirmedAt: new Date() } });
    expect((await loadLiveAccount(user.id))?.twoFactorConfirmed).toBe(true);
  });
});

describe("twoFactorRequiredForRole", () => {
  it("required for a clinic owner and a platform admin, optional for staff, never for a client", () => {
    expect(twoFactorRequiredForRole("TENANT_ADMIN")).toBe(true);
    expect(twoFactorRequiredForRole("PLATFORM_ADMIN")).toBe(true);
    expect(twoFactorRequiredForRole("STAFF")).toBe(false);
    expect(twoFactorRequiredForRole("CUSTOMER")).toBe(false);
  });
});
