import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { PRICE_NOTICE_DAYS } from "@/lib/membership-price-change";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

const push = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/lib/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/web-push")>();
  return { ...actual, notifyClientQuietly: (...args: unknown[]) => push.notify(...args) };
});

const email = vi.hoisted(() => ({ send: vi.fn(async (_params: { to: string; subject?: string; body: string }) => ({ ok: true })) }));
vi.mock("@/lib/providers/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/notifications")>();
  return { ...actual, getEmailProvider: () => ({ send: email.send }) };
});

const stripe = vi.hoisted(() => ({ price: vi.fn(), switchPrice: vi.fn() }));
vi.mock("@/lib/memberships-billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memberships-billing")>();
  return {
    ...actual,
    ensureStripePrice: (...a: unknown[]) => stripe.price(...a),
    switchSubscriptionPrice: (...a: unknown[]) => stripe.switchPrice(...a),
  };
});

const { rolloutPlanPrice, applyDuePriceChanges } = await import("@/lib/membership-price-rollout");
const { saveMembershipPlanAction } = await import("@/lib/actions/app-builder");
const { CRON_JOBS } = await import("@/lib/cron/jobs");

/**
 * Raising a plan's price for the people already on it.
 *
 * The promise being kept is that nobody pays more than they agreed to without
 * a month to decide whether to stay. That makes the interesting cases the
 * awkward ones: a member billed next week, a member billed next quarter, and
 * what Stripe is told in each case — because switching a price changes the
 * very next invoice, which is exactly what must not happen to the first one.
 */
