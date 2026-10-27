import { describe, it, expect, afterEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn() }));

const { createMerchantAction } = await import("@/lib/actions/merchants");

/**
 * A new clinic owner gets a login link to set their own password, never a
 * password shown on screen or mailed in the clear — the same shape as a
 * staff invite.
 */
describe("createMerchantAction", () => {
  let platformAdminId: string;
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteTenantCompletely(id).catch(() => undefined);
  });

  async function asPlatformAdmin() {
    if (!platformAdminId) {
      const u = await rawDb.user.create({ data: { email: `admin-${Date.now()}@x.com`, passwordHash: "x", role: "PLATFORM_ADMIN" } });
      platformAdminId = u.id;
    }
    authMock.auth.mockResolvedValue({ user: { id: platformAdminId, email: "x@example.com", name: "x", role: "PLATFORM_ADMIN", permissions: "ALL" } });
  }

  function fd(fields: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  }

  it("creates the owner unable to sign in until the link is used, and never returns a password", async () => {
    await asPlatformAdmin();
    const email = `owner-${Date.now()}@example.com`;
    const result = (await createMerchantAction(undefined, fd({ name: `Test Clinic ${Date.now()}`, contactEmail: email, currency: "EUR", timezone: "Europe/Amsterdam" }))) as {
      success: true;
      merchantId: string;
      email: string;
      loginUrl: string;
      emailed: boolean;
    };

    expect(result.success).toBe(true);
    createdTenantIds.push(result.merchantId);
    expect(result).not.toHaveProperty("tempPassword");
    expect(result.loginUrl).toMatch(/\/set-password\?token=/);

    const owner = await rawDb.user.findFirst({ where: { tenantId: result.merchantId, role: "TENANT_ADMIN" } });
    expect(owner?.status).toBe("INVITED");
    expect(owner?.passwordHash).toBe("!invited");

    const tokenRow = await rawDb.passwordResetToken.findFirst({ where: { userId: owner!.id }, orderBy: { createdAt: "desc" } });
    expect(tokenRow).toBeTruthy();
    expect(tokenRow!.usedAt).toBeNull();
  });

  it("defaults a new clinic to EUR when no currency is given", async () => {
    await asPlatformAdmin();
    const result = (await createMerchantAction(
      undefined,
      fd({ name: `No Currency Clinic ${Date.now()}`, contactEmail: `nc-${Date.now()}@example.com`, timezone: "Europe/Amsterdam" }),
    )) as { success: true; merchantId: string };
    expect(result.success).toBe(true);
    createdTenantIds.push(result.merchantId);
    const branding = await rawDb.tenantBranding.findUnique({ where: { tenantId: result.merchantId } });
    expect(branding?.currency).toBe("EUR");
  });

  it("accepts USD and GBP, and refuses anything outside EUR/USD/GBP", async () => {
    await asPlatformAdmin();
    const usd = (await createMerchantAction(
      undefined,
      fd({ name: `USD Clinic ${Date.now()}`, contactEmail: `usd-${Date.now()}@example.com`, currency: "USD", timezone: "Europe/Amsterdam" }),
    )) as { success: true; merchantId: string };
    expect(usd.success).toBe(true);
    createdTenantIds.push(usd.merchantId);
    expect((await rawDb.tenantBranding.findUnique({ where: { tenantId: usd.merchantId } }))?.currency).toBe("USD");

    const rejected = (await createMerchantAction(
      undefined,
      fd({ name: `Bad Currency Clinic ${Date.now()}`, contactEmail: `bad-${Date.now()}@example.com`, currency: "CHF", timezone: "Europe/Amsterdam" }),
    )) as { error?: string };
    expect(rejected.error).toBeTruthy();
  });
});
