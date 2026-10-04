import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

const push = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/lib/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/web-push")>();
  return { ...actual, notifyClientQuietly: (...args: unknown[]) => push.notify(...args) };
});

/** Stripe is faked at the boundary; the decisions underneath are the real ones. */
const stripe = vi.hoisted(() => ({
  cancel: vi.fn(),
  cancelAtEnd: vi.fn(),
  pause: vi.fn(),
  switchPrice: vi.fn(),
  skip: vi.fn(),
  read: vi.fn(),
  price: vi.fn(),
}));
vi.mock("@/lib/memberships-billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memberships-billing")>();
  return {
    ...actual,
    cancelMembershipSubscription: (...a: unknown[]) => stripe.cancel(...a),
    cancelAtPeriodEnd: (...a: unknown[]) => stripe.cancelAtEnd(...a),
    pauseCollection: (...a: unknown[]) => stripe.pause(...a),
    switchSubscriptionPrice: (...a: unknown[]) => stripe.switchPrice(...a),
    skipBillingUntil: (...a: unknown[]) => stripe.skip(...a),
    readSubscription: (...a: unknown[]) => stripe.read(...a),
    ensureStripePrice: (...a: unknown[]) => stripe.price(...a),
  };
});

const {
  clientMembershipAction,
  cancelClientMembershipAction,
  pauseClientMembershipAction,
  resumeClientMembershipAction,
  switchClientPlanAction,
  giveFreePeriodsAction,
} = await import("@/lib/actions/client-membership");

/**
 * A clinic managing one client's membership.
 *
 * Each of these changes what somebody pays or what they get, so the tests
 * check three things every time: Stripe was told (it owns the schedule), our
 * row says the same, and the client was told why — with the staff member's
 * name on the history row.
 */
