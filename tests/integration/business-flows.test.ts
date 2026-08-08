import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { hashPassword } from "@/lib/password";

const rbacMocks = vi.hoisted(() => ({
  requireCustomerContext: vi.fn(),
  requireStaffContext: vi.fn(),
  requirePermission: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/rbac", () => rbacMocks);

const { placeOrderAction, getCheckoutQuoteAction } = await import("@/lib/actions/checkout");
const { joinMembershipAction, pauseMembershipAction, resumeMembershipAction, cancelMembershipAction } = await import(
  "@/lib/actions/memberships"
);
const { adjustAccountCreditAction } = await import("@/lib/actions/customers");
const { manualLoyaltyAdjustmentAction } = await import("@/lib/actions/loyalty");
const { refundPaymentAction } = await import("@/lib/actions/payments");
const { getAvailableSlots } = await import("@/lib/availability");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function expectRedirect(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow(/^NEXT_REDIRECT:/);
}

describe("business-critical workflows", () => {
  let tenantId: string;
  let db: TenantDb;
  let customerUserId: string;
  let customerProfileId: string;
  let staffUserId: string;
  let staffProfileId: string;
  let locationId: string;
  let serviceId: string;
  let productId: string;
  let membershipPlanId: string;
  let rewardId: string;

  const customerUser = () => ({
    id: customerUserId,
    email: "customer@example.com",
    name: "Test Customer",
    role: "CUSTOMER" as const,
    tenantId,
    tenantSlug: "test-tenant",
    staffProfileId: null,
    customerProfileId,
    permissions: [] as const,
  });

  const staffUser = () => ({
    id: staffUserId,
    email: "staff@example.com",
    name: "Test Staff",
    role: "TENANT_ADMIN" as const,
    tenantId,
    tenantSlug: "test-tenant",
    staffProfileId,
    customerProfileId: null,
    permissions: "ALL" as const,
  });

  beforeAll(async () => {
    const tenant = await rawDb.tenant.create({ data: { slug: `test-flows-${Date.now()}`, name: "Test Flows Tenant" } });
    tenantId = tenant.id;
    db = getTenantDb(tenantId);

    await rawDb.tenantSettings.create({ data: { tenantId, taxRateBasisPoints: 1000 } }); // 10% flat for easy math

    const location = await rawDb.location.create({ data: { tenantId, name: "Main", isPrimary: true } });
    locationId = location.id;

    const category = await rawDb.serviceCategory.create({ data: { tenantId, name: "General" } });
    const service = await rawDb.service.create({
      data: { tenantId, categoryId: category.id, name: "Consultation", durationMinutes: 30, priceCents: 10000, taxable: true },
    });
    serviceId = service.id;

    const productCategory = await rawDb.productCategory.create({ data: { tenantId, name: "Products" } });
    const product = await rawDb.product.create({
      data: { tenantId, categoryId: productCategory.id, name: "Widget", sku: `SKU-${Date.now()}`, priceCents: 2000, inventoryQuantity: 5, taxable: true },
    });
    productId = product.id;

    const staffAuthUser = await rawDb.user.create({ data: { tenantId, email: "staff@example.com", passwordHash: await hashPassword("x"), role: "TENANT_ADMIN" } });
    staffUserId = staffAuthUser.id;
    const staffProfile = await rawDb.staffProfile.create({ data: { tenantId, userId: staffAuthUser.id, firstName: "Staff", lastName: "Person", active: true } });
    staffProfileId = staffProfile.id;
    await rawDb.staffService.create({ data: { staffProfileId: staffProfile.id, serviceId: service.id } });
    await rawDb.staffLocation.create({ data: { staffProfileId: staffProfile.id, locationId: location.id } });
    // Available every day, 9am-5pm, so availability tests aren't date-sensitive.
    for (let day = 0; day <= 6; day++) {
      await rawDb.staffAvailability.create({ data: { tenantId, staffProfileId: staffProfile.id, dayOfWeek: day, startMinute: 9 * 60, endMinute: 17 * 60 } });
    }

    const customerAuthUser = await rawDb.user.create({ data: { tenantId, email: "customer@example.com", passwordHash: await hashPassword("x"), role: "CUSTOMER" } });
    customerUserId = customerAuthUser.id;
    const customerProfile = await rawDb.customerProfile.create({ data: { tenantId, userId: customerAuthUser.id, firstName: "Test", lastName: "Customer" } });
    customerProfileId = customerProfile.id;

    const plan = await rawDb.membershipPlan.create({
      data: { tenantId, name: "Basic", billingFrequency: "MONTHLY", priceCents: 4900, includedCreditCents: 1000, pauseAllowed: true, maxPauseMonths: 2 },
    });
    membershipPlanId = plan.id;

    const programme = await rawDb.loyaltyProgramme.create({ data: { tenantId, pointsPerCents: 0.01, pointsPerVisit: 0 } });
    const reward = await rawDb.loyaltyReward.create({
      data: { tenantId, loyaltyProgrammeId: programme.id, name: "$5 off", pointsCost: 100, rewardType: "DISCOUNT_AMOUNT", discountAmountCents: 500 },
    });
    rewardId = reward.id;
  });

  afterAll(async () => {
    await rawDb.tenant.delete({ where: { id: tenantId } });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    rbacMocks.requireCustomerContext.mockResolvedValue({ user: customerUser(), db });
    rbacMocks.requireStaffContext.mockResolvedValue({ user: staffUser(), db });
    rbacMocks.requirePermission.mockResolvedValue(staffUser());
    rbacMocks.requireRole.mockResolvedValue(staffUser());
  });

  async function openBasketWithService() {
    const basket = await db.basket.create({ data: { customerProfileId, status: "OPEN" } as never });
    await db.basketItem.create({ data: { basketId: basket.id, itemType: "SERVICE", serviceId, quantity: 1, unitPriceCents: 10000 } });
    return basket;
  }

  /** Tests share one customer, so drop any leftover OPEN basket between them. */
  async function clearOpenBaskets() {
    await rawDb.basket.deleteMany({ where: { customerProfileId, status: "OPEN" } });
  }

  describe("checkout calculations + order placement", () => {
    it("computes subtotal, tax, and total for a basket with no discounts", async () => {
      await openBasketWithService();
      const quote = await getCheckoutQuoteAction("test-tenant", null, 0);
      expect(quote.subtotalCents).toBe(10000);
      expect(quote.taxCents).toBe(1000); // 10% tax rate fixture
      expect(quote.totalCents).toBe(11000);

      // clean up basket for the next test
      const basket = await db.basket.findFirst({ where: { customerProfileId, status: "OPEN" } });
      if (basket) await db.basket.delete({ where: { id: basket.id } });
    });

    it("places an order, decrements inventory, and awards loyalty points on success", async () => {
      const basket = await db.basket.create({ data: { customerProfileId, status: "OPEN" } as never });
      await db.basketItem.create({ data: { basketId: basket.id, itemType: "PRODUCT", productId, quantity: 2, unitPriceCents: 2000 } });

      await expectRedirect(placeOrderAction("test-tenant", undefined, formData({})));

      const order = await rawDb.order.findFirst({ where: { tenantId, customerProfileId }, orderBy: { placedAt: "desc" } });
      expect(order?.status).toBe("PAID");
      expect(order?.totalCents).toBe(4400); // 4000 subtotal + 10% tax

      const product = await rawDb.product.findUnique({ where: { id: productId } });
      expect(product?.inventoryQuantity).toBe(3); // 5 - 2

      const profile = await rawDb.customerProfile.findUnique({ where: { id: customerProfileId } });
      expect(profile?.loyaltyPointsBalance).toBeGreaterThan(0);

      const ledgerEntry = await rawDb.loyaltyTransaction.findFirst({ where: { customerProfileId, relatedOrderId: order!.id } });
      expect(ledgerEntry?.type).toBe("EARNED");
    });

    it("records a FAILED order and does not touch inventory when the payment is simulated to decline", async () => {
      const basket = await db.basket.create({ data: { customerProfileId, status: "OPEN" } as never });
      await db.basketItem.create({ data: { basketId: basket.id, itemType: "PRODUCT", productId, quantity: 1, unitPriceCents: 2000 } });

      const before = await rawDb.product.findUnique({ where: { id: productId } });

      await expectRedirect(placeOrderAction("test-tenant", undefined, formData({ simulateFailure: "on" })));

      const order = await rawDb.order.findFirst({ where: { tenantId, customerProfileId }, orderBy: { placedAt: "desc" } });
      expect(order?.status).toBe("FAILED");

      const after = await rawDb.product.findUnique({ where: { id: productId } });
      expect(after?.inventoryQuantity).toBe(before?.inventoryQuantity); // unchanged — no fulfillment on failure

      const payment = await rawDb.payment.findFirst({ where: { orderId: order!.id } });
      expect(payment?.status).toBe("FAILED");

      // The basket deliberately stays OPEN after a decline so the customer can
      // retry from the order page's "Try again" link without rebuilding it.
      const retained = await rawDb.basket.findUnique({ where: { id: basket.id } });
      expect(retained?.status).toBe("OPEN");

      await clearOpenBaskets();
    });

    it("rejects checkout on an empty basket", async () => {
      await clearOpenBaskets();
      const result = await placeOrderAction("test-tenant", undefined, formData({}));
      expect(result).toEqual({ error: "Your basket is empty." });
    });
  });

  describe("promotion eligibility", () => {
    it("applies a valid code, rejects an expired one, and enforces per-customer limits server-side", async () => {
      const validCode = `VALID-${Date.now()}`;
      await rawDb.promotion.create({
        data: {
          tenantId,
          title: "Test promo",
          startAt: new Date(Date.now() - 86400000),
          endAt: new Date(Date.now() + 86400000),
          discountType: "PERCENT",
          discountValue: 10,
          code: validCode,
          perCustomerLimit: 1,
        },
      });

      await openBasketWithService();
      const quote = await getCheckoutQuoteAction("test-tenant", validCode, 0);
      expect(quote.promoError).toBeNull();
      expect(quote.discountCents).toBe(1000); // 10% of 10000

      const expiredCode = `EXPIRED-${Date.now()}`;
      await rawDb.promotion.create({
        data: {
          tenantId,
          title: "Expired promo",
          startAt: new Date(Date.now() - 20 * 86400000),
          endAt: new Date(Date.now() - 10 * 86400000),
          discountType: "PERCENT",
          discountValue: 50,
          code: expiredCode,
        },
      });
      const expiredQuote = await getCheckoutQuoteAction("test-tenant", expiredCode, 0);
      expect(expiredQuote.promoError).toMatch(/not valid or has expired/);

      // Simulate the customer having already redeemed the valid promo once.
      const promo = await rawDb.promotion.findFirst({ where: { code: validCode } });
      await rawDb.promotionRedemption.create({
        data: { tenantId, promotionId: promo!.id, customerProfileId, discountAppliedCents: 1000 },
      });
      const secondUse = await getCheckoutQuoteAction("test-tenant", validCode, 0);
      expect(secondUse.promoError).toMatch(/already used/);

      const basket = await db.basket.findFirst({ where: { customerProfileId, status: "OPEN" } });
      if (basket) await db.basket.delete({ where: { id: basket.id } });
    });

    it("only discounts items covered by the promotion's eligibility rules", async () => {
      const scopedCode = `SCOPED-${Date.now()}`;
      const promo = await rawDb.promotion.create({
        data: {
          tenantId,
          title: "Product-only promo",
          startAt: new Date(Date.now() - 86400000),
          endAt: new Date(Date.now() + 86400000),
          discountType: "PERCENT",
          discountValue: 50,
          code: scopedCode,
        },
      });
      await rawDb.promotionEligibility.create({ data: { promotionId: promo.id, productId } });

      const basket = await db.basket.create({ data: { customerProfileId, status: "OPEN" } as never });
      await db.basketItem.create({ data: { basketId: basket.id, itemType: "SERVICE", serviceId, quantity: 1, unitPriceCents: 10000 } });
      await db.basketItem.create({ data: { basketId: basket.id, itemType: "PRODUCT", productId, quantity: 1, unitPriceCents: 2000 } });

      const quote = await getCheckoutQuoteAction("test-tenant", scopedCode, 0);
      // Only the $20 product is eligible, so the 50% discount is $10 — not 50% of the $120 basket.
      expect(quote.discountCents).toBe(1000);

      await db.basket.delete({ where: { id: basket.id } });
    });
  });

  describe("loyalty points", () => {
    it("applies a reward as a discount and keeps the points ledger balanced", async () => {
      await clearOpenBaskets();
      // Give the customer enough points to afford the 100-point reward.
      await manualLoyaltyAdjustmentAction(undefined, formData({ customerProfileId, points: "500", reason: "Test grant" }));

      const before = await rawDb.customerProfile.findUnique({ where: { id: customerProfileId } });
      const balanceBefore = before!.loyaltyPointsBalance;

      await openBasketWithService();
      await expectRedirect(placeOrderAction("test-tenant", undefined, formData({ rewardId })));

      const order = await rawDb.order.findFirst({ where: { tenantId, customerProfileId }, orderBy: { placedAt: "desc" } });

      // The $5 reward came off the order, and the points cost was recorded.
      expect(order!.loyaltyDiscountCents).toBe(500);
      expect(order!.loyaltyPointsRedeemed).toBe(100);

      const redemption = await rawDb.loyaltyTransaction.findFirst({
        where: { customerProfileId, type: "REDEEMED", relatedOrderId: order!.id },
      });
      expect(redemption?.points).toBe(-100);

      const earned = await rawDb.loyaltyTransaction.findFirst({
        where: { customerProfileId, type: "EARNED", relatedOrderId: order!.id },
      });
      expect(earned!.points).toBeGreaterThan(0);

      // Balance must equal exactly the starting balance minus the redemption
      // plus the points earned on this order — no drift between the cached
      // balance and the ledger.
      const after = await rawDb.customerProfile.findUnique({ where: { id: customerProfileId } });
      expect(after!.loyaltyPointsBalance).toBe(balanceBefore - 100 + earned!.points);
    });

    it("refuses to redeem a reward the customer cannot afford", async () => {
      await clearOpenBaskets();
      const expensiveReward = await rawDb.loyaltyReward.create({
        data: {
          tenantId,
          loyaltyProgrammeId: (await rawDb.loyaltyProgramme.findFirstOrThrow({ where: { tenantId } })).id,
          name: "Unaffordable reward",
          pointsCost: 1_000_000,
          rewardType: "DISCOUNT_AMOUNT",
          discountAmountCents: 500,
        },
      });

      await openBasketWithService();
      const result = await placeOrderAction("test-tenant", undefined, formData({ rewardId: expensiveReward.id }));
      expect(result).toEqual({ error: "Not enough points for this reward." });

      await clearOpenBaskets();
    });

    it("requires a reason for manual point adjustments", async () => {
      const result = await manualLoyaltyAdjustmentAction(undefined, formData({ customerProfileId, points: "50", reason: "" }));
      expect(result).toEqual({ error: "A reason is required for manual adjustments." });
    });
  });

  describe("account credit", () => {
    it("requires a reason and records an auditable transaction", async () => {
      const noReason = await adjustAccountCreditAction(undefined, formData({ customerProfileId, amount: "10", reason: "" }));
      expect(noReason).toEqual({ error: "A reason is required for manual adjustments." });

      const before = await rawDb.customerProfile.findUnique({ where: { id: customerProfileId } });
      await adjustAccountCreditAction(undefined, formData({ customerProfileId, amount: "10", reason: "Goodwill credit" }));
      const after = await rawDb.customerProfile.findUnique({ where: { id: customerProfileId } });

      expect(after!.accountCreditBalanceCents).toBe(before!.accountCreditBalanceCents + 1000);

      const tx = await rawDb.accountCreditTransaction.findFirst({ where: { customerProfileId, reason: "Goodwill credit" } });
      expect(tx?.amountCents).toBe(1000);
    });
  });

  describe("membership lifecycle", () => {
    it("moves a membership through join -> pause -> resume -> cancel", async () => {
      await expectRedirect(joinMembershipAction("test-tenant", membershipPlanId));

      let membership = await rawDb.customerMembership.findFirst({ where: { customerProfileId }, orderBy: { createdAt: "desc" } });
      expect(membership?.status).toBe("ACTIVE");

      await pauseMembershipAction("test-tenant", membership!.id);
      membership = await rawDb.customerMembership.findUnique({ where: { id: membership!.id } });
      expect(membership?.status).toBe("PAUSED");

      await resumeMembershipAction("test-tenant", membership!.id);
      membership = await rawDb.customerMembership.findUnique({ where: { id: membership!.id } });
      expect(membership?.status).toBe("ACTIVE");

      await cancelMembershipAction("test-tenant", membership!.id);
      membership = await rawDb.customerMembership.findUnique({ where: { id: membership!.id } });
      expect(membership?.status).toBe("CANCELLED");
    });

    it("refuses to join a second membership while one is already active", async () => {
      const active = await rawDb.customerMembership.findFirst({ where: { customerProfileId, status: "ACTIVE" } });
      if (!active) {
        // (Re-)establish an active membership if the previous test's cancel already ran.
        await rawDb.customerMembership.create({
          data: { tenantId, customerProfileId, membershipPlanId, status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 30 * 86400000) },
        });
      }
      const result = await joinMembershipAction("test-tenant", membershipPlanId);
      expect(result).toEqual({ error: "You already have an active membership." });
    });
  });

  describe("appointment availability", () => {
    it("returns slots within staff working hours and excludes an already-booked slot", async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const slotsBefore = await getAvailableSlots(db, { staffProfileId, locationId, serviceDurationMinutes: 30, date: tomorrow });
      expect(slotsBefore.length).toBeGreaterThan(0);
      for (const slot of slotsBefore) {
        expect(slot.getHours()).toBeGreaterThanOrEqual(9);
        expect(slot.getHours()).toBeLessThan(17);
      }

      const bookedStart = new Date(tomorrow);
      bookedStart.setHours(10, 0, 0, 0);
      const bookedEnd = new Date(bookedStart.getTime() + 30 * 60000);
      await rawDb.appointment.create({
        data: { tenantId, customerProfileId, serviceId, staffProfileId, locationId, startAt: bookedStart, endAt: bookedEnd, status: "CONFIRMED" },
      });

      const slotsAfter = await getAvailableSlots(db, { staffProfileId, locationId, serviceDurationMinutes: 30, date: tomorrow });
      const stillOffered = slotsAfter.some((s) => s.getTime() === bookedStart.getTime());
      expect(stillOffered).toBe(false);
    });

    it("returns no slots on a day with a tenant-wide blocked time covering the whole day", async () => {
      const future = new Date();
      future.setDate(future.getDate() + 10);
      future.setHours(0, 0, 0, 0);
      const dayEnd = new Date(future);
      dayEnd.setHours(23, 59, 0, 0);

      await rawDb.blockedTime.create({ data: { tenantId, startAt: future, endAt: dayEnd, reason: "Clinic closed for holiday" } });

      const slots = await getAvailableSlots(db, { staffProfileId, locationId, serviceDurationMinutes: 30, date: future });
      expect(slots).toHaveLength(0);
    });
  });

  describe("payment and refund state transitions", () => {
    it("marks an order REFUNDED after a full refund and rejects over-refunding", async () => {
      const basket = await openBasketWithService();
      await expectRedirect(placeOrderAction("test-tenant", undefined, formData({})));
      void basket;

      const order = await rawDb.order.findFirst({ where: { tenantId, customerProfileId, status: "PAID" }, orderBy: { placedAt: "desc" } });
      const payment = await rawDb.payment.findFirst({ where: { orderId: order!.id } });

      const full = await refundPaymentAction(undefined, formData({ paymentId: payment!.id, amount: (payment!.amountCents / 100).toFixed(2), reason: "Customer requested" }));
      expect(full).toEqual({ success: true });

      const refundedOrder = await rawDb.order.findUnique({ where: { id: order!.id } });
      expect(refundedOrder?.status).toBe("REFUNDED");

      const overRefund = await refundPaymentAction(undefined, formData({ paymentId: payment!.id, amount: "1.00", reason: "Should fail" }));
      expect(overRefund).toEqual({ error: "Refund amount exceeds the remaining refundable balance." });
    });
  });
});
