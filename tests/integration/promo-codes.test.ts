import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { resolvePromotion } from "@/lib/promo-codes";
import { computeCheckoutTotals } from "@/lib/checkout-calculations";

/**
 * Typed promotion codes: the ones a receptionist keys in at the clinic's own
 * counter, as opposed to the automatic discounts in lib/discounts.ts that the
 * client app applies by itself.
 *
 * The rules are the asset here — a code's window, its limits, and what it is
 * allowed to discount. They moved out of a server action with no screen behind
 * it (see the audit's fix B) into lib/promo-codes.ts, and this is the coverage
 * that came with them.
 */
describe("a promotion code at the counter", () => {
  const stamp = Date.now();
  let tenantId: string;
  let db: TenantDb;
  let customerProfileId: string;
  let otherCustomerProfileId: string;
  let productId: string;
  let serviceId: string;

  const day = 86_400_000;

  /** A live code, unless `window` says otherwise. */
  async function promo(fields: {
    code: string;
    discountValue: number;
    discountType?: "PERCENT" | "FIXED_AMOUNT";
    usageLimit?: number;
    perCustomerLimit?: number;
    window?: { startAt: Date; endAt: Date };
    active?: boolean;
  }) {
    return rawDb.promotion.create({
      data: {
        tenantId,
        title: fields.code,
        code: fields.code,
        discountType: fields.discountType ?? "PERCENT",
        discountValue: fields.discountValue,
        startAt: fields.window?.startAt ?? new Date(Date.now() - day),
        endAt: fields.window?.endAt ?? new Date(Date.now() + day),
        usageLimit: fields.usageLimit ?? null,
        perCustomerLimit: fields.perCustomerLimit ?? null,
        ...(fields.active === false ? { active: false } : {}),
      },
    });
  }

  beforeAll(async () => {
    tenantId = (await rawDb.tenant.create({ data: { slug: `promo-${stamp}`, name: "Promo Clinic" } })).id;
    db = getTenantDb(tenantId);

    const user = await rawDb.user.create({ data: { tenantId, email: `p-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    customerProfileId = (await rawDb.customerProfile.create({ data: { tenantId, userId: user.id, firstName: "Pia", lastName: "Promo" } })).id;

    const other = await rawDb.user.create({ data: { tenantId, email: `o-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    otherCustomerProfileId = (await rawDb.customerProfile.create({ data: { tenantId, userId: other.id, firstName: "Otto", lastName: "Other" } })).id;

    const productCategory = await rawDb.productCategory.create({ data: { tenantId, name: "Shelf" } });
    productId = (await rawDb.product.create({
      data: { tenantId, categoryId: productCategory.id, name: "Cream", sku: `CRM-${stamp}`, priceCents: 2_000, inventoryQuantity: 10 },
    })).id;
    const serviceCategory = await rawDb.serviceCategory.create({ data: { tenantId, name: "Room" } });
    serviceId = (await rawDb.service.create({
      data: { tenantId, categoryId: serviceCategory.id, name: "Facial", priceCents: 10_000, durationMinutes: 30 },
    })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantId);
  });

  it("finds a live code", async () => {
    const code = `VALID-${stamp}`;
    await promo({ code, discountValue: 10 });

    const result = await resolvePromotion(db, code, customerProfileId);
    expect("promo" in result && result.promo.discountValue).toBe(10);
  });

  it("refuses a code outside its dates, and one that was switched off", async () => {
    const expired = `EXPIRED-${stamp}`;
    await promo({ code: expired, discountValue: 50, window: { startAt: new Date(Date.now() - 20 * day), endAt: new Date(Date.now() - 10 * day) } });
    expect(await resolvePromotion(db, expired, customerProfileId)).toMatchObject({ error: expect.stringMatching(/not valid or has expired/) });

    const future = `FUTURE-${stamp}`;
    await promo({ code: future, discountValue: 50, window: { startAt: new Date(Date.now() + day), endAt: new Date(Date.now() + 10 * day) } });
    expect(await resolvePromotion(db, future, customerProfileId)).toMatchObject({ error: expect.any(String) });

    const off = `OFF-${stamp}`;
    await promo({ code: off, discountValue: 50, active: false });
    expect(await resolvePromotion(db, off, customerProfileId)).toMatchObject({ error: expect.any(String) });
  });

  it("refuses a code nobody has", async () => {
    expect(await resolvePromotion(db, `NOPE-${stamp}`, customerProfileId)).toMatchObject({ error: expect.any(String) });
  });

  it("enforces the per-client limit, counting only that client's redemptions", async () => {
    const code = `ONCE-${stamp}`;
    const row = await promo({ code, discountValue: 10, perCustomerLimit: 1 });

    expect(await resolvePromotion(db, code, customerProfileId)).toHaveProperty("promo");

    // Used once by this client. A redemption row is written when an order is
    // paid for, not when a basket merely had the code on it.
    await rawDb.promotionRedemption.create({ data: { tenantId, promotionId: row.id, customerProfileId, discountAppliedCents: 1_000 } });

    expect(await resolvePromotion(db, code, customerProfileId)).toMatchObject({ error: expect.stringMatching(/already used/) });
    // Somebody else's limit is their own.
    expect(await resolvePromotion(db, code, otherCustomerProfileId)).toHaveProperty("promo");
  });

  it("enforces the overall usage limit across clients", async () => {
    const code = `CAPPED-${stamp}`;
    const row = await promo({ code, discountValue: 10, usageLimit: 2 });

    await rawDb.promotionRedemption.create({ data: { tenantId, promotionId: row.id, customerProfileId, discountAppliedCents: 500 } });
    expect(await resolvePromotion(db, code, otherCustomerProfileId)).toHaveProperty("promo");

    await rawDb.promotionRedemption.create({ data: { tenantId, promotionId: row.id, customerProfileId: otherCustomerProfileId, discountAppliedCents: 500 } });
    expect(await resolvePromotion(db, code, customerProfileId)).toMatchObject({ error: expect.stringMatching(/usage limit/) });
  });

  it("only discounts the items the promotion covers", async () => {
    const code = `SCOPED-${stamp}`;
    const row = await promo({ code, discountValue: 50 });
    await rawDb.promotionEligibility.create({ data: { promotionId: row.id, productId } });

    const result = await resolvePromotion(db, code, customerProfileId);
    if (!("promo" in result)) throw new Error("expected the promotion");

    const totals = computeCheckoutTotals({
      items: [
        { serviceId, productId: null, packageId: null, unitPriceCents: 10_000, quantity: 1, taxable: true },
        { serviceId: null, productId, packageId: null, unitPriceCents: 2_000, quantity: 1, taxable: true },
      ],
      promo: result.promo,
      taxRateBasisPoints: 0,
      requestedCreditCents: 0,
      availableCreditCents: 0,
    });

    // Half of the €20 product, not half of the €120 basket.
    expect(totals.discountCents).toBe(1_000);
    expect(totals.totalCents).toBe(11_000);
  });
});
