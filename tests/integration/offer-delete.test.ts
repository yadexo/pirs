import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

const { archiveItemAction, getAppBuilderItemAction } = await import("@/lib/actions/app-builder");

/**
 * Deleting an offer in App Builder.
 *
 * An offer nobody has touched is deleted. One that has been used is kept and
 * deactivated instead, because an order's discount, a redemption count and a
 * campaign's subject all point at it — with nullable columns, so the database
 * would let it go and leave an order showing a discount from nothing.
 *
 * The clinic sees "Hidden" either way, which looks like a bug unless the app
 * says why, so what comes back from here is what it says.
 */
describe("removing an offer", () => {
  const stamp = Date.now();
  let clinic: string;
  let staffUserId: string;
  let staffProfileId: string;
  let customerProfileId: string;

  const asOwner = () =>
    authMock.auth.mockResolvedValue({
      user: {
        id: staffUserId,
        email: `s-${stamp}@x.com`,
        name: "S",
        role: "TENANT_ADMIN",
        tenantId: clinic,
        tenantSlug: null,
        staffProfileId,
        customerProfileId: null,
        permissions: "ALL",
      },
    });

  async function offer(title: string) {
    return rawDb.promotion.create({
      data: {
        tenantId: clinic,
        title,
        discountType: "PERCENT",
        discountValue: 10,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
      },
    });
  }

  async function orderUsing(promotionId: string, status: "PENDING" | "PAID" = "PAID") {
    return rawDb.order.create({
      data: {
        tenantId: clinic,
        customerProfileId,
        orderNumber: `ORD-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
        status,
        subtotalCents: 5_000,
        discountCents: 500,
        totalCents: 4_500,
        currency: "EUR",
        promotionId,
      } as never,
    });
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `offer-${stamp}`, name: "Offer Clinic" } })).id;

    const su = await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffUserId = su.id;
    staffProfileId = (await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: su.id, firstName: "Sam", lastName: "Staff" } })).id;

    const cu = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    customerProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: cu.id, firstName: "Cara", lastName: "Client" } })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    asOwner();
  });

  it("deletes an offer nobody has used", async () => {
    const promo = await offer(`Unused ${stamp}`);

    expect(await archiveItemAction(clinic, "promotion", promo.id)).toMatchObject({ ok: true, hidden: false });
    expect(await rawDb.promotion.findUnique({ where: { id: promo.id } })).toBeNull();
  });

  it("hides an offer that an order used, and says how many", async () => {
    const promo = await offer(`Ordered ${stamp}`);
    await orderUsing(promo.id);
    await orderUsing(promo.id);

    const res = await archiveItemAction(clinic, "promotion", promo.id);
    expect(res).toMatchObject({ ok: true, hidden: true, usage: { orders: 2 } });

    const after = await rawDb.promotion.findUniqueOrThrow({ where: { id: promo.id } });
    expect(after.active).toBe(false);
  });

  it("keeps the order pointing at the offer that discounted it", async () => {
    const promo = await offer(`History ${stamp}`);
    const order = await orderUsing(promo.id);

    await archiveItemAction(clinic, "promotion", promo.id);

    // The whole reason for hiding instead of deleting: the column is
    // nullable, so a delete would quietly leave this order's discount
    // belonging to nothing.
    expect(await rawDb.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ promotionId: promo.id, discountCents: 500 });
  });

  it("hides an offer that is only on an unpaid order", async () => {
    // No redemption row exists yet — that is written when the order is paid —
    // so counting redemptions alone would have deleted this one.
    const promo = await offer(`Pending ${stamp}`);
    await orderUsing(promo.id, "PENDING");

    expect(await archiveItemAction(clinic, "promotion", promo.id)).toMatchObject({ hidden: true, usage: { orders: 1, redemptions: 0 } });
  });

  it("hides an offer a redemption counted, even with no order left", async () => {
    const promo = await offer(`Redeemed ${stamp}`);
    await rawDb.promotionRedemption.create({ data: { tenantId: clinic, promotionId: promo.id, customerProfileId, discountAppliedCents: 500 } });

    expect(await archiveItemAction(clinic, "promotion", promo.id)).toMatchObject({ hidden: true, usage: { orders: 0, redemptions: 1 } });
  });

  it("hides an offer a campaign announced", async () => {
    const promo = await offer(`Announced ${stamp}`);
    await rawDb.notificationCampaign.create({
      data: {
        tenantId: clinic,
        name: `Spring ${stamp}`,
        channel: "PUSH",
        status: "SENT",
        subject: "20% off",
        body: "This week only",
        promotionId: promo.id,
      } as never,
    });

    const res = await archiveItemAction(clinic, "promotion", promo.id);
    expect(res).toMatchObject({ hidden: true, usage: { campaigns: 1 } });
    // And the notification still says what it was announcing.
    expect(await rawDb.notificationCampaign.findFirstOrThrow({ where: { tenantId: clinic, promotionId: promo.id } })).toBeTruthy();
  });

  it("tells the editor what will happen before the button is pressed", async () => {
    const promo = await offer(`Counted ${stamp}`);
    await orderUsing(promo.id);

    const loaded = await getAppBuilderItemAction(clinic, "promotion", promo.id);
    expect(loaded).toMatchObject({ ok: true });
    // The drawer reads these counts to warn in advance rather than explaining
    // itself afterwards.
    expect("item" in loaded && (loaded.item as { _count: unknown })._count).toMatchObject({ orders: 1, redemptions: 0, campaigns: 0 });
  });

  it("refuses an offer belonging to another clinic", async () => {
    const other = await rawDb.tenant.create({ data: { slug: `offer-other-${stamp}`, name: "Other Clinic" } });
    try {
      const promo = await offer(`Mine ${stamp}`);
      const res = await archiveItemAction(other.id, "promotion", promo.id);
      expect(res).toMatchObject({ error: expect.any(String) });
      expect(await rawDb.promotion.findUnique({ where: { id: promo.id } })).not.toBeNull();
    } finally {
      await deleteTenantCompletely(other.id);
    }
  });
});
