import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

/**
 * Money, points and stock must be right when requests arrive at the same
 * moment — double taps, two devices, two clients buying the last item. Each
 * test fires requests in parallel and checks the outcome is exact.
 */

// Each parallel call runs as its own signed-in client.
const who = new AsyncLocalStorage<{ db: TenantDb; user: Record<string, unknown> }>();
const rbacMocks = vi.hoisted(() => ({
  requireCustomerContext: vi.fn(),
  requireStaffContext: vi.fn(),
  requirePermission: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/rbac", () => rbacMocks);

const { adjustLoyaltyPoints, InsufficientPointsError } = await import("@/lib/loyalty");
const { clientRedeemRewardAction, clientCheckoutAction, clientAddToCartAction } = await import("@/lib/actions/client-app");

describe("concurrent requests", () => {
  const stamp = Date.now();
  let tenantId: string;
  let slug: string;
  let db: TenantDb;
  let productId: string;
  let rewardId: string;

  async function makeClient(name: string, points = 0) {
    const user = await rawDb.user.create({ data: { tenantId, email: `${name}-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    const profile = await rawDb.customerProfile.create({ data: { tenantId, userId: user.id, firstName: name, lastName: "C", loyaltyPointsBalance: points } });
    return { db, user: { id: user.id, role: "CUSTOMER", tenantId, tenantSlug: slug, customerProfileId: profile.id, permissions: [] }, profileId: profile.id };
  }
  const as = <T,>(client: { db: TenantDb; user: Record<string, unknown> }, fn: () => Promise<T>) => who.run(client, fn);

  beforeAll(async () => {
    slug = `conc-${stamp}`;
    tenantId = (await rawDb.tenant.create({ data: { slug, name: "Concurrency Clinic" } })).id;
    db = getTenantDb(tenantId);
    rbacMocks.requireCustomerContext.mockImplementation(async () => {
      const ctx = who.getStore();
      if (!ctx) throw new Error("test called an action outside as()");
      return ctx;
    });
    const programme = await rawDb.loyaltyProgramme.create({ data: { tenantId, pointsPerCents: 0 } });
    rewardId = (await rawDb.loyaltyReward.create({ data: { tenantId, loyaltyProgrammeId: programme.id, name: "Big reward", pointsCost: 500, rewardType: "DISCOUNT_AMOUNT", discountAmountCents: 1000 } })).id;
    const cat = await rawDb.productCategory.create({ data: { tenantId, name: "Care" } });
    productId = (await rawDb.product.create({ data: { tenantId, categoryId: cat.id, name: "Last serum", sku: `LAST-${stamp}`, priceCents: 3000, inventoryQuantity: 1 } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });

  it("counts every one of many simultaneous point awards", async () => {
    const c = await makeClient("awards");
    await Promise.all(Array.from({ length: 20 }, () => adjustLoyaltyPoints(db, { customerProfileId: c.profileId, points: 5, type: "EARNED", reason: "parallel" })));

    const profile = await rawDb.customerProfile.findUniqueOrThrow({ where: { id: c.profileId } });
    expect(profile.loyaltyPointsBalance).toBe(100);
    // The ledger agrees: 20 rows whose running balances are 5, 10, … 100.
    const rows = await rawDb.loyaltyTransaction.findMany({ where: { customerProfileId: c.profileId } });
    expect(rows.map((r) => r.balanceAfter).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => (i + 1) * 5));
    // 20 serialised writes against a containerised database: slower than the
    // 5s default whenever the machine is busy.
  }, 30_000);

  it("never lets a balance go below zero", async () => {
    const c = await makeClient("floor", 30);
    await expect(adjustLoyaltyPoints(db, { customerProfileId: c.profileId, points: -31, type: "REDEEMED" })).rejects.toBeInstanceOf(InsufficientPointsError);
    expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: c.profileId } })).loyaltyPointsBalance).toBe(30);
    expect(await rawDb.loyaltyTransaction.count({ where: { customerProfileId: c.profileId } })).toBe(0);
  });

  it("lets only one of several simultaneous redemptions spend the same points", async () => {
    const c = await makeClient("redeemer", 600);
    const results = await Promise.all(Array.from({ length: 5 }, () => as(c, () => clientRedeemRewardAction(slug, rewardId))));

    expect(results.filter((r) => "ok" in r)).toHaveLength(1);
    expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: c.profileId } })).loyaltyPointsBalance).toBe(100);
  });

  it("sells the last item to exactly one of two clients checking out at once", async () => {
    const a = await makeClient("buyerA");
    const b = await makeClient("buyerB");
    await as(a, () => clientAddToCartAction(slug, "product", productId, 1));
    await as(b, () => clientAddToCartAction(slug, "product", productId, 1));

    const [ra, rb] = await Promise.all([as(a, () => clientCheckoutAction(slug, null)), as(b, () => clientCheckoutAction(slug, null))]);
    const outcomes = [ra, rb];
    expect(outcomes.filter((r) => "ok" in r)).toHaveLength(1);
    expect(outcomes.find((r) => "error" in r)).toMatchObject({ error: expect.stringMatching(/sold out/) });

    const product = await rawDb.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.inventoryQuantity).toBe(0);
    expect(await rawDb.order.count({ where: { tenantId, status: "PAID" } })).toBe(1);
    // One sale recorded in the stock ledger, not two.
    expect(await rawDb.inventoryTransaction.count({ where: { productId, type: "SALE" } })).toBe(1);
  });

  it("puts reserved points and stock back when payment fails", async () => {
    await rawDb.product.update({ where: { id: productId }, data: { inventoryQuantity: 3 } });
    const c = await makeClient("declined", 800);
    await as(c, () => clientAddToCartAction(slug, "product", productId, 2));

    const res = await as(c, () => clientCheckoutAction(slug, rewardId, true /* simulate a declined card */));
    expect(res).toMatchObject({ error: expect.any(String) });

    expect((await rawDb.product.findUniqueOrThrow({ where: { id: productId } })).inventoryQuantity).toBe(3);
    expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: c.profileId } })).loyaltyPointsBalance).toBe(800);
    // Both the reservation and its release are in the ledger, netting to zero.
    const ledger = await rawDb.loyaltyTransaction.findMany({ where: { customerProfileId: c.profileId }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((l) => [l.type, l.points])).toEqual([
      ["REDEEMED", -500],
      ["REFUNDED", 500],
    ]);
  });
});
