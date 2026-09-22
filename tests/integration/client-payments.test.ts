import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type Stripe from "stripe";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
const stripeMock = vi.hoisted(() => ({ create: vi.fn(), refund: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => clientAuthMock);

/** The Stripe calls are faked; everything else is the real code and database. */
vi.mock("@/lib/stripe-payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe-payments")>();
  return {
    ...actual,
    createDirectCharge: (params: Parameters<typeof actual.createDirectCharge>[0]) => stripeMock.create(params),
    refundDirectCharge: (params: Parameters<typeof actual.refundDirectCharge>[0]) => stripeMock.refund(params),
  };
});

const clientApp = await import("@/lib/actions/client-app");
const payments = await import("@/lib/actions/payments");
const { handleStripeEvent, alreadyProcessed } = await import("@/lib/stripe-webhook");

describe("client payments on the clinic's Stripe account", () => {
  const stamp = Date.now();
  const ACCOUNT = `acct_pay_${stamp}`;
  let clinic: string;
  let clientUserId: string;
  let clientProfileId: string;
  let staffUserId: string;
  let staffProfileId: string;
  let productId: string;
  let serviceId: string;

  const asClient = () =>
    clientAuthMock.clientAuth.mockResolvedValue({
      user: { id: clientUserId, email: `c-${stamp}@x.com`, name: "C", role: "CUSTOMER", tenantId: clinic, tenantSlug: `pay-${stamp}`, staffProfileId: null, customerProfileId: clientProfileId, permissions: [] },
    });
  const asStaff = () =>
    authMock.auth.mockResolvedValue({
      user: { id: staffUserId, email: `s-${stamp}@x.com`, name: "S", role: "TENANT_ADMIN", tenantId: clinic, tenantSlug: null, staffProfileId, customerProfileId: null, permissions: "ALL" },
    });

  const succeeded = (intentId: string) =>
    ({ id: `evt_ok_${intentId}`, type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000), account: ACCOUNT, data: { object: { id: intentId, payment_method_types: ["card"] } } }) as unknown as Stripe.Event;
  const failed = (intentId: string) =>
    ({ id: `evt_fail_${intentId}`, type: "payment_intent.payment_failed", created: Math.floor(Date.now() / 1000), account: ACCOUNT, data: { object: { id: intentId, last_payment_error: { message: "Your card was declined." } } } }) as unknown as Stripe.Event;

  const addToCart = async () => {
    const res = await clientApp.clientAddToCartAction(`pay-${stamp}`, "product", productId, 1);
    expect(res).toMatchObject({ ok: true });
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_payments";
    process.env.PLATFORM_FEE_PERCENT = "10";

    clinic = (await rawDb.tenant.create({ data: { slug: `pay-${stamp}`, name: "Pay Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Pay Clinic", currency: "EUR" } });
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, taxRateBasisPoints: 2100 } });
    await rawDb.loyaltyProgramme.create({ data: { tenantId: clinic, pointsPerCents: 0.01, active: true } });
    await rawDb.tenant.update({
      where: { id: clinic },
      data: { stripeAccountId: ACCOUNT, stripeStatus: "ACTIVE", stripeChargesEnabled: true, stripeDetailsSubmitted: true },
    });

    const cu = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientUserId = cu.id;
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: cu.id, firstName: "Cara", lastName: "Client" } })).id;

    const su = await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffUserId = su.id;
    staffProfileId = (await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: su.id, firstName: "Sam", lastName: "Staff" } })).id;

    const category = await rawDb.productCategory.create({ data: { tenantId: clinic, name: "Skincare" } });
    productId = (await rawDb.product.create({ data: { tenantId: clinic, categoryId: category.id, name: "Serum", priceCents: 10_000, sku: `SER-${stamp}`, inventoryQuantity: 5 } })).id;
    const serviceCategory = await rawDb.serviceCategory.create({ data: { tenantId: clinic, name: "Treatments" } });
    serviceId = (await rawDb.service.create({ data: { tenantId: clinic, categoryId: serviceCategory.id, name: "Facial", priceCents: 20_000, durationMinutes: 30 } })).id;
  });

  afterAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.PLATFORM_FEE_PERCENT;
    await rawDb.processedStripeEvent.deleteMany({ where: { accountId: ACCOUNT } });
    await deleteTenantCompletely(clinic);
  });

  beforeEach(() => {
    asClient();
    asStaff();
    stripeMock.create.mockReset();
    stripeMock.refund.mockReset();
    stripeMock.create.mockImplementation(async (params: { amountCents: number; subtotalCents: number }) => ({
      paymentIntentId: `pi_${stamp}_${Math.random().toString(36).slice(2, 8)}`,
      clientSecret: "pi_secret_test",
      applicationFeeCents: Math.round((params.subtotalCents * 10) / 100),
      publishableKey: "pk_test_x",
      stripeAccountId: ACCOUNT,
    }));
  });

  it("charges the clinic's account, takes the fee from the subtotal, and leaves the order pending", async () => {
    await addToCart();
    const res = await clientApp.clientCheckoutAction(`pay-${stamp}`, null);
    expect(res).toMatchObject({ ok: true, paid: false });
    if (!("payment" in res)) throw new Error("expected a payment handoff");

    // €100 + 21% tax = €121 charged; the fee is 10% of the €100 subtotal.
    const charge = stripeMock.create.mock.calls[0]![0];
    expect(charge).toMatchObject({ stripeAccountId: ACCOUNT, amountCents: 12_100, subtotalCents: 10_000, currency: "EUR" });
    expect(res.payment.clientSecret).toBe("pi_secret_test");

    const order = await rawDb.order.findFirstOrThrow({ where: { orderNumber: res.orderNumber } });
    expect(order.status).toBe("PENDING");
    const payment = await rawDb.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment).toMatchObject({ provider: "STRIPE", stripeAccountId: ACCOUNT, applicationFeeCents: 1_000, status: "REQUIRES_ACTION" });
    // Nothing is awarded or sold until the payment settles.
    expect(await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } })).toMatchObject({ loyaltyPointsBalance: 0 });
    expect((await rawDb.product.findUniqueOrThrow({ where: { id: productId } })).inventoryQuantity).toBe(4); // stock held
  });

  it("the webhook is what marks it paid, and a repeat delivery changes nothing", async () => {
    const payment = await rawDb.payment.findFirstOrThrow({ where: { tenantId: clinic }, orderBy: { createdAt: "desc" } });
    const event = succeeded(payment.providerPaymentId!);

    expect(await alreadyProcessed(event)).toBe(false);
    await handleStripeEvent(event);

    const order = await rawDb.order.findFirstOrThrow({ where: { id: payment.orderId! } });
    expect(order).toMatchObject({ status: "PAID" });
    expect(order.paidAt).not.toBeNull();
    expect(await rawDb.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "SUCCEEDED", method: "card" });
    const profile = await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } });
    expect(profile.loyaltyPointsBalance).toBe(121); // 1 point per cent of €121

    // Stripe delivers the same event again.
    expect(await alreadyProcessed(event)).toBe(true);
    await handleStripeEvent(event);
    expect((await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } })).loyaltyPointsBalance).toBe(121);
    expect(await rawDb.inventoryTransaction.count({ where: { tenantId: clinic, productId, type: "SALE" } })).toBe(1);
  });

  it("a declined payment gives back the stock and the points it was holding", async () => {
    await addToCart();
    const res = await clientApp.clientCheckoutAction(`pay-${stamp}`, null);
    if (!("payment" in res)) throw new Error("expected a payment handoff");
    const payment = await rawDb.payment.findFirstOrThrow({ where: { tenantId: clinic }, orderBy: { createdAt: "desc" } });
    const stockWhileHeld = (await rawDb.product.findUniqueOrThrow({ where: { id: productId } })).inventoryQuantity;

    await handleStripeEvent(failed(payment.providerPaymentId!));

    expect(await rawDb.order.findFirstOrThrow({ where: { orderNumber: res.orderNumber } })).toMatchObject({ status: "FAILED" });
    expect(await rawDb.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "FAILED", failureReason: "Your card was declined." });
    expect((await rawDb.product.findUniqueOrThrow({ where: { id: productId } })).inventoryQuantity).toBe(stockWhileHeld + 1);
  });

  it("refuses to charge for a clinic that hasn't finished Stripe onboarding", async () => {
    await rawDb.tenant.update({ where: { id: clinic }, data: { stripeStatus: "PENDING_VERIFICATION", stripeChargesEnabled: false } });
    await addToCart();
    const res = await clientApp.clientCheckoutAction(`pay-${stamp}`, null);
    expect(res).toMatchObject({ error: expect.stringMatching(/still being verified|can't take card payments/) });
    expect(stripeMock.create).not.toHaveBeenCalled();
    // Nothing was written: no pending order, no reserved stock.
    expect(await rawDb.order.count({ where: { tenantId: clinic, status: "PENDING" } })).toBe(0);
    await rawDb.tenant.update({ where: { id: clinic }, data: { stripeStatus: "ACTIVE", stripeChargesEnabled: true } });
  });

  it("a deposit holds the appointment until the payment succeeds", async () => {
    await rawDb.tenantSettings.updateMany({ where: { tenantId: clinic }, data: { bookingDepositPercent: 25 } });
    const location = await rawDb.location.create({ data: { tenantId: clinic, name: "Main", isPrimary: true } });
    await rawDb.staffService.create({ data: { staffProfileId, serviceId } });
    await rawDb.staffLocation.createMany({ data: [{ staffProfileId, locationId: location.id }] }).catch(() => undefined);
    // Available every day, so whichever day the test runs on has slots.
    await rawDb.staffAvailability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ tenantId: clinic, staffProfileId, dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 })),
    });

    const day = new Date(Date.now() + 3 * 86_400_000);
    const slots = await clientApp.getClientSlotsAction(staffProfileId, location.id, 30, day.toISOString());
    expect(slots.length).toBeGreaterThan(0);

    const res = await clientApp.clientBookAction(`pay-${stamp}`, {
      serviceId,
      staffProfileId,
      locationId: location.id,
      startAtIso: slots[0]!,
    });
    if (!("deposit" in res) || !res.deposit) throw new Error(`expected a deposit, got ${JSON.stringify(res)}`);
    expect(res.deposit.amountCents).toBe(5_000); // 25% of €200

    const appointment = await rawDb.appointment.findFirstOrThrow({ where: { tenantId: clinic }, orderBy: { createdAt: "desc" } });
    expect(appointment.status).toBe("REQUESTED");

    const payment = await rawDb.payment.findFirstOrThrow({ where: { orderId: appointment.orderId! } });
    expect(payment.applicationFeeCents).toBe(500); // 10% of the deposit
    await handleStripeEvent(succeeded(payment.providerPaymentId!));
    expect(await rawDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toMatchObject({ status: "CONFIRMED" });
    await rawDb.tenantSettings.updateMany({ where: { tenantId: clinic }, data: { bookingDepositPercent: 0 } });
  });

  it("refunds on the clinic's account and gives back the platform fee", async () => {
    const payment = await rawDb.payment.findFirstOrThrow({ where: { tenantId: clinic, status: "SUCCEEDED" }, orderBy: { createdAt: "asc" } });
    stripeMock.refund.mockResolvedValue({ providerRefundId: "re_test_1", status: "SUCCEEDED" });

    const fd = new FormData();
    fd.set("paymentId", payment.id);
    fd.set("amount", String(payment.amountCents / 100));
    fd.set("reason", "Client changed their mind");
    const res = await payments.refundPaymentAction(undefined, fd);
    expect(res).not.toMatchObject({ error: expect.any(String) });

    expect(stripeMock.refund.mock.calls[0]![0]).toMatchObject({
      stripeAccountId: ACCOUNT,
      paymentIntentId: payment.providerPaymentId,
      amountCents: payment.amountCents,
      hasApplicationFee: true,
    });
    expect(await rawDb.order.findFirstOrThrow({ where: { id: payment.orderId! } })).toMatchObject({ status: "REFUNDED" });
  });

  it("a chargeback marks the payment and its order disputed", async () => {
    const payment = await rawDb.payment.findFirstOrThrow({ where: { tenantId: clinic, status: "SUCCEEDED" }, orderBy: { createdAt: "desc" } });
    await rawDb.order.updateMany({ where: { id: payment.orderId! }, data: { status: "PAID" } });
    const event = {
      id: `evt_dispute_${stamp}`,
      type: "charge.dispute.created",
      created: Math.floor(Date.now() / 1000),
      account: ACCOUNT,
      data: { object: { id: "dp_1", charge: "ch_1", payment_intent: payment.providerPaymentId, reason: "fraudulent" } },
    } as unknown as Stripe.Event;

    await handleStripeEvent(event);
    expect(await rawDb.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "DISPUTED", failureReason: "fraudulent" });
    expect((await rawDb.payment.findUniqueOrThrow({ where: { id: payment.id } })).disputedAt).not.toBeNull();
    expect(await rawDb.order.findFirstOrThrow({ where: { id: payment.orderId! } })).toMatchObject({ status: "DISPUTED" });
  });

  it("records a refund made in the clinic's own Stripe dashboard", async () => {
    const payment = await rawDb.payment.findFirstOrThrow({ where: { tenantId: clinic, status: "DISPUTED" } });
    const event = {
      id: `evt_refund_${stamp}`,
      type: "charge.refunded",
      created: Math.floor(Date.now() / 1000),
      account: ACCOUNT,
      data: {
        object: {
          id: "ch_2",
          payment_intent: payment.providerPaymentId,
          amount_refunded: Math.round(payment.amountCents / 2),
          refunds: { data: [{ id: "re_dash_1", amount: Math.round(payment.amountCents / 2), status: "succeeded", reason: "requested_by_customer" }] },
        },
      },
    } as unknown as Stripe.Event;

    await handleStripeEvent(event);
    expect(await rawDb.refund.findFirstOrThrow({ where: { providerRefundId: "re_dash_1" } })).toMatchObject({ status: "SUCCEEDED" });
    expect(await rawDb.order.findFirstOrThrow({ where: { id: payment.orderId! } })).toMatchObject({ status: "PARTIALLY_REFUNDED" });
  });
});
