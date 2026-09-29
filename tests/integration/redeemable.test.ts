import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => authMock);
vi.mock("@/client-auth", () => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));

const { createItemsForOrder, redeemItem, voidItemsForOrder, findItem, generateBackupCode, tokenFromScan, redeemQrValue } =
  await import("@/lib/redeemable");
const { redeemItemAction, lookupRedeemableAction } = await import("@/lib/actions/redeem");

/**
 * The rules that matter here are the ones money depends on: an item exists
 * once however many times the webhook fires, a refund stops an unused one, and
 * a code can only ever be spent once.
 */
describe("redeemable items", () => {
  const stamp = Date.now();
  let clinic: string;
  let otherClinic: string;
  let clientProfileId: string;
  let staffUserId: string;
  let productId: string;
  let serviceId: string;

  const asStaff = () =>
    authMock.auth.mockResolvedValue({
      user: {
        id: staffUserId,
        email: `s-${stamp}@x.com`,
        name: "S",
        role: "TENANT_ADMIN",
        tenantId: clinic,
        tenantSlug: `red-${stamp}`,
        staffProfileId: null,
        customerProfileId: null,
        permissions: "ALL",
      },
    });

  /** A paid order with one line, quantity as given. */
  async function makeOrder(opts: { quantity?: number; membership?: boolean; tenantId?: string; customerProfileId?: string } = {}) {
    const tenantId = opts.tenantId ?? clinic;
    const profile = opts.customerProfileId ?? clientProfileId;
    const order = await rawDb.order.create({
      data: {
        tenantId,
        customerProfileId: profile,
        orderNumber: `ORD-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
        status: "PAID",
        subtotalCents: 10_000,
        totalCents: 10_000,
        currency: "EUR",
        items: {
          create: opts.membership
            ? [{ itemType: "MEMBERSHIP", name: "Gold plan", quantity: 1, unitPriceCents: 10_000, totalCents: 10_000 }]
            : [{ itemType: "PRODUCT", productId, name: "Serum", quantity: opts.quantity ?? 1, unitPriceCents: 10_000, totalCents: 10_000 }],
        },
      },
      select: { id: true },
    });
    return order.id;
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `red-${stamp}`, name: "Redeem Clinic" } })).id;
    otherClinic = (await rawDb.tenant.create({ data: { slug: `red-other-${stamp}`, name: "Other Clinic" } })).id;

    const cu = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: cu.id, firstName: "Cara", lastName: "Client" } })).id;

    const su = await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffUserId = su.id;
    await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: su.id, firstName: "Sam", lastName: "Staff" } });

    const category = await rawDb.productCategory.create({ data: { tenantId: clinic, name: "Skincare" } });
    productId = (await rawDb.product.create({ data: { tenantId: clinic, categoryId: category.id, name: "Serum", priceCents: 10_000, sku: `SER-${stamp}`, inventoryQuantity: 9 } })).id;
    const sc = await rawDb.serviceCategory.create({ data: { tenantId: clinic, name: "Treatments" } });
    serviceId = (await rawDb.service.create({ data: { tenantId: clinic, categoryId: sc.id, name: "Facial", priceCents: 20_000, durationMinutes: 30 } })).id;
    void serviceId;
  });

  afterAll(async () => {
    for (const id of [clinic, otherClinic]) await deleteTenantCompletely(id);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    asStaff();
  });

  it("creates one item per unit bought", async () => {
    const orderId = await makeOrder({ quantity: 3 });
    const result = await createItemsForOrder(orderId);

    expect(result.created).toBe(3);
    const items = await rawDb.redeemableItem.findMany({ where: { orderId } });
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.unitIndex))).toEqual(new Set([0, 1, 2]));
    expect(new Set(items.map((i) => i.token)).size).toBe(3);
    expect(new Set(items.map((i) => i.code)).size).toBe(3);
    expect(items.every((i) => i.status === "AVAILABLE")).toBe(true);
  });

  it("creates nothing the second time the same webhook arrives", async () => {
    const orderId = await makeOrder({ quantity: 2 });
    const first = await createItemsForOrder(orderId);
    const second = await createItemsForOrder(orderId);

    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(await rawDb.redeemableItem.count({ where: { orderId } })).toBe(2);
  });

  it("makes no item for a membership — there is nothing to hand over", async () => {
    const orderId = await makeOrder({ membership: true });
    expect((await createItemsForOrder(orderId)).created).toBe(0);
    expect(await rawDb.redeemableItem.count({ where: { orderId } })).toBe(0);
  });

  it("voids unused items when the order is refunded, and flags used ones", async () => {
    const orderId = await makeOrder({ quantity: 2 });
    await createItemsForOrder(orderId);
    const [first] = await rawDb.redeemableItem.findMany({ where: { orderId }, orderBy: { unitIndex: "asc" } });

    await redeemItem({ tenantId: clinic, lookup: { id: first!.id }, staffUserId, method: "QR" });
    const result = await voidItemsForOrder(orderId);

    expect(result).toEqual({ voided: 1, alreadyRedeemed: 1 });
    const after = await rawDb.redeemableItem.findMany({ where: { orderId }, orderBy: { unitIndex: "asc" } });
    expect(after[0]).toMatchObject({ status: "REDEEMED", refundedAfterUse: true });
    expect(after[1]).toMatchObject({ status: "VOIDED", refundedAfterUse: false });
  });

  it("redeems an item exactly once, even when two staff scan it together", async () => {
    const orderId = await makeOrder();
    await createItemsForOrder(orderId);
    const item = await rawDb.redeemableItem.findFirstOrThrow({ where: { orderId } });

    const both = await Promise.all([
      redeemItem({ tenantId: clinic, lookup: { token: item.token }, staffUserId, method: "QR" }),
      redeemItem({ tenantId: clinic, lookup: { token: item.token }, staffUserId, method: "QR" }),
    ]);

    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.filter((r) => !r.ok)).toHaveLength(1);
    expect(both.find((r) => !r.ok)).toMatchObject({ reason: "already-redeemed" });

    const saved = await rawDb.redeemableItem.findFirstOrThrow({ where: { id: item.id } });
    expect(saved.status).toBe("REDEEMED");
    expect(saved.redeemedById).toBe(staffUserId);
    expect(saved.redeemedAt).not.toBeNull();
  });

  it("refuses a voided item and an expired one, saying which", async () => {
    const orderId = await makeOrder({ quantity: 2 });
    await createItemsForOrder(orderId);
    const items = await rawDb.redeemableItem.findMany({ where: { orderId }, orderBy: { unitIndex: "asc" } });

    await rawDb.redeemableItem.update({ where: { id: items[0]!.id }, data: { status: "VOIDED" } });
    await rawDb.redeemableItem.update({ where: { id: items[1]!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await redeemItem({ tenantId: clinic, lookup: { id: items[0]!.id }, staffUserId, method: "QR" })).toMatchObject({ reason: "voided" });
    expect(await redeemItem({ tenantId: clinic, lookup: { id: items[1]!.id }, staffUserId, method: "QR" })).toMatchObject({ reason: "expired" });
  });

  it("hides another clinic's item completely", async () => {
    const orderId = await makeOrder();
    await createItemsForOrder(orderId);
    const item = await rawDb.redeemableItem.findFirstOrThrow({ where: { orderId } });

    expect(await findItem(otherClinic, { token: item.token })).toBeNull();
    expect(await redeemItem({ tenantId: otherClinic, lookup: { token: item.token }, staffUserId, method: "QR" })).toMatchObject({
      reason: "not-found",
    });

    // Staff signed in at one clinic are refused at another before the code is
    // even looked at, so the answer says nothing about the item.
    const res = await lookupRedeemableAction(otherClinic, redeemQrValue(item.token));
    expect(res).toMatchObject({ error: expect.any(String) });
    expect("item" in res).toBe(false);
    expect(JSON.stringify(res)).not.toContain(item.token);
    expect(JSON.stringify(res)).not.toContain("Serum");
    expect(await rawDb.redeemableItem.findFirstOrThrow({ where: { id: item.id } })).toMatchObject({ status: "AVAILABLE" });
  });

  it("finds an item by its typed code as well as its scanned one", async () => {
    const orderId = await makeOrder();
    await createItemsForOrder(orderId);
    const item = await rawDb.redeemableItem.findFirstOrThrow({ where: { orderId } });

    const scanned = await lookupRedeemableAction(clinic, redeemQrValue(item.token));
    const typed = await lookupRedeemableAction(clinic, item.code.toLowerCase());

    expect(scanned).toMatchObject({ ok: true, item: { id: item.id } });
    expect(typed).toMatchObject({ ok: true, item: { id: item.id } });
  });

  it("records how an item was handed over, and the staff note with it", async () => {
    const orderId = await makeOrder();
    await createItemsForOrder(orderId);
    const item = await rawDb.redeemableItem.findFirstOrThrow({ where: { orderId } });

    const res = await redeemItemAction(clinic, { itemId: item.id, method: "MANUAL", note: "Phone was dead" });
    expect(res).toMatchObject({ ok: true });

    const saved = await rawDb.redeemableItem.findFirstOrThrow({ where: { id: item.id } });
    expect(saved).toMatchObject({ status: "REDEEMED", redemptionMethod: "MANUAL", redemptionNote: "Phone was dead", redeemedById: staffUserId });
  });

  it("gives back a plain message when the same item is offered twice", async () => {
    const orderId = await makeOrder();
    await createItemsForOrder(orderId);
    const item = await rawDb.redeemableItem.findFirstOrThrow({ where: { orderId } });

    await redeemItemAction(clinic, { itemId: item.id, method: "QR" });
    const second = await redeemItemAction(clinic, { itemId: item.id, method: "QR" });

    expect(second).toMatchObject({ error: expect.stringMatching(/Already redeemed/) });
  });

  it("uses codes a receptionist can read out", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateBackupCode();
      expect(code).toHaveLength(8);
      expect(code).not.toMatch(/[01OIL5S]/);
    }
  });

  it("tells its own QR apart from the check-in one", () => {
    const token = "abcdefghijklmnopqrstuvwx";
    expect(tokenFromScan(redeemQrValue(token))).toBe(token);
    // A check-in code is tenant.client.expiry.signature — not an item.
    expect(tokenFromScan("tenant123.client456.1790000000.c2lnbmF0dXJl")).toBeNull();
    expect(tokenFromScan("https://pirs.io/testclinic")).toBeNull();
    expect(tokenFromScan("")).toBeNull();
  });
});
