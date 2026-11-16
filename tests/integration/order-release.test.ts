/**
 * An order that does not complete gives back everything it held — exactly once.
 *
 * docs/security/review-2026-11-pass2.md:
 * - P-7: account credit applied to a pending order was lost when the payment
 *   failed, the client abandoned it, or the hourly cleanup released it. Stock
 *   and points came back; credit did not.
 * - P-8: the cleanup released orders whose payment could still succeed, and a
 *   payment succeeding after that left the client charged for a failed order.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type Stripe from "stripe";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
const stripeMock = vi.hoisted(() => ({ create: vi.fn(), refund: vi.fn(), cancel: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/client-auth", () => clientAuthMock);
vi.mock("@/lib/stripe-payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe-payments")>();
  return {
    ...actual,
    createDirectCharge: (p: unknown) => stripeMock.create(p),
    refundDirectCharge: (p: unknown) => stripeMock.refund(p),
    cancelDirectCharge: (p: unknown) => stripeMock.cancel(p),
  };
});

const clientApp = await import("@/lib/actions/client-app");
const { handleStripeEvent } = await import("@/lib/stripe-webhook");
const { CRON_JOBS } = await import("@/lib/cron/jobs");

describe("a failed or abandoned order returns the client's credit once", () => {
  const stamp = Date.now();
  const SLUG = `release-${stamp}`;
  const ACCOUNT = `acct_rel_${stamp}`;
  let clinic: string;
  let profileId: string;
  let productId: string;

  const credit = async () => (await rawDb.customerProfile.findUniqueOrThrow({ where: { id: profileId } })).accountCreditBalanceCents;
  const refunds = (orderId: string) => rawDb.accountCreditTransaction.count({ where: { relatedOrderId: orderId, type: "REFUND" } });

  /** A real checkout that spends €30 of credit on a €100 product and waits for the card. */
  async function pendingOrderWithCredit() {
    await rawDb.customerProfile.update({ where: { id: profileId }, data: { accountCreditBalanceCents: 3_000 } });
    expect(await clientApp.clientAddToCartAction(SLUG, "product", productId, 1)).toMatchObject({ ok: true });
    const res = await clientApp.clientCheckoutAction(SLUG, null, { useCredit: true });
    if (!("orderNumber" in res) || !("payment" in res)) throw new Error(`expected a pending card payment: ${JSON.stringify(res)}`);
    const order = await rawDb.order.findFirstOrThrow({ where: { orderNumber: res.orderNumber } });
    expect(order).toMatchObject({ status: "PENDING", creditAppliedCents: 3_000 });
    expect(await credit()).toBe(0);
    const payment = await rawDb.payment.findFirstOrThrow({ where: { orderId: order.id } });
    return { order, payment };
  }

  const event = (type: string, intentId: string, extra: Record<string, unknown> = {}) =>
    ({ id: `evt_${type}_${intentId}_${Math.random()}`, type, created: Math.floor(Date.now() / 1000), account: ACCOUNT, data: { object: { id: intentId, ...extra } } }) as unknown as Stripe.Event;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_release";
    clinic = (await rawDb.tenant.create({ data: { slug: SLUG, name: "Release Clinic", stripeAccountId: ACCOUNT, stripeStatus: "ACTIVE", stripeChargesEnabled: true, stripeDetailsSubmitted: true } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Release Clinic", currency: "EUR" } });
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, vatRateBasisPoints: 0 } });
    const user = await rawDb.user.create({ data: { tenantId: clinic, email: `rel-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    profileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: user.id, firstName: "Rae", lastName: "Client" } })).id;
    const category = await rawDb.productCategory.create({ data: { tenantId: clinic, name: "Care" } });
    productId = (await rawDb.product.create({ data: { tenantId: clinic, categoryId: category.id, name: "Balm", priceCents: 10_000, sku: `BALM-${stamp}`, inventoryQuantity: 50 } })).id;
    clientAuthMock.clientAuth.mockResolvedValue({
      user: { id: user.id, email: user.email, name: "Rae", role: "CUSTOMER", tenantId: clinic, tenantSlug: SLUG, staffProfileId: null, customerProfileId: profileId, permissions: [] },
    });
  });

  afterAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await rawDb.processedStripeEvent.deleteMany({ where: { accountId: ACCOUNT } });
    await deleteTenantCompletely(clinic);
  });

  beforeEach(() => {
    stripeMock.create.mockReset().mockImplementation(async () => ({
      paymentIntentId: `pi_rel_${Math.random().toString(36).slice(2, 10)}`,
      clientSecret: "pi_secret",
      applicationFeeCents: 0,
      publishableKey: "pk_test",
      stripeAccountId: ACCOUNT,
    }));
    stripeMock.refund.mockReset().mockResolvedValue({ providerRefundId: "re_late", status: "SUCCEEDED" });
    stripeMock.cancel.mockReset().mockResolvedValue("cancelled");
  });

  it("the client abandoning the payment returns the credit, and abandoning again does not return it twice", async () => {
    const { order } = await pendingOrderWithCredit();
    expect(await clientApp.clientAbandonOrderAction(SLUG, order.orderNumber)).toEqual({ ok: true });
    expect(await credit()).toBe(3_000);
    expect(await clientApp.clientAbandonOrderAction(SLUG, order.orderNumber)).toEqual({ ok: true });
    expect(await credit()).toBe(3_000);
    expect(await refunds(order.id)).toBe(1);
  });

  it("a declined card returns the credit once, however often Stripe says so", async () => {
    const { order, payment } = await pendingOrderWithCredit();
    await handleStripeEvent(event("payment_intent.payment_failed", payment.providerPaymentId!, { last_payment_error: { message: "Declined" } }));
    await handleStripeEvent(event("payment_intent.payment_failed", payment.providerPaymentId!, { last_payment_error: { message: "Declined" } }));
    expect(await credit()).toBe(3_000);
    expect(await refunds(order.id)).toBe(1);
    // And the client abandoning afterwards changes nothing.
    await clientApp.clientAbandonOrderAction(SLUG, order.orderNumber);
    expect(await credit()).toBe(3_000);
  });

  it("the hourly cleanup cancels the payment first, then returns the credit once", async () => {
    const { order, payment } = await pendingOrderWithCredit();
    await rawDb.order.update({ where: { id: order.id }, data: { placedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    await CRON_JOBS.cleanup!();
    await CRON_JOBS.cleanup!();
    expect(stripeMock.cancel).toHaveBeenCalledWith({ stripeAccountId: ACCOUNT, paymentIntentId: payment.providerPaymentId });
    expect((await rawDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("FAILED");
    expect(await credit()).toBe(3_000);
    expect(await refunds(order.id)).toBe(1);
  });

  it("the cleanup leaves an order alone when its payment can no longer be cancelled (P-8)", async () => {
    const { order } = await pendingOrderWithCredit();
    await rawDb.order.update({ where: { id: order.id }, data: { placedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    stripeMock.cancel.mockResolvedValue("succeeded");
    await CRON_JOBS.cleanup!();
    expect((await rawDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect(await credit()).toBe(0);
    // Tidy up for the next test: the client gives up after all.
    stripeMock.cancel.mockResolvedValue("cancelled");
    await clientApp.clientAbandonOrderAction(SLUG, order.orderNumber);
  });

  it("a payment that succeeds after the order failed is refunded, and issues nothing (P-8)", async () => {
    const { order, payment } = await pendingOrderWithCredit();
    await clientApp.clientAbandonOrderAction(SLUG, order.orderNumber);
    await handleStripeEvent(event("payment_intent.succeeded", payment.providerPaymentId!, { amount_received: payment.amountCents, payment_method_types: ["card"] }));
    expect(stripeMock.refund).toHaveBeenCalledTimes(1);
    expect(stripeMock.refund.mock.calls[0]![0]).toMatchObject({ stripeAccountId: ACCOUNT, paymentIntentId: payment.providerPaymentId, amountCents: payment.amountCents });
    expect((await rawDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("FAILED");
    expect(await rawDb.redeemableItem.count({ where: { orderId: order.id } })).toBe(0);
    // Stripe repeats the event: still one refund.
    await handleStripeEvent(event("payment_intent.succeeded", payment.providerPaymentId!, { amount_received: payment.amountCents, payment_method_types: ["card"] }));
    expect(stripeMock.refund.mock.calls.every((c) => (c[0] as { idempotencyKey?: string }).idempotencyKey === `late-${payment.id}`)).toBe(true);
  });
});
