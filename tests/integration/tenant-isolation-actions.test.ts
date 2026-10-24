import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

/**
 * tests/integration/tenant-isolation.test.ts already proves the data layer
 * itself (getTenantDb's Prisma extension) cannot read, write or delete
 * another tenant's rows. This file proves the same thing one level up: that
 * no *server action* a clinic's own staff can call lets them reach another
 * clinic's clients, orders, items, packages, memberships, credit, points,
 * campaigns or settings — by actually calling the real actions, signed in as
 * clinic A, naming clinic B's own resource ids, exactly as a malicious or
 * buggy client-side request would.
 *
 * Every case here is the same shape: the action is asked to act on a real
 * resource that exists, just not in the caller's own tenant. The question is
 * never "does this throw" (several of these return a friendly ActionResult
 * error instead) but "did tenant B's row change" — checked straight from
 * rawDb, unscoped, after every attempt.
 */

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn() }));

const { adjustAccountCreditAction, toggleCustomerTagAction } = await import("@/lib/actions/customers");
const { manualLoyaltyAdjustmentAction } = await import("@/lib/actions/loyalty");
const { refundableForOrderAction } = await import("@/lib/actions/refund-order");
const { voidClientItemAction } = await import("@/lib/actions/client-items");
const { spendPackageSessionAction, clientPackagesAction } = await import("@/lib/actions/redeem");
const { cancelClientMembershipAction } = await import("@/lib/actions/client-membership");
const { cancelCampaignAction } = await import("@/lib/actions/campaigns");
const { resendInviteAction } = await import("@/lib/actions/clinic-settings");