describe("moving existing members to a new price", () => {
  const stamp = Date.now();
  const ACCOUNT = `acct_pr_${stamp}`;
  const DAY = 24 * 60 * 60 * 1000;
  let clinic: string;
  let staffUserId: string;
  let staffProfileId: string;
  let planId: string;

  const asOwner = (permissions: "ALL" | string[] = "ALL") =>
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

  /** A member of the plan, billed on the day given. */
  async function member(nextBillingInDays: number, suffix: string) {
    const user = await rawDb.user.create({ data: { tenantId: clinic, email: `m-${suffix}-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    const profile = await rawDb.customerProfile.create({
      data: { tenantId: clinic, userId: user.id, firstName: "Mem", lastName: suffix },
    });
    const nextBillingAt = new Date(Date.now() + nextBillingInDays * DAY);
    const membership = await rawDb.customerMembership.create({
      data: {
        tenantId: clinic,
        customerProfileId: profile.id,
        membershipPlanId: planId,
        status: "ACTIVE",
        currentPeriodEnd: nextBillingAt,
        nextBillingAt,
        stripeSubscriptionId: `sub_${suffix}_${stamp}`,
      } as never,
    });
    return { profile, membership, userId: user.id, nextBillingAt };
  }

  const planForm = (priceCents: number, applyToExisting: boolean) => {
    const fd = new FormData();
    fd.set("name", "Standard");
    fd.set("billingFrequency", "MONTHLY");
    fd.set("price", (priceCents / 100).toFixed(2));
    fd.set("includedCredit", "0");
    fd.set("benefits", "");
    fd.set("active", "on");
    if (applyToExisting) fd.set("applyToExistingMembers", "on");
    return fd;
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (
      await rawDb.tenant.create({
        data: { slug: `pr-${stamp}`, name: "Price Clinic", stripeAccountId: ACCOUNT, stripeStatus: "ACTIVE", stripeChargesEnabled: true },
      })
    ).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Price Clinic", currency: "EUR" } });

    const su = await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffUserId = su.id;
    staffProfileId = (await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: su.id, firstName: "Sam", lastName: "Staff" } })).id;

    planId = (
      await rawDb.membershipPlan.create({ data: { tenantId: clinic, name: "Standard", billingFrequency: "MONTHLY", priceCents: 4_900 } })
    ).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    stripe.price.mockResolvedValue(`price_new_${stamp}`);
    asOwner();
    await rawDb.membershipPriceChange.deleteMany({ where: { tenantId: clinic } });
    await rawDb.customerMembership.deleteMany({ where: { tenantId: clinic } });
    await rawDb.membershipPlan.update({ where: { id: planId }, data: { priceCents: 4_900 } });
  });

  it("switches at Stripe now when the member's next payment is far enough off", async () => {
    const far = await member(45, "far");

    const result = await rolloutPlanPrice({
      tenantId: clinic,
      planId,
      oldPriceCents: 4_900,
      newPriceCents: 5_900,
      reason: "Costs went up",
      staffProfileId,
    });

    expect(result).toMatchObject({ members: 1, appliedNow: 1, deferred: 0, notified: 1, failed: 0 });
    expect(stripe.switchPrice).toHaveBeenCalledWith(ACCOUNT, far.membership.stripeSubscriptionId, `price_new_${stamp}`);

    const change = await rawDb.membershipPriceChange.findFirstOrThrow({ where: { customerMembershipId: far.membership.id } });
    expect(change.effectiveAt.toDateString()).toBe(far.nextBillingAt.toDateString());
    expect(change.appliedAt).not.toBeNull();
  });

  it("leaves a member billed next week alone until after that payment", async () => {
    const soon = await member(5, "soon");

    const result = await rolloutPlanPrice({
      tenantId: clinic,
      planId,
      oldPriceCents: 4_900,
      newPriceCents: 5_900,
      reason: "Costs went up",
      staffProfileId,
    });

    expect(result).toMatchObject({ appliedNow: 0, deferred: 1, notified: 1 });
    // Telling Stripe now would put the new price on the invoice in five days,
    // which is the one thing the notice period forbids.
    expect(stripe.switchPrice).not.toHaveBeenCalled();

    const change = await rawDb.membershipPriceChange.findFirstOrThrow({ where: { customerMembershipId: soon.membership.id } });
    expect(change.appliedAt).toBeNull();
    expect(change.applyAfter.toDateString()).toBe(soon.nextBillingAt.toDateString());
    // A month after the payment they were not warned about.
    const expected = new Date(soon.nextBillingAt);
    expected.setMonth(expected.getMonth() + 1);
    expect(change.effectiveAt.toDateString()).toBe(expected.toDateString());
  });

  it("never promises a date less than the notice period away", async () => {
    await member(1, "tomorrow");
    await member(10, "soonish");
    await member(31, "ok");

    await rolloutPlanPrice({ tenantId: clinic, planId, oldPriceCents: 4_900, newPriceCents: 5_900, reason: null, staffProfileId });

    const changes = await rawDb.membershipPriceChange.findMany({ where: { tenantId: clinic } });
    expect(changes).toHaveLength(3);
    const earliest = new Date(Date.now() + PRICE_NOTICE_DAYS * DAY);
    for (const change of changes) {
      expect(change.effectiveAt.getTime()).toBeGreaterThanOrEqual(earliest.getTime() - 1000);
    }
  });

  it("tells every member by push and by email, with the price, the date and how to leave", async () => {
    await member(40, "told");

    await rolloutPlanPrice({ tenantId: clinic, planId, oldPriceCents: 4_900, newPriceCents: 5_900, reason: null, staffProfileId });

    const [, message] = push.notify.mock.calls[0] as [string, { body: string }];
    expect(message.body).toContain("59");
    expect(message.body).toMatch(/cancel/i);

    expect(email.send).toHaveBeenCalledTimes(1);
    const sent = email.send.mock.calls[0]![0];
    expect(sent.subject ?? "").toMatch(/price is changing/i);
    // The link, because telling somebody they may cancel while making them
    // hunt for the button is not telling them.
    expect(sent.body).toMatch(/profile\?tab=membership/);
    expect(sent.body).toMatch(/stay at the price you signed up on/i);
  });

  it("finishes a deferred change once the invoice it was waiting for has gone", async () => {
    const soon = await member(5, "deferred");
    await rolloutPlanPrice({ tenantId: clinic, planId, oldPriceCents: 4_900, newPriceCents: 5_900, reason: null, staffProfileId });
    expect(stripe.switchPrice).not.toHaveBeenCalled();

    // Nothing is due yet.
    expect(await applyDuePriceChanges(new Date())).toMatchObject({ applied: 0 });
    expect(stripe.switchPrice).not.toHaveBeenCalled();

    // The day after their payment went out.
    const after = new Date(soon.nextBillingAt.getTime() + DAY);
    expect(await applyDuePriceChanges(after)).toMatchObject({ applied: 1, failed: 0 });
    expect(stripe.switchPrice).toHaveBeenCalledWith(ACCOUNT, soon.membership.stripeSubscriptionId, `price_new_${stamp}`);

    expect((await rawDb.membershipPriceChange.findFirstOrThrow({ where: { customerMembershipId: soon.membership.id } })).appliedAt).not.toBeNull();
  });

  it("applies a deferred change once, however often the cron runs", async () => {
    const soon = await member(5, "once");
    await rolloutPlanPrice({ tenantId: clinic, planId, oldPriceCents: 4_900, newPriceCents: 5_900, reason: null, staffProfileId });

    const after = new Date(soon.nextBillingAt.getTime() + DAY);
    await applyDuePriceChanges(after);
    await applyDuePriceChanges(after);

    expect(stripe.switchPrice).toHaveBeenCalledTimes(1);
  });

  it("puts a failed change back for the next run rather than losing it", async () => {
    const soon = await member(5, "retry");
    await rolloutPlanPrice({ tenantId: clinic, planId, oldPriceCents: 4_900, newPriceCents: 5_900, reason: null, staffProfileId });
    stripe.switchPrice.mockRejectedValueOnce(new Error("Stripe is having a bad day"));

    const after = new Date(soon.nextBillingAt.getTime() + DAY);
    expect(await applyDuePriceChanges(after)).toMatchObject({ applied: 0, failed: 1 });
    // Still unapplied, so the next run tries again.
    expect((await rawDb.membershipPriceChange.findFirstOrThrow({ where: { customerMembershipId: soon.membership.id } })).appliedAt).toBeNull();

    expect(await applyDuePriceChanges(after)).toMatchObject({ applied: 1 });
  });

  it("carries one member's failure without stranding the others", async () => {
    await member(40, "a");
    await member(40, "b");
    stripe.switchPrice.mockRejectedValueOnce(new Error("No such subscription"));

    const result = await rolloutPlanPrice({ tenantId: clinic, planId, oldPriceCents: 4_900, newPriceCents: 5_900, reason: null, staffProfileId });

    expect(result).toMatchObject({ members: 2, failed: 1, appliedNow: 1 });
  });

  it("the memberships cron finishes what is due", async () => {
    const soon = await member(-1, "due");
    await rolloutPlanPrice({ tenantId: clinic, planId, oldPriceCents: 4_900, newPriceCents: 5_900, reason: null, staffProfileId });
    void soon;

    const result = await CRON_JOBS.memberships!();
    expect(result.priceChangesApplied).toBe(1);
  });
});

/**
 * The choice itself, in the form the clinic actually fills in. A price rise
 * that quietly moved everybody would be a very expensive default.
 */
describe("the plan form's choice about existing members", () => {
  const stamp = Date.now() + 1;
  let clinic: string;
  let staffUserId: string;
  let staffProfileId: string;
  let planId: string;
  let membershipId: string;

  const signIn = (permissions: "ALL" | string[], role: "TENANT_ADMIN" | "STAFF" = "TENANT_ADMIN") =>
    authMock.auth.mockResolvedValue({
      user: {
        id: staffUserId,
        email: `c-${stamp}@x.com`,
        name: "Cat Catalogue",
        role,
        tenantId: clinic,
        tenantSlug: null,
        staffProfileId,
        customerProfileId: null,
        permissions,
      },
    });

  const form = (priceCents: number, applyToExisting: boolean) => {
    const fd = new FormData();
    fd.set("name", "Standard");
    fd.set("billingFrequency", "MONTHLY");
    fd.set("price", (priceCents / 100).toFixed(2));
    fd.set("includedCredit", "0");
    fd.set("benefits", "");
    fd.set("active", "on");
    if (applyToExisting) fd.set("applyToExistingMembers", "on");
    return fd;
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `pf-${stamp}`, name: "Form Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Form Clinic", currency: "EUR" } });

    const su = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffUserId = su.id;
    staffProfileId = (await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: su.id, firstName: "Cat", lastName: "Catalogue" } })).id;

    planId = (await rawDb.membershipPlan.create({ data: { tenantId: clinic, name: "Standard", billingFrequency: "MONTHLY", priceCents: 4_900 } })).id;

    const cu = await rawDb.user.create({ data: { tenantId: clinic, email: `cm-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    const profile = await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: cu.id, firstName: "Mo", lastName: "Member" } });
    membershipId = (
      await rawDb.customerMembership.create({
        data: {
          tenantId: clinic,
          customerProfileId: profile.id,
          membershipPlanId: planId,
          status: "ACTIVE",
          currentPeriodEnd: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
          nextBillingAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
        } as never,
      })
    ).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    stripe.price.mockResolvedValue(`price_${stamp}`);
    signIn("ALL");
    await rawDb.membershipPriceChange.deleteMany({ where: { tenantId: clinic } });
    await rawDb.membershipPlan.update({ where: { id: planId }, data: { priceCents: 4_900 } });
  });

  it("changes the price for new members only, by default", async () => {
    const res = await saveMembershipPlanAction(clinic, planId, form(5_900, false));
    expect(res).toMatchObject({ ok: true });
    expect("priceRollout" in res && res.priceRollout).toBeFalsy();

    expect(await rawDb.membershipPlan.findUniqueOrThrow({ where: { id: planId } })).toMatchObject({ priceCents: 5_900 });
    // Nobody already on the plan was touched.
    expect(await rawDb.membershipPriceChange.count({ where: { tenantId: clinic } })).toBe(0);
  });

  it("moves existing members when asked, and says how many", async () => {
    const res = await saveMembershipPlanAction(clinic, planId, form(5_900, true));
    if (!("priceRollout" in res) || !res.priceRollout) throw new Error("expected a rollout");

    expect(res.priceRollout).toMatchObject({ members: 1, notified: 1 });
    expect(await rawDb.membershipPriceChange.findFirstOrThrow({ where: { customerMembershipId: membershipId } })).toMatchObject({
      oldPriceCents: 4_900,
      newPriceCents: 5_900,
    });
  });

  it("does nothing to members when the price didn't actually change", async () => {
    await saveMembershipPlanAction(clinic, planId, form(4_900, true));
    expect(await rawDb.membershipPriceChange.count({ where: { tenantId: clinic } })).toBe(0);
  });

  it("keeps the whole plan form away from staff who may not manage memberships", async () => {
    /**
     * A real staff account with a real role granting catalog.manage and
     * nothing else. The session is not trusted for this — permissions are
     * read from the database on every write — so the account has to exist as
     * described, or an owner's "ALL" would quietly sail through.
     *
     * Editing a membership plan is governed by memberships.manage, not by the
     * catalogue permission, so somebody who can edit treatments and products
     * cannot change what members pay at all — with or without the tick.
     */
    const limited = await rawDb.user.create({ data: { tenantId: clinic, email: `cat-${stamp}@x.com`, passwordHash: "x", role: "STAFF" } });
    const role = await rawDb.role.create({ data: { tenantId: clinic, name: `Catalogue ${stamp}` } });
    const catalogue = await rawDb.permission.upsert({
      where: { key: "catalog.manage" },
      create: { key: "catalog.manage", label: "Manage products, services and plans", category: "Catalog" },
      update: {},
    });
    await rawDb.rolePermission.create({ data: { roleId: role.id, permissionId: catalogue.id } });
    const profile = await rawDb.staffProfile.create({
      data: { tenantId: clinic, userId: limited.id, firstName: "Cal", lastName: "Catalogue", roleId: role.id },
    });

    authMock.auth.mockResolvedValue({
      user: {
        id: limited.id,
        email: limited.email,
        name: "Cal Catalogue",
        role: "STAFF",
        tenantId: clinic,
        tenantSlug: null,
        staffProfileId: profile.id,
        customerProfileId: null,
        permissions: ["catalog.manage"],
      },
    });

    expect(await saveMembershipPlanAction(clinic, planId, form(6_900, true))).toMatchObject({ error: expect.any(String) });
    // Refused whole: no price change, and nobody moved.
    expect(await rawDb.membershipPlan.findUniqueOrThrow({ where: { id: planId } })).toMatchObject({ priceCents: 4_900 });
    expect(await rawDb.membershipPriceChange.count({ where: { tenantId: clinic } })).toBe(0);

    // Not even the harmless version of the same edit.
    expect(await saveMembershipPlanAction(clinic, planId, form(6_900, false))).toMatchObject({ error: expect.any(String) });
    expect(await rawDb.membershipPlan.findUniqueOrThrow({ where: { id: planId } })).toMatchObject({ priceCents: 4_900 });
  });

  it("lets somebody who may manage memberships do both", async () => {
    // The permission that governs the plan is the one that governs its price.
    signIn("ALL");
    expect(await saveMembershipPlanAction(clinic, planId, form(5_400, true))).toMatchObject({ ok: true });
    expect(await rawDb.membershipPriceChange.count({ where: { tenantId: clinic } })).toBe(1);
  });

  it("still refuses to change the billing period under a member", async () => {
    const fd = form(4_900, false);
    fd.set("billingFrequency", "ANNUAL");
    expect(await saveMembershipPlanAction(clinic, planId, fd)).toMatchObject({ error: expect.any(String) });
  });
});