describe("managing a client's membership", () => {
  const stamp = Date.now();
  const ACCOUNT = `acct_mm_${stamp}`;
  let clinic: string;
  let staffUserId: string;
  let staffProfileId: string;
  let clientProfileId: string;
  let clientUserId: string;
  let planId: string;
  let biggerPlanId: string;
  let membershipId: string;

  const asStaff = (permissions: "ALL" | string[] = "ALL") =>
    authMock.auth.mockResolvedValue({
      user: {
        id: staffUserId,
        email: `s-${stamp}@x.com`,
        name: "Sam Staff",
        role: permissions === "ALL" ? "TENANT_ADMIN" : "STAFF",
        tenantId: clinic,
        tenantSlug: null,
        staffProfileId,
        customerProfileId: null,
        permissions,
      },
    });

  const periodEnd = () => new Date(Date.now() + 20 * 86_400_000);

  async function member(overrides: Record<string, unknown> = {}) {
    await rawDb.customerMembership.deleteMany({ where: { tenantId: clinic } });
    const row = await rawDb.customerMembership.create({
      data: {
        tenantId: clinic,
        customerProfileId: clientProfileId,
        membershipPlanId: planId,
        status: "ACTIVE",
        currentPeriodStart: new Date(Date.now() - 10 * 86_400_000),
        currentPeriodEnd: periodEnd(),
        nextBillingAt: periodEnd(),
        stripeSubscriptionId: `sub_${stamp}`,
        ...overrides,
      } as never,
    });
    membershipId = row.id;
    return row;
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (
      await rawDb.tenant.create({
        data: { slug: `mm-${stamp}`, name: "Manage Clinic", stripeAccountId: ACCOUNT, stripeStatus: "ACTIVE", stripeChargesEnabled: true },
      })
    ).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Manage Clinic", currency: "EUR" } });

    const su = await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffUserId = su.id;
    staffProfileId = (await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: su.id, firstName: "Sam", lastName: "Staff" } })).id;

    const cu = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientUserId = cu.id;
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: cu.id, firstName: "Mia", lastName: "Member" } })).id;

    planId = (
      await rawDb.membershipPlan.create({ data: { tenantId: clinic, name: "Standard", billingFrequency: "MONTHLY", priceCents: 4_900 } })
    ).id;
    biggerPlanId = (
      await rawDb.membershipPlan.create({ data: { tenantId: clinic, name: "Premium", billingFrequency: "MONTHLY", priceCents: 9_900 } })
    ).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    stripe.price.mockResolvedValue(`price_${stamp}`);
    stripe.read.mockResolvedValue(null);
    asStaff();
    await rawDb.membershipBillingEvent.deleteMany({ where: { tenantId: clinic } });
  });

  it("shows the plan, the period and what happens next", async () => {
    await member();
    const res = await clientMembershipAction(clinic, clientProfileId);
    if ("error" in res) throw new Error(res.error);

    expect(res.membership).toMatchObject({ planName: "Standard", status: "ACTIVE", priceCents: 4_900, givesBenefits: true, cancelAtPeriodEnd: false });
    // And the plans they could move to.
    expect(res.plans.map((p) => p.name).sort()).toEqual(["Premium", "Standard"]);
  });

  it("cancels at the end of the period by default, keeping what was paid for", async () => {
    const row = await member();

    const res = await cancelClientMembershipAction(clinic, membershipId, { when: "period_end", reason: "Moving away" });
    expect(res).toMatchObject({ ok: true });

    // Stripe is told to stop at the period end rather than now.
    expect(stripe.cancelAtEnd).toHaveBeenCalledWith(ACCOUNT, row.stripeSubscriptionId, true);
    expect(stripe.cancel).not.toHaveBeenCalled();

    const after = await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(after).toMatchObject({ cancelAtPeriodEnd: true, status: "ACTIVE" });
    // They keep their benefits until it actually ends.
    expect(after.cancelledAt).toBeNull();
  });

  it("cancels on the spot when asked to", async () => {
    const row = await member();

    await cancelClientMembershipAction(clinic, membershipId, { when: "now", reason: "Fraud" });

    expect(stripe.cancel).toHaveBeenCalledWith(ACCOUNT, row.stripeSubscriptionId);
    const after = await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelledAt).not.toBeNull();
  });

  it("pauses and resumes the billing, and the benefits with it", async () => {
    await member();

    await pauseClientMembershipAction(clinic, membershipId, { reason: "Injury, back in spring" });
    expect(stripe.pause).toHaveBeenCalledWith(ACCOUNT, `sub_${stamp}`, true);
    let after = await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(after.status).toBe("PAUSED");
    expect(after.pausedAt).not.toBeNull();

    await resumeClientMembershipAction(clinic, membershipId, { reason: "Back now" });
    expect(stripe.pause).toHaveBeenLastCalledWith(ACCOUNT, `sub_${stamp}`, false);
    after = await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(after).toMatchObject({ status: "ACTIVE", pausedAt: null });
  });

  it("moves the client to another plan without charging them mid-period", async () => {
    await member();

    const res = await switchClientPlanAction(clinic, membershipId, { planId: biggerPlanId, reason: "Upgrading" });
    expect(res).toMatchObject({ ok: true, planId: biggerPlanId });

    // The price Stripe is given is the clinic's own, and the switch carries
    // no proration — the whole point of "from the next period".
    expect(stripe.price).toHaveBeenCalled();
    expect(stripe.switchPrice).toHaveBeenCalledWith(ACCOUNT, `sub_${stamp}`, `price_${stamp}`);
    expect(await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membershipId } })).toMatchObject({ membershipPlanId: biggerPlanId });
  });

  it("refuses a switch to the plan they are already on", async () => {
    await member();
    expect(await switchClientPlanAction(clinic, membershipId, { planId, reason: "No change" })).toMatchObject({ error: expect.any(String) });
    expect(stripe.switchPrice).not.toHaveBeenCalled();
  });

  it("gives free periods by pushing the next payment back", async () => {
    const row = await member();

    const res = await giveFreePeriodsAction(clinic, membershipId, { periods: "2", reason: "Sorry about the mix-up" });
    expect(res).toMatchObject({ ok: true });

    const [account, subId, until] = stripe.skip.mock.calls[0] as [string, string, Date];
    expect(account).toBe(ACCOUNT);
    expect(subId).toBe(row.stripeSubscriptionId);
    // Two months past the end of the period they are in.
    const expected = new Date(row.currentPeriodEnd);
    expected.setMonth(expected.getMonth() + 2);
    expect(until.toDateString()).toBe(expected.toDateString());

    const after = await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(after.nextBillingAt?.toDateString()).toBe(expected.toDateString());
  });

  it("counts free periods from Stripe's dates, not our copy of them", async () => {
    const row = await member();
    // Stripe says the period ends later than our row does.
    const stripeEnd = new Date(Date.now() + 40 * 86_400_000);
    stripe.read.mockResolvedValue({ items: { data: [{ current_period_end: Math.floor(stripeEnd.getTime() / 1000) }] } });

    await giveFreePeriodsAction(clinic, membershipId, { periods: "1", reason: "Goodwill" });

    const [, , until] = stripe.skip.mock.calls[0] as [string, string, Date];
    const expected = new Date(stripeEnd);
    expected.setMonth(expected.getMonth() + 1);
    expect(until.toDateString()).toBe(expected.toDateString());
    void row;
  });

  it("refuses between 1 and 12 periods, and nothing else", async () => {
    await member();
    for (const periods of ["0", "-1", "13", "1.5", "lots"]) {
      expect(await giveFreePeriodsAction(clinic, membershipId, { periods, reason: "Test" }), periods).toMatchObject({ error: expect.any(String) });
    }
    expect(stripe.skip).not.toHaveBeenCalled();
  });

  it("changes nothing when Stripe refuses", async () => {
    await member();
    stripe.pause.mockRejectedValueOnce(new Error("No such subscription"));

    expect(await pauseClientMembershipAction(clinic, membershipId, { reason: "Trying" })).toMatchObject({ error: expect.any(String) });
    // Our row must not claim something Stripe never agreed to.
    expect(await rawDb.customerMembership.findUniqueOrThrow({ where: { id: membershipId } })).toMatchObject({ status: "ACTIVE" });
  });

  it("writes every change to the history, the audit log and the client's phone", async () => {
    await member();

    await giveFreePeriodsAction(clinic, membershipId, { periods: "1", reason: "Late appointment" });

    const history = await rawDb.membershipBillingEvent.findFirstOrThrow({ where: { customerMembershipId: membershipId } });
    expect(history.description).toContain("Sam Staff");
    expect(history.description).toContain("Late appointment");

    // This membership's own entry: earlier tests in this file left their own.
    expect(
      await rawDb.auditLog.findFirstOrThrow({ where: { tenantId: clinic, action: "membership.free_periods", entityId: membershipId } }),
    ).toMatchObject({ actorUserId: staffUserId, entityType: "CustomerMembership" });

    const [userId, message] = push.notify.mock.calls[0] as [string, { body: string }];
    expect(userId).toBe(clientUserId);
    expect(message.body).toContain("Late appointment");
  });

  it("refuses a staff member without memberships.manage", async () => {
    await member();
    const limited = await rawDb.user.create({ data: { tenantId: clinic, email: `l-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } });
    const role = await rawDb.role.create({ data: { tenantId: clinic, name: `Desk ${stamp}` } });
    const view = await rawDb.permission.upsert({
      where: { key: "customers.view" },
      create: { key: "customers.view", label: "View customers", category: "Customers" },
      update: {},
    });
    await rawDb.rolePermission.create({ data: { roleId: role.id, permissionId: view.id } });
    const profile = await rawDb.staffProfile.create({
      data: { tenantId: clinic, userId: limited.id, firstName: "Dee", lastName: "Desk", roleId: role.id },
    });
    authMock.auth.mockResolvedValue({
      user: {
        id: limited.id,
        email: limited.email,
        name: "Dee",
        role: "STAFF",
        tenantId: clinic,
        tenantSlug: null,
        staffProfileId: profile.id,
        customerProfileId: null,
        permissions: ["customers.view"],
      },
    });

    expect(await cancelClientMembershipAction(clinic, membershipId, { when: "now", reason: "Nope" })).toMatchObject({ error: expect.any(String) });
    expect(stripe.cancel).not.toHaveBeenCalled();
    // Reading the record is still fine.
    expect(await clientMembershipAction(clinic, clientProfileId)).toMatchObject({ ok: true });
  });

  it("insists on a reason for every change", async () => {
    await member();
    expect(await cancelClientMembershipAction(clinic, membershipId, { when: "now", reason: " " })).toMatchObject({ error: expect.any(String) });
    expect(await pauseClientMembershipAction(clinic, membershipId, { reason: "" })).toMatchObject({ error: expect.any(String) });
    expect(stripe.cancel).not.toHaveBeenCalled();
    expect(stripe.pause).not.toHaveBeenCalled();
  });
});
