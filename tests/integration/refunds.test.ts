import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

/** Stripe is faked; the money arithmetic and the guards are the real thing. */
const stripeRefund = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stripe-payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe-payments")>();
  return { ...actual, refundDirectCharge: (params: unknown) => stripeRefund(params) };
});

const { refundOrderAction, refundableForOrderAction, clientOrdersAction } = await import("@/lib/actions/refund-order");
const { REFUND_RETURNS_PLATFORM_FEE } = await import("@/lib/refunds");

/**
 * Giving money back. The parts worth pinning are the ones that cost real
 * money if they are wrong: how much is left to refund, that it cannot be
 * refunded twice, and that one clinic can never reach another's order.
 */
describe("refunding an order", () => {
  const stamp = Date.now();
  const ACCOUNT = `acct_refund_${stamp}`;
  let clinic: string;
  let rival: string;
  let clientProfileId: string;
  let staffUserId: string;
  let staffProfileId: string;

  const asStaff = (tenantId = clinic, permissions: "ALL" | string[] = "ALL", role: "TENANT_ADMIN" | "STAFF" = "TENANT_ADMIN") =>
    authMock.auth.mockResolvedValue({
      user: {
        id: staffUserId,
        email: `s-${stamp}@x.com`,
        name: "S",
        role,
        tenantId,
        tenantSlug: null,
        staffProfileId,
        customerProfileId: null,
        permissions,
      },
    });

  /** A paid order of `totalCents`, with a succeeded Stripe payment on it. */
  async function paidOrder(totalCents: number, applicationFeeCents = 0) {
    const order = await rawDb.order.create({
      data: {
        tenantId: clinic,
        customerProfileId: clientProfileId,
        orderNumber: `ORD-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
        status: "PAID",
        subtotalCents: totalCents,
        totalCents,
        currency: "EUR",
        paidAt: new Date(),
      },
      select: { id: true, orderNumber: true },
    });
    await rawDb.payment.create({
      data: {
        tenantId: clinic,
        orderId: order.id,
        provider: "STRIPE",
        providerPaymentId: `pi_${stamp}_${Math.random().toString(36).slice(2, 7)}`,
        stripeAccountId: ACCOUNT,
        applicationFeeCents,
        amountCents: totalCents,
        currency: "EUR",
        status: "SUCCEEDED",
      } as never,
    });
    return order;
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_refunds";

    clinic = (await rawDb.tenant.create({ data: { slug: `ref-${stamp}`, name: "Refund Clinic" } })).id;
    rival = (await rawDb.tenant.create({ data: { slug: `ref-rival-${stamp}`, name: "Rival Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Refund Clinic", currency: "EUR" } });

    const cu = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: cu.id, firstName: "Cara", lastName: "Client" } })).id;

    const su = await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffUserId = su.id;
    staffProfileId = (await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: su.id, firstName: "Sam", lastName: "Staff" } })).id;
  });

  afterAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    for (const id of [clinic, rival]) await deleteTenantCompletely(id);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    stripeRefund.mockResolvedValue({ providerRefundId: `re_${Math.random().toString(36).slice(2, 9)}`, status: "SUCCEEDED" });
    asStaff();
  });

  it("refunds the whole order when no amount is given", async () => {
    const order = await paidOrder(10_000);

    const res = await refundOrderAction(clinic, { orderId: order.id, reason: "Client changed their mind" });
    expect(res).toMatchObject({ ok: true, amountCents: 10_000, fully: true });

    const refunds = await rawDb.refund.findMany({ where: { payment: { orderId: order.id } } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountCents: 10_000, status: "SUCCEEDED", reason: "Client changed their mind", createdByStaffProfileId: staffProfileId });

    // Nothing left to give back.
    const after = await refundableForOrderAction(clinic, order.id);
    expect(after).toMatchObject({ ok: true, order: { remainderCents: 0 } });
  });

  it("refunds part of an order and leaves the rest refundable", async () => {
    const order = await paidOrder(10_000);

    expect(await refundOrderAction(clinic, { orderId: order.id, amount: "25.50" })).toMatchObject({ ok: true, amountCents: 2_550, fully: false });

    const left = await refundableForOrderAction(clinic, order.id);
    expect(left).toMatchObject({ ok: true, order: { remainderCents: 7_450 } });

    // And the rest can still go.
    expect(await refundOrderAction(clinic, { orderId: order.id })).toMatchObject({ ok: true, amountCents: 7_450, fully: true });
  });

  it("refuses more than is left, and says how much that is", async () => {
    const order = await paidOrder(5_000);
    await refundOrderAction(clinic, { orderId: order.id, amount: "30" });

    const tooMuch = await refundOrderAction(clinic, { orderId: order.id, amount: "25" });
    expect(tooMuch).toMatchObject({ error: expect.stringContaining("20.00") });

    // The attempt wrote nothing.
    expect(await rawDb.refund.count({ where: { payment: { orderId: order.id } } })).toBe(1);
  });

  it("refuses to refund the same order twice over", async () => {
    const order = await paidOrder(4_000);
    expect(await refundOrderAction(clinic, { orderId: order.id })).toMatchObject({ ok: true });

    const again = await refundOrderAction(clinic, { orderId: order.id });
    expect(again).toMatchObject({ error: expect.stringMatching(/already been refunded/i) });
    expect(await rawDb.refund.count({ where: { payment: { orderId: order.id } } })).toBe(1);
  });

  it("refuses another clinic's order, and tells Stripe nothing", async () => {
    const order = await paidOrder(6_000);

    // Staff signed in at the rival clinic, reaching for this clinic's order.
    asStaff(rival);
    const res = await refundOrderAction(rival, { orderId: order.id });

    expect(res).toMatchObject({ error: expect.any(String) });
    expect(stripeRefund).not.toHaveBeenCalled();
    expect(await rawDb.refund.count({ where: { payment: { orderId: order.id } } })).toBe(0);
  });

  it("refuses a staff member who may not manage sales", async () => {
    const order = await paidOrder(3_000);

    // A real STAFF account with a real role that lacks sales.manage. The
    // session is not trusted for this — permissions are read from the database
    // on every write — so the account has to exist as described.
    const limited = await rawDb.user.create({
      data: { tenantId: clinic, email: `limited-${stamp}@x.com`, passwordHash: "x", role: "STAFF" },
    });
    const role = await rawDb.role.create({ data: { tenantId: clinic, name: `Front desk ${stamp}` } });
    const viewOnly = await rawDb.permission.upsert({
      where: { key: "customers.view" },
      create: { key: "customers.view", label: "View customers", category: "Customers" },
      update: {},
    });
    await rawDb.rolePermission.create({ data: { roleId: role.id, permissionId: viewOnly.id } });
    const limitedProfile = await rawDb.staffProfile.create({
      data: { tenantId: clinic, userId: limited.id, firstName: "Fran", lastName: "Desk", roleId: role.id },
    });

    authMock.auth.mockResolvedValue({
      user: {
        id: limited.id,
        email: limited.email,
        name: "Fran",
        role: "STAFF",
        tenantId: clinic,
        tenantSlug: null,
        staffProfileId: limitedProfile.id,
        customerProfileId: null,
        permissions: ["customers.view"],
      },
    });

    expect(await refundOrderAction(clinic, { orderId: order.id })).toMatchObject({ error: expect.any(String) });
    expect(stripeRefund).not.toHaveBeenCalled();
    expect(await rawDb.refund.count({ where: { payment: { orderId: order.id } } })).toBe(0);
  });

  it("gives the platform's fee back with the client's money", async () => {
    const order = await paidOrder(10_000, 1_000);
    await refundOrderAction(clinic, { orderId: order.id });

    expect(REFUND_RETURNS_PLATFORM_FEE).toBe(true);
    expect(stripeRefund).toHaveBeenCalledWith(
      expect.objectContaining({ stripeAccountId: ACCOUNT, amountCents: 10_000, hasApplicationFee: true }),
    );
  });

  it("asks Stripe not to touch a fee that was never charged", async () => {
    const order = await paidOrder(10_000, 0);
    await refundOrderAction(clinic, { orderId: order.id });
    expect(stripeRefund).toHaveBeenCalledWith(expect.objectContaining({ hasApplicationFee: false }));
  });

  it("refunds on the clinic's own connected account, never the platform's", async () => {
    const order = await paidOrder(2_000);
    await refundOrderAction(clinic, { orderId: order.id });
    const [params] = stripeRefund.mock.calls[0] as [{ stripeAccountId: string }];
    expect(params.stripeAccountId).toBe(ACCOUNT);
  });

  it("lists a client's orders with what is refundable, for the record staff have open", async () => {
    const order = await paidOrder(8_000);
    await refundOrderAction(clinic, { orderId: order.id, amount: "20" });

    const res = await clientOrdersAction(clinic, clientProfileId);
    expect(res).toMatchObject({ ok: true });
    const row = ("orders" in res ? res.orders : []).find((o) => o.id === order.id);
    expect(row).toMatchObject({ refundedCents: 2_000, refundableCents: 6_000 });
  });

  it("says plainly when an order has no payment to refund", async () => {
    const unpaid = await rawDb.order.create({
      data: {
        tenantId: clinic,
        customerProfileId: clientProfileId,
        orderNumber: `ORD-unpaid-${stamp}`,
        status: "PENDING",
        subtotalCents: 1_000,
        totalCents: 1_000,
        currency: "EUR",
      },
      select: { id: true },
    });

    expect(await refundOrderAction(clinic, { orderId: unpaid.id })).toMatchObject({ error: expect.stringMatching(/no completed payment/i) });
    expect(await refundableForOrderAction(clinic, unpaid.id)).toMatchObject({ ok: true, order: null });
  });
});
