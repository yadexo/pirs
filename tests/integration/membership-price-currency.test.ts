import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

/**
 * Only the Stripe SDK itself is faked — ensureStripePrice runs for real, so
 * this actually proves the currency-mismatch detection and regeneration
 * work, not just that something calls Stripe.
 */
const stripeApi = vi.hoisted(() => ({
  pricesCreate: vi.fn(),
  pricesRetrieve: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class {
    prices = { create: stripeApi.pricesCreate, retrieve: stripeApi.pricesRetrieve };
  },
}));

const { ensureStripePrice } = await import("@/lib/memberships-billing");

/**
 * A plan's Stripe Price is immutable once created — when the clinic's
 * currency changes, the next person to join must not be offered (or
 * charged) the old-currency Price. This is requirement 5 of the per-clinic
 * currency feature: existing unpaid plans get a fresh Price in the new
 * currency automatically, with nothing extra to build for it.
 */
describe("ensureStripePrice: regenerates on a currency change", () => {
  const stamp = Date.now();
  const previousKey = process.env.STRIPE_SECRET_KEY;
  let clinic: { id: string; stripeAccountId: string; membershipFeePercent: number | null };
  let planId: string;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_price_currency";
    const tenant = await rawDb.tenant.create({ data: { slug: `price-currency-${stamp}`, name: "Price Currency Clinic", status: "ACTIVE" } });
    clinic = { id: tenant.id, stripeAccountId: `acct_pc_${stamp}`, membershipFeePercent: null };
    const plan = await rawDb.membershipPlan.create({
      data: {
        tenantId: tenant.id,
        name: "Gold",
        billingFrequency: "MONTHLY",
        priceCents: 5000,
        stripeProductId: "prod_old",
        stripePriceId: "price_old_eur",
      },
    });
    planId = plan.id;
  });

  afterAll(async () => {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    await deleteTenantCompletely(clinic.id).catch(() => undefined);
  });

  it("reuses the stored Price when currency, amount and interval all still match", async () => {
    stripeApi.pricesRetrieve.mockResolvedValue({ id: "price_old_eur", active: true, unit_amount: 5000, currency: "eur", recurring: { interval: "month" } });
    const plan = await rawDb.membershipPlan.findUniqueOrThrow({ where: { id: planId } });
    const priceId = await ensureStripePrice(clinic, plan, "EUR");
    expect(priceId).toBe("price_old_eur");
    expect(stripeApi.pricesCreate).not.toHaveBeenCalled();
  });

  it("creates a fresh Price, in the new currency, when the clinic's currency has changed", async () => {
    stripeApi.pricesRetrieve.mockResolvedValue({ id: "price_old_eur", active: true, unit_amount: 5000, currency: "eur", recurring: { interval: "month" } });
    stripeApi.pricesCreate.mockResolvedValue({ id: "price_new_usd", product: "prod_old" });

    const plan = await rawDb.membershipPlan.findUniqueOrThrow({ where: { id: planId } });
    const priceId = await ensureStripePrice(clinic, plan, "USD");

    expect(priceId).toBe("price_new_usd");
    expect(stripeApi.pricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "usd", unit_amount: 5000, product: "prod_old" }),
      expect.objectContaining({ stripeAccount: clinic.stripeAccountId }),
    );

    const updated = await rawDb.membershipPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(updated.stripePriceId).toBe("price_new_usd");
  });
});