describe("tenant isolation through server actions", () => {
  const stamp = Date.now();
  let tenantA: { id: string };
  let tenantB: { id: string };
  let staffA: { id: string; staffProfileId: string };
  let customerB: { id: string; userId: string };
  let serviceB: { id: string };
  let orderB: { id: string };
  let itemB: { id: string };
  let customerPackageB: { id: string };
  let membershipB: { id: string };
  let campaignB: { id: string };
  let staffProfileB: { id: string };

  function asStaffA() {
    authMock.auth.mockResolvedValue({
      user: {
        id: staffA.id,
        email: "a@example.com",
        name: "Staff A",
        role: "TENANT_ADMIN",
        tenantId: tenantA.id,
        tenantSlug: "tenant-a",
        staffProfileId: staffA.staffProfileId,
        customerProfileId: null,
        permissions: "ALL",
      },
    });
  }

  beforeAll(async () => {
    tenantA = await rawDb.tenant.create({ data: { slug: `iso-a-${stamp}`, name: "Isolation Tenant A", status: "ACTIVE" } });
    tenantB = await rawDb.tenant.create({ data: { slug: `iso-b-${stamp}`, name: "Isolation Tenant B", status: "ACTIVE" } });

    const ownerA = await rawDb.user.create({ data: { tenantId: tenantA.id, email: `owner-a-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    const staffProfileA = await rawDb.staffProfile.create({ data: { tenantId: tenantA.id, userId: ownerA.id, firstName: "A", lastName: "Owner", active: true } });
    staffA = { id: ownerA.id, staffProfileId: staffProfileA.id };

    const userB = await rawDb.user.create({ data: { tenantId: tenantB.id, email: `client-b-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    const profileB = await rawDb.customerProfile.create({
      data: { tenantId: tenantB.id, userId: userB.id, firstName: "Client", lastName: "B", accountCreditBalanceCents: 1000, loyaltyPointsBalance: 100 },
    });
    customerB = { id: profileB.id, userId: userB.id };

    const ownerB = await rawDb.user.create({ data: { tenantId: tenantB.id, email: `owner-b-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    const staffProfB = await rawDb.staffProfile.create({ data: { tenantId: tenantB.id, userId: ownerB.id, firstName: "B", lastName: "Owner", active: true } });
    staffProfileB = { id: staffProfB.id };

    const catB = await rawDb.serviceCategory.create({ data: { tenantId: tenantB.id, name: "Cat B" } });
    const svcB = await rawDb.service.create({ data: { tenantId: tenantB.id, categoryId: catB.id, name: "Service B", durationMinutes: 30, priceCents: 5000 } });
    serviceB = { id: svcB.id };

    const order = await rawDb.order.create({
      data: { tenantId: tenantB.id, customerProfileId: customerB.id, orderNumber: `ORD-ISO-${stamp}`, status: "PAID", subtotalCents: 5000, totalCents: 5000, currency: "EUR" },
    });
    orderB = { id: order.id };
    const orderItem = await rawDb.orderItem.create({
      data: { orderId: order.id, itemType: "SERVICE", serviceId: serviceB.id, name: "Service B", quantity: 1, unitPriceCents: 5000, totalCents: 5000 } as never,
    });

    const item = await rawDb.redeemableItem.create({
      data: {
        tenantId: tenantB.id,
        customerProfileId: customerB.id,
        orderId: order.id,
        orderItemId: orderItem.id,
        unitIndex: 0,
        itemType: "SERVICE",
        name: "Service B",
        status: "AVAILABLE",
        token: `tok-iso-${stamp}`,
        code: `CODE-${stamp}`,
      } as never,
    });
    itemB = { id: item.id };

    const pkg = await rawDb.package.create({
      data: { tenantId: tenantB.id, name: "Package B", priceCents: 10000, totalUses: 5 },
    });
    await rawDb.packageItem.create({ data: { packageId: pkg.id, serviceId: serviceB.id } });
    const custPkg = await rawDb.customerPackage.create({
      data: { tenantId: tenantB.id, customerProfileId: customerB.id, packageId: pkg.id, remainingUses: 5, totalUses: 5, status: "ACTIVE" } as never,
    });
    customerPackageB = { id: custPkg.id };

    const plan = await rawDb.membershipPlan.create({ data: { tenantId: tenantB.id, name: "Plan B", priceCents: 4900, billingFrequency: "MONTHLY" } as never });
    const membership = await rawDb.customerMembership.create({
      data: { tenantId: tenantB.id, customerProfileId: customerB.id, membershipPlanId: plan.id, status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 30 * 86400000) } as never,
    });
    membershipB = { id: membership.id };

    const campaign = await rawDb.notificationCampaign.create({
      data: { tenantId: tenantB.id, name: "Campaign B", channel: "PUSH", status: "SCHEDULED", segment: "ALL", subject: "Hi", body: "Hi", scheduledAt: new Date(Date.now() + 86400000) } as never,
    });
    campaignB = { id: campaign.id };
  });

  afterAll(async () => {
    await deleteTenantCompletely(tenantA.id).catch(() => undefined);
    await deleteTenantCompletely(tenantB.id).catch(() => undefined);
  });

  it("cannot adjust another tenant's client's account credit", async () => {
    asStaffA();
    const fd = new FormData();
    fd.set("customerProfileId", customerB.id);
    fd.set("amount", "50");
    fd.set("reason", "test");
    const res = (await adjustAccountCreditAction(undefined, fd)) as { error?: string };
    expect(res.error).toBeTruthy();
    const still = await rawDb.customerProfile.findUnique({ where: { id: customerB.id } });
    expect(still?.accountCreditBalanceCents).toBe(1000);
  });

  it("cannot award or remove another tenant's client's loyalty points", async () => {
    asStaffA();
    const fd = new FormData();
    fd.set("customerProfileId", customerB.id);
    fd.set("points", "500");
    fd.set("reason", "test");
    await expect(manualLoyaltyAdjustmentAction(undefined, fd)).rejects.toThrow(/not found/i);
    const still = await rawDb.customerProfile.findUnique({ where: { id: customerB.id } });
    expect(still?.loyaltyPointsBalance).toBe(100);
  });

  it("cannot tag another tenant's client", async () => {
    asStaffA();
    const tag = await rawDb.customerTag.create({ data: { tenantId: tenantA.id, name: "VIP" } });
    await expect(toggleCustomerTagAction(customerB.id, tag.id, true)).rejects.toThrow();
    const assigned = await rawDb.customerProfileTag.findFirst({ where: { customerProfileId: customerB.id, tagId: tag.id } });
    expect(assigned).toBeNull();
  });

  it("cannot see or refund another tenant's order", async () => {
    asStaffA();
    const res = await refundableForOrderAction(tenantA.id, orderB.id);
    // Either shape is a correct refusal: an ActionError, or an ok result
    // whose order is null (not found) — never the real order.
    expect("error" in res || res.order === null).toBe(true);
    const still = await rawDb.order.findUnique({ where: { id: orderB.id } });
    expect(still?.status).toBe("PAID");
  });

  it("cannot void another tenant's redeemable item", async () => {
    asStaffA();
    const res = await voidClientItemAction(tenantA.id, itemB.id, { reason: "test" });
    expect("error" in res).toBe(true);
    const still = await rawDb.redeemableItem.findUnique({ where: { id: itemB.id } });
    expect(still?.status).toBe("AVAILABLE");
  });

  it("cannot see or spend a session from another tenant's client's package", async () => {
    asStaffA();
    const list = await clientPackagesAction(tenantA.id, customerB.id);
    expect("error" in list ? true : list.packages.length === 0).toBe(true);

    const res = await spendPackageSessionAction(tenantA.id, { customerPackageId: customerPackageB.id, serviceId: serviceB.id });
    expect("error" in res).toBe(true);
    const still = await rawDb.customerPackage.findUnique({ where: { id: customerPackageB.id } });
    expect(still?.remainingUses).toBe(5);
  });

  it("cannot cancel another tenant's client's membership", async () => {
    asStaffA();
    const res = (await cancelClientMembershipAction(tenantA.id, membershipB.id, { reason: "test", when: "now" })) as { error?: string };
    expect(res.error).toBeTruthy();
    const still = await rawDb.customerMembership.findUnique({ where: { id: membershipB.id } });
    expect(still?.status).toBe("ACTIVE");
  });

  it("cannot cancel another tenant's marketing campaign", async () => {
    asStaffA();
    const res = (await cancelCampaignAction(tenantA.id, campaignB.id)) as { error?: string };
    expect(res.error).toBeTruthy();
    const still = await rawDb.notificationCampaign.findUnique({ where: { id: campaignB.id } });
    expect(still?.status).toBe("SCHEDULED");
  });

  it("cannot reach another tenant's settings — resending another clinic's staff invite", async () => {
    asStaffA();
    const res = await resendInviteAction(tenantA.id, staffProfileB.id);
    expect("error" in res).toBe(true);
  });
});
