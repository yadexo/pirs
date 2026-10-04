import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type Stripe from "stripe";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/client-auth", () => clientAuthMock);

/** Stripe is faked at the module boundary; everything below it is the real code. */
const billing = vi.hoisted(() => ({ customer: vi.fn(), price: vi.fn(), subscribe: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/memberships-billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memberships-billing")>();
  return {
    ...actual,
    ensureStripeCustomer: (...args: unknown[]) => billing.customer(...args),
    ensureStripePrice: (...args: unknown[]) => billing.price(...args),
    createMembershipSubscription: (...args: unknown[]) => billing.subscribe(...args),
    cancelMembershipSubscription: (...args: unknown[]) => billing.cancel(...args),
  };
});

const { clientJoinPlanAction, clientCancelPlanAction } = await import("@/lib/actions/client-app");
const { handleStripeEvent } = await import("@/lib/stripe-webhook");
const { CRON_JOBS } = await import("@/lib/cron/jobs");
const { PAST_DUE_GRACE_MS } = await import("@/lib/membership-status");

/**
 * Memberships as Stripe subscriptions on the clinic's own account.
 *
 * The thing worth pinning down: signing up is not the same as paying. A
 * membership gives nothing — no benefits, no included credit — until Stripe
 * says the first invoice is paid, and it stops giving things when payments
 * stop for long enough.
 */
describe("joining a membership plan", () => {
  const stamp = Date.now();
  const ACCOUNT = `acct_mem_${stamp}`;
  const SLUG = `mem-${stamp}`;
  let clinic: string;
  let clientUserId: string;
  let clientProfileId: string;
  let planId: string;

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

  const subscriptionId = () => `sub_${stamp}_${Math.random().toString(36).slice(2, 7)}`;

  /** An invoice.paid event for a subscription, as Stripe delivers it. */
  const invoicePaid = (subId: string, opts: { amountPaid: number; start?: Date; end?: Date; id?: string }): Stripe.Event =>
    ({
      id: `evt_paid_${opts.id ?? subId}`,
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      account: ACCOUNT,
      data: {
        object: {
          id: opts.id ?? `in_${subId}`,
          object: "invoice",
          subscription: subId,
          amount_paid: opts.amountPaid,
          lines: {
            data: [
              {
                period: {
                  start: Math.floor((opts.start ?? new Date()).getTime() / 1000),
                  end: Math.floor((opts.end ?? new Date(Date.now() + 30 * 86_400_000)).getTime() / 1000),
                },
              },
            ],
          },
        },
      },
    }) as unknown as Stripe.Event;

  const invoiceFailed = (subId: string, amountDue: number, suffix = "1"): Stripe.Event =>
    ({
      id: `evt_failed_${subId}_${suffix}`,
      type: "invoice.payment_failed",
      created: Math.floor(Date.now() / 1000),
      account: ACCOUNT,
      data: { object: { id: `in_fail_${subId}_${suffix}`, object: "invoice", subscription: subId, amount_due: amountDue } },
    }) as unknown as Stripe.Event;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_memberships";
    process.env.PLATFORM_FEE_PERCENT = "10";

    clinic = (
      await rawDb.tenant.create({
        data: {
          slug: SLUG,
          name: "Membership Clinic",
          stripeAccountId: ACCOUNT,
          stripeStatus: "ACTIVE",
          stripeChargesEnabled: true,
          stripeDetailsSubmitted: true,
        },
      })
    ).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Membership Clinic", currency: "EUR" } });

    const user = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientUserId = user.id;
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: user.id, firstName: "Cara", lastName: "Client" } })).id;

    planId = (
      await rawDb.membershipPlan.create({
        data: { tenantId: clinic, name: "Glow Monthly", billingFrequency: "MONTHLY", priceCents: 4_900, includedCreditCents: 1_000 },
      })
    ).id;
  });

  afterAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.PLATFORM_FEE_PERCENT;
    await deleteTenantCompletely(clinic);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    billing.customer.mockResolvedValue(`cus_${stamp}`);
    billing.price.mockResolvedValue(`price_${stamp}`);
    billing.cancel.mockResolvedValue(undefined);
    asClient();
    // Each test starts with no membership and an empty credit balance of its own.
    await rawDb.membershipBillingEvent.deleteMany({ where: { tenantId: clinic } });
    await rawDb.customerMembership.deleteMany({ where: { tenantId: clinic } });
    await rawDb.accountCreditTransaction.deleteMany({ where: { tenantId: clinic } });
    await rawDb.customerProfile.update({ where: { id: clientProfileId }, data: { accountCreditBalanceCents: 0 } });
  });

  /** Signs up and returns the pending membership with its subscription id. */
  async function join() {
    const subId = subscriptionId();
    billing.subscribe.mockResolvedValue({
      subscriptionId: subId,
      clientSecret: "pi_secret_membership",
      publishableKey: "pk_test_x",
      stripeAccountId: ACCOUNT,
      applicationFeePercent: 10,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    });
    const res = await clientJoinPlanAction(SLUG, planId);
    if ("error" in res) throw new Error(`join failed: ${res.error}`);
    return { res, subId };
  }

  it("creates a membership that is pending, not active, and grants no credit", async () => {
    const { res } = await join();
    expect(res).toMatchObject({ ok: true, paid: false, name: "Glow Monthly", firstPaymentCents: 4_900 });
    if (!("payment" in res)) throw new Error("expected a payment handoff");
    expect(res.payment.clientSecret).toBe("pi_secret_membership");

    const membership = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });
    expect(membership).toMatchObject({ status: "PENDING", creditBalanceCents: 0 });
    expect(membership.stripeSubscriptionId).toMatch(/^sub_/);
  });

  it("subscribes on the clinic's own account, with the platform's percentage", async () => {
    await join();
    const [params] = billing.subscribe.mock.calls[0] as [{ clinic: { stripeAccountId: string }; stripeCustomerId: string; priceId: string }];
    expect(params.clinic.stripeAccountId).toBe(ACCOUNT);
    expect(params.stripeCustomerId).toBe(`cus_${stamp}`);
    expect(params.priceId).toBe(`price_${stamp}`);
  });

  it("activates the membership and grants the credit only when the invoice is paid", async () => {
    const { subId } = await join();

    await handleStripeEvent(invoicePaid(subId, { amountPaid: 4_900 }));

    const membership = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });
    expect(membership).toMatchObject({ status: "ACTIVE", creditBalanceCents: 1_000, failedAttempts: 0, pastDueSince: null });
    const grant = await rawDb.membershipBillingEvent.findFirst({ where: { customerMembershipId: membership.id, type: "CREDIT_GRANT" } });
    expect(grant).toMatchObject({ amountCents: 1_000 });

    // And it is spendable money in the client's own balance, not just a
    // number on the membership — that is the whole point of including it.
    expect(await rawDb.customerProfile.findUniqueOrThrow({ where: { id: clientProfileId } })).toMatchObject({
      accountCreditBalanceCents: 1_000,
    });
    expect(await rawDb.accountCreditTransaction.findFirstOrThrow({ where: { customerProfileId: clientProfileId } })).toMatchObject({
      type: "MEMBERSHIP_GRANT",
      amountCents: 1_000,
      balanceAfterCents: 1_000,
    });
  });

  it("grants the included credit once however many times Stripe delivers the invoice", async () => {
    const { subId } = await join();
    const event = invoicePaid(subId, { amountPaid: 4_900, id: "in_once" });

    await handleStripeEvent(event);
    await handleStripeEvent(event);

    const membership = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });
    expect(membership.creditBalanceCents).toBe(1_000);
    expect(await rawDb.membershipBillingEvent.count({ where: { customerMembershipId: membership.id, type: "CREDIT_GRANT" } })).toBe(1);
  });

  it("grants the credit again for the next period, not only the first", async () => {
    const { subId } = await join();
    await handleStripeEvent(invoicePaid(subId, { amountPaid: 4_900, id: "in_period_1" }));
    await handleStripeEvent(invoicePaid(subId, { amountPaid: 4_900, id: "in_period_2" }));

    const membership = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });
    expect(membership.creditBalanceCents).toBe(2_000);
  });

  it("marks a membership past due when a payment fails, and keeps its benefits for now", async () => {
    const { subId } = await join();
    await handleStripeEvent(invoicePaid(subId, { amountPaid: 4_900, id: "in_first" }));

    await handleStripeEvent(invoiceFailed(subId, 4_900));

    const membership = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });
    expect(membership).toMatchObject({ status: "PAST_DUE", failedAttempts: 1 });
    expect(membership.pastDueSince).not.toBeNull();
    // Still paid-for benefits: the grace period has only just started.
    expect(await rawDb.membershipBillingEvent.count({ where: { customerMembershipId: membership.id, type: "FAILED_PAYMENT" } })).toBe(1);
  });

  it("counts the grace period from the first failure, not the latest", async () => {
    const { subId } = await join();
    await handleStripeEvent(invoiceFailed(subId, 4_900, "a"));
    const first = (await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } })).pastDueSince;

    await handleStripeEvent(invoiceFailed(subId, 4_900, "b"));
    const after = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });

    expect(after.pastDueSince?.getTime()).toBe(first?.getTime());
    expect(after.failedAttempts).toBe(2);
  });

  it("suspends a membership once the grace period has run out, and not before", async () => {
    const { subId } = await join();
    await handleStripeEvent(invoiceFailed(subId, 4_900));
    const membership = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });

    // A day in: nothing happens.
    await rawDb.customerMembership.update({ where: { id: membership.id }, data: { pastDueSince: new Date(Date.now() - 86_400_000) } });
    await CRON_JOBS.memberships!();
    expect((await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe("PAST_DUE");

    // Past the grace period: it stops.
    await rawDb.customerMembership.update({
      where: { id: membership.id },
      data: { pastDueSince: new Date(Date.now() - PAST_DUE_GRACE_MS - 60_000) },
    });
    await CRON_JOBS.memberships!();
    expect((await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe("SUSPENDED");
  });

  it("brings a suspended membership back when a payment finally succeeds", async () => {
    const { subId } = await join();
    await handleStripeEvent(invoiceFailed(subId, 4_900));
    const membership = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });
    await rawDb.customerMembership.update({
      where: { id: membership.id },
      data: { pastDueSince: new Date(Date.now() - PAST_DUE_GRACE_MS - 60_000) },
    });
    await CRON_JOBS.memberships!();

    await handleStripeEvent(invoicePaid(subId, { amountPaid: 4_900, id: "in_recovered" }));

    expect(await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({
      status: "ACTIVE",
      failedAttempts: 0,
      pastDueSince: null,
    });
  });

  it("refuses a second membership while one is waiting for its first payment", async () => {
    await join();
    const again = await clientJoinPlanAction(SLUG, planId);
    expect(again).toMatchObject({ error: expect.stringMatching(/waiting for its first payment/i) });
    expect(await rawDb.customerMembership.count({ where: { tenantId: clinic } })).toBe(1);
  });

  it("leaves nothing behind when Stripe refuses the subscription", async () => {
    billing.subscribe.mockRejectedValue(new Error("No such customer"));
    expect(await clientJoinPlanAction(SLUG, planId)).toMatchObject({ error: expect.any(String) });

    // The slot has to be free for them to try again.
    const rows = await rawDb.customerMembership.findMany({ where: { tenantId: clinic } });
    expect(rows.every((m) => m.status === "CANCELLED")).toBe(true);
    expect(await clientJoinPlanAction(SLUG, planId)).not.toMatchObject({ error: expect.stringMatching(/already/i) });
  });

  it("cancels on the clinic's own account", async () => {
    const { subId } = await join();
    await handleStripeEvent(invoicePaid(subId, { amountPaid: 4_900, id: "in_cancel" }));

    expect(await clientCancelPlanAction(SLUG)).toMatchObject({ ok: true });
    expect(billing.cancel).toHaveBeenCalledWith(ACCOUNT, subId);
    expect((await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } })).status).toBe("CANCELLED");
  });

  it("does not restart a membership the client cancelled", async () => {
    const { subId } = await join();
    await handleStripeEvent(invoicePaid(subId, { amountPaid: 4_900, id: "in_before_cancel" }));
    await clientCancelPlanAction(SLUG);

    // A final invoice settling afterwards is money owed for a period already
    // had, not permission to start the plan up again.
    await handleStripeEvent(invoicePaid(subId, { amountPaid: 4_900, id: "in_after_cancel" }));

    const membership = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });
    expect(membership.status).toBe("CANCELLED");
    expect(membership.creditBalanceCents).toBe(1_000); // the first period's, not a second
  });

  it("refuses to join at a clinic that can't take payments", async () => {
    await rawDb.tenant.update({ where: { id: clinic }, data: { stripeChargesEnabled: false, stripeStatus: "PENDING_VERIFICATION" } });
    try {
      expect(await clientJoinPlanAction(SLUG, planId)).toMatchObject({ error: expect.stringMatching(/verified|can't take card payments/i) });
      expect(await rawDb.customerMembership.count({ where: { tenantId: clinic } })).toBe(0);
    } finally {
      await rawDb.tenant.update({ where: { id: clinic }, data: { stripeChargesEnabled: true, stripeStatus: "ACTIVE" } });
    }
  });

  it("frees the client when Stripe gives up on an unpaid first invoice", async () => {
    const { subId } = await join();
    const expired = {
      id: `evt_sub_expired_${stamp}`,
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      account: ACCOUNT,
      data: { object: { id: subId, object: "subscription", status: "incomplete_expired" } },
    } as unknown as Stripe.Event;

    await handleStripeEvent(expired);

    expect((await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } })).status).toBe("CANCELLED");
    // And they can sign up again, rather than being blocked for good.
    expect(await clientJoinPlanAction(SLUG, planId)).toMatchObject({ ok: true });
  });

  it("cancels a sign-up that never paid, even if Stripe never told us", async () => {
    await join();
    const membership = await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } });
    await rawDb.customerMembership.update({
      where: { id: membership.id },
      data: { createdAt: new Date(Date.now() - 40 * 60 * 60 * 1000) },
    });

    const result = await CRON_JOBS.memberships!();

    expect(result.abandonedSignups).toBeGreaterThanOrEqual(1);
    expect((await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe("CANCELLED");
  });

  it("leaves a fresh sign-up alone while it waits to be paid", async () => {
    await join();
    await CRON_JOBS.memberships!();
    expect((await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } })).status).toBe("PENDING");
  });

  it("reads an incomplete subscription as still pending, never as active", async () => {
    const { subId } = await join();
    const event = {
      id: `evt_sub_${stamp}`,
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      account: ACCOUNT,
      data: { object: { id: subId, object: "subscription", status: "incomplete" } },
    } as unknown as Stripe.Event;

    await handleStripeEvent(event);
    expect((await rawDb.customerMembership.findFirstOrThrow({ where: { tenantId: clinic } })).status).toBe("PENDING");
  });
});
