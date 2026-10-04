import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb } from "@/lib/tenant-db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/client-auth", () => clientAuthMock);

const { clientAddToCartAction, clientCheckoutAction, clientCartExtrasAction } = await import("@/lib/actions/client-app");
const { adjustAccountCredit } = await import("@/lib/account-credit");
const { PAST_DUE_GRACE_MS } = await import("@/lib/membership-status");

/**
 * What a client actually gets for paying for a plan: the member price at the
 * till, and the included credit as money they can spend.
 *
 * No Stripe keys here, so the mock provider settles a card on the spot. That
 * keeps these tests about the benefits rather than about payment plumbing,
 * which lives in memberships-stripe.test.ts.
 */
describe("membership benefits at checkout", () => {
  const stamp = Date.now();
  const SLUG = `benefit-${stamp}`;
  let clinic: string;
  let clientUserId: string;
  let clientProfileId: string;
  let planId: string;
  let serviceId: string;
  let productId: string;
  let db: ReturnType<typeof getTenantDb>;

  const asClient = () =>
    clientAuthMock.clientAuth.mockResolvedValue({
      user: {
        id: clientUserId,
        email: `c-${stamp}@x.com`,
        name: "C",
        role: "CUSTOMER",
        tenantId: clinic,
        tenantSlug: SLUG,
        staffProfileId: null,
        customerProfileId: clientProfileId,
        permissions: [],
      },
    });

  /** Puts this client on the plan with the given status. */
  async function member(status: "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "PENDING" | "CANCELLED", pastDueSince?: Date) {
    await rawDb.customerMembership.deleteMany({ where: { tenantId: clinic } });
    return rawDb.customerMembership.create({
      data: {
        tenantId: clinic,
        customerProfileId: clientProfileId,
        membershipPlanId: planId,
        status,
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        pastDueSince: pastDueSince ?? null,
      } as never,
    });
  }

  /** A promotion on everything, so it competes with the plan. */
  async function promotion(percent: number) {
    return rawDb.promotion.create({
      data: {
        tenantId: clinic,
        title: `${percent}% off everything`,
        discountType: "PERCENT",
        discountValue: percent,
        autoApply: true,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
      },
    });
  }

  /** Buys the €100 treatment and returns the order that was created. */
  async function buyTreatment(options: { useCredit?: boolean } = {}) {
    expect(await clientAddToCartAction(SLUG, "service", serviceId, 1)).toMatchObject({ ok: true });
    const res = await clientCheckoutAction(SLUG, null, options);
    if ("error" in res) throw new Error(`checkout failed: ${res.error}`);
    const order = await rawDb.order.findFirstOrThrow({ where: { orderNumber: res.orderNumber } });
    return { res, order };
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";

    clinic = (await rawDb.tenant.create({ data: { slug: SLUG, name: "Benefit Clinic" } })).id;
    db = getTenantDb(clinic);
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Benefit Clinic", currency: "EUR" } });
    // No tax, so every number below is the discount and nothing else.
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, taxRateBasisPoints: 0 } });

    const user = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientUserId = user.id;
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: user.id, firstName: "Mem", lastName: "Ber" } })).id;

    const serviceCategory = await rawDb.serviceCategory.create({ data: { tenantId: clinic, name: "Treatments" } });
    serviceId = (await rawDb.service.create({
      data: { tenantId: clinic, categoryId: serviceCategory.id, name: "Facial", priceCents: 10_000, durationMinutes: 30 },
    })).id;
    const productCategory = await rawDb.productCategory.create({ data: { tenantId: clinic, name: "Shelf" } });
    productId = (await rawDb.product.create({
      data: { tenantId: clinic, categoryId: productCategory.id, name: "Cream", sku: `CRM-${stamp}`, priceCents: 2_000, inventoryQuantity: 50 },
    })).id;

    planId = (
      await rawDb.membershipPlan.create({
        data: {
          tenantId: clinic,
          name: "Glow Monthly",
          billingFrequency: "MONTHLY",
          priceCents: 4_900,
          includedCreditCents: 1_000,
          serviceDiscountPercent: 20,
          productDiscountPercent: 5,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    asClient();
    await rawDb.promotion.deleteMany({ where: { tenantId: clinic } });
    await rawDb.basket.deleteMany({ where: { tenantId: clinic } });
    // Each test starts with a known balance and no leftover membership.
    await rawDb.customerProfile.update({ where: { id: clientProfileId }, data: { accountCreditBalanceCents: 0 } });
    await rawDb.accountCreditTransaction.deleteMany({ where: { tenantId: clinic } });
    await rawDb.customerMembership.deleteMany({ where: { tenantId: clinic } });
  });

  it("charges a non-member the list price", async () => {
    const { order } = await buyTreatment();
    expect(order).toMatchObject({ subtotalCents: 10_000, discountCents: 0, totalCents: 10_000 });
  });

  it("charges a member their plan's price", async () => {
    await member("ACTIVE");
    const { order } = await buyTreatment();
    // 20% off the €100 treatment.
    expect(order).toMatchObject({ discountCents: 2_000, totalCents: 8_000 });
    // No promotion was involved, so there is nothing to mark as redeemed.
    expect(order.promotionId).toBeNull();
    expect(await rawDb.promotionRedemption.count({ where: { tenantId: clinic } })).toBe(0);
  });

  it("uses the plan's product rate on the shelf, not the treatment rate", async () => {
    await member("ACTIVE");
    expect(await clientAddToCartAction(SLUG, "product", productId, 1)).toMatchObject({ ok: true });
    const res = await clientCheckoutAction(SLUG, null);
    if ("error" in res) throw new Error(res.error);

    // 5% of €20, not 20%.
    expect(await rawDb.order.findFirstOrThrow({ where: { orderNumber: res.orderNumber } })).toMatchObject({ discountCents: 100, totalCents: 1_900 });
  });

  it("gives the better of the plan and a promotion, never both", async () => {
    await member("ACTIVE");
    await promotion(50);

    const { order } = await buyTreatment();
    // The sale's 50% beats the member's 20%, and 70% is never charged for.
    expect(order).toMatchObject({ discountCents: 5_000, totalCents: 5_000 });
    expect(order.promotionId).not.toBeNull();
  });

  it("keeps the member price when the promotion is worth less", async () => {
    await member("ACTIVE");
    await promotion(5);

    const { order } = await buyTreatment();
    expect(order).toMatchObject({ discountCents: 2_000, totalCents: 8_000 });
    expect(order.promotionId).toBeNull();
  });

  it("gives nothing to a membership that hasn't been paid for yet", async () => {
    await member("PENDING");
    const { order } = await buyTreatment();
    expect(order).toMatchObject({ discountCents: 0, totalCents: 10_000 });
  });

  it("keeps the member price through the grace period after a failed payment", async () => {
    await member("PAST_DUE", new Date(Date.now() - 86_400_000));
    const { order } = await buyTreatment();
    expect(order.discountCents).toBe(2_000);
  });

  it("stops the member price once the grace period has run out", async () => {
    await member("PAST_DUE", new Date(Date.now() - PAST_DUE_GRACE_MS - 60_000));
    const { order } = await buyTreatment();
    expect(order.discountCents).toBe(0);
  });

  it("stops the member price when the membership is suspended or cancelled", async () => {
    for (const status of ["SUSPENDED", "CANCELLED"] as const) {
      await member(status);
      const { order } = await buyTreatment();
      expect(order.discountCents, status).toBe(0);
    }
  });

  it("spends the client's credit on the bill and records it in their ledger", async () => {
    await adjustAccountCredit(db, { customerProfileId: clientProfileId, amountCents: 3_000, type: "MANUAL_ADJUSTMENT", reason: "Goodwill" });

    const { res, order } = await buyTreatment({ useCredit: true });

    expect(order).toMatchObject({ creditAppliedCents: 3_000, totalCents: 7_000 });
    expect("totalCents" in res && res.totalCents).toBe(7_000);
    expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } })).accountCreditBalanceCents).toBe(0);

    const spent = await rawDb.accountCreditTransaction.findFirstOrThrow({ where: { tenantId: clinic, type: "REDEEMED" } });
    expect(spent).toMatchObject({ amountCents: -3_000, balanceAfterCents: 0, relatedOrderId: order.id });
  });

  it("leaves the credit alone unless the client asked to use it", async () => {
    await adjustAccountCredit(db, { customerProfileId: clientProfileId, amountCents: 3_000, type: "MANUAL_ADJUSTMENT", reason: "Goodwill" });

    const { order } = await buyTreatment();

    expect(order).toMatchObject({ creditAppliedCents: 0, totalCents: 10_000 });
    expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } })).accountCreditBalanceCents).toBe(3_000);
  });

  it("never takes more credit than the bill, whatever the client has", async () => {
    await adjustAccountCredit(db, { customerProfileId: clientProfileId, amountCents: 50_000, type: "MANUAL_ADJUSTMENT", reason: "Big balance" });

    const { order } = await buyTreatment({ useCredit: true });

    expect(order).toMatchObject({ creditAppliedCents: 10_000, totalCents: 0 });
    expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } })).accountCreditBalanceCents).toBe(40_000);
  });

  it("settles an order that credit covers entirely, without asking for a card", async () => {
    await adjustAccountCredit(db, { customerProfileId: clientProfileId, amountCents: 20_000, type: "MANUAL_ADJUSTMENT", reason: "Big balance" });

    const { res, order } = await buyTreatment({ useCredit: true });

    expect(res).toMatchObject({ ok: true, paid: true, totalCents: 0 });
    expect(order.status).toBe("PAID");
    // Recorded as settled by credit, so the order is not a sale with no
    // payment behind it.
    expect(await rawDb.payment.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({
      provider: "ACCOUNT_CREDIT",
      status: "SUCCEEDED",
      amountCents: 10_000,
    });
  });

  it("takes the member price first, then credit off what is left", async () => {
    await member("ACTIVE");
    await adjustAccountCredit(db, { customerProfileId: clientProfileId, amountCents: 1_000, type: "MEMBERSHIP_GRANT", reason: "Plan credit" });

    const { order } = await buyTreatment({ useCredit: true });

    // €100 less the member's 20%, then €10 of credit.
    expect(order).toMatchObject({ discountCents: 2_000, creditAppliedCents: 1_000, totalCents: 7_000 });
  });

  it("gives the credit back when the payment fails", async () => {
    await adjustAccountCredit(db, { customerProfileId: clientProfileId, amountCents: 4_000, type: "MANUAL_ADJUSTMENT", reason: "Goodwill" });
    expect(await clientAddToCartAction(SLUG, "service", serviceId, 1)).toMatchObject({ ok: true });

    process.env.MOCK_PAYMENTS_DECLINE = "1";
    try {
      expect(await clientCheckoutAction(SLUG, null, { useCredit: true })).toMatchObject({ error: expect.any(String) });
    } finally {
      delete process.env.MOCK_PAYMENTS_DECLINE;
    }

    // Nothing was charged, so nothing was kept.
    expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } })).accountCreditBalanceCents).toBe(4_000);
    const ledger = await rawDb.accountCreditTransaction.findMany({ where: { tenantId: clinic }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((l) => [l.type, l.amountCents])).toEqual([
      ["MANUAL_ADJUSTMENT", 4_000],
      ["REDEEMED", -4_000],
      ["REFUND", 4_000],
    ]);
  });

  it("tells the cart what the client has to spend and what their plan is worth", async () => {
    await member("ACTIVE");
    await adjustAccountCredit(db, { customerProfileId: clientProfileId, amountCents: 2_500, type: "MEMBERSHIP_GRANT", reason: "Plan credit" });

    expect(await clientCartExtrasAction()).toEqual({ creditCents: 2_500, memberDiscountTitle: "Glow Monthly member price" });
  });

  it("offers no member price to a client with no membership", async () => {
    expect(await clientCartExtrasAction()).toEqual({ creditCents: 0, memberDiscountTitle: null });
  });
});
