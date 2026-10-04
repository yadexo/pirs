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

const { voidClientItemAction, reissueClientItemAction, giftClientItemAction } = await import("@/lib/actions/client-items");
const { redeemItemAction, clientItemsAction } = await import("@/lib/actions/redeem");

/**
 * Items a clinic takes back, replaces or gives away.
 *
 * Each of these changes what a client believes they own, so the tests check
 * the same three things each time: the item ends up in the right state, the
 * decision is recorded with a reason, and the client is told. The code on a
 * replaced item has to actually change, or reissuing a code somebody else is
 * holding achieves nothing.
 */
describe("a client's items", () => {
  const stamp = Date.now();
  let clinic: string;
  let staffUserId: string;
  let staffProfileId: string;
  let clientProfileId: string;
  let clientUserId: string;
  let orderId: string;
  let orderItemId: string;

  const asStaff = () =>
    authMock.auth.mockResolvedValue({
      user: {
        id: staffUserId,
        email: `s-${stamp}@x.com`,
        name: "Sam Staff",
        role: "TENANT_ADMIN",
        tenantId: clinic,
        tenantSlug: null,
        staffProfileId,
        customerProfileId: null,
        permissions: "ALL",
      },
    });

  /** One bought item, as a paid order would have created it. */
  async function boughtItem(name = "Facial") {
    return rawDb.redeemableItem.create({
      data: {
        tenantId: clinic,
        customerProfileId: clientProfileId,
        orderId,
        orderItemId,
        unitIndex: Math.floor(Math.random() * 100000),
        itemType: "SERVICE",
        name,
        token: `tok_${Math.random().toString(36).slice(2)}`,
        code: `CODE${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: "AVAILABLE",
      } as never,
    });
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug: `items-${stamp}`, name: "Items Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Items Clinic", currency: "EUR" } });

    const su = await rawDb.user.create({ data: { tenantId: clinic, email: `s-${stamp}@x.com`, passwordHash: "x", role: "TENANT_ADMIN" } });
    staffUserId = su.id;
    staffProfileId = (await rawDb.staffProfile.create({ data: { tenantId: clinic, userId: su.id, firstName: "Sam", lastName: "Staff" } })).id;

    const cu = await rawDb.user.create({ data: { tenantId: clinic, email: `c-${stamp}@x.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientUserId = cu.id;
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: cu.id, firstName: "Ida", lastName: "Item" } })).id;

    const order = await rawDb.order.create({
      data: {
        tenantId: clinic,
        customerProfileId: clientProfileId,
        orderNumber: `ORD-${stamp}`,
        status: "PAID",
        subtotalCents: 5_000,
        totalCents: 5_000,
        currency: "EUR",
        items: { create: [{ itemType: "SERVICE", name: "Facial", quantity: 1, unitPriceCents: 5_000, totalCents: 5_000, taxCents: 0 }] },
      } as never,
      include: { items: true },
    });
    orderId = order.id;
    orderItemId = order.items[0]!.id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    asStaff();
  });

  it("takes back an unused item, with the reason and the staff member on it", async () => {
    const item = await boughtItem();

    expect(await voidClientItemAction(clinic, item.id, { reason: "Issued by mistake" })).toMatchObject({ ok: true, status: "VOIDED" });

    const after = await rawDb.redeemableItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after).toMatchObject({ status: "VOIDED", voidedReason: "Issued by mistake", voidedByStaffProfileId: staffProfileId });
    expect(after.voidedAt).not.toBeNull();
  });

  it("refuses to take back something already collected", async () => {
    const item = await boughtItem();
    await redeemItemAction(clinic, { itemId: item.id, method: "MANUAL", note: "Handed over" });

    expect(await voidClientItemAction(clinic, item.id, { reason: "Changed my mind" })).toMatchObject({
      error: expect.stringMatching(/already been collected/i),
    });
    expect(await rawDb.redeemableItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "REDEEMED" });
  });

  it("replaces a lost code with a new one, and the old one stops working", async () => {
    const item = await boughtItem();

    const res = await reissueClientItemAction(clinic, item.id, { reason: "Client lost their phone" });
    if ("error" in res) throw new Error(res.error);

    const after = await rawDb.redeemableItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.code).toBe(res.code);
    // The point of reissuing: whoever is holding the old one has nothing.
    expect(after.code).not.toBe(item.code);
    expect(after.token).not.toBe(item.token);
    expect(after).toMatchObject({ status: "AVAILABLE", source: "REISSUE", issuedReason: "Client lost their phone", issuedByStaffProfileId: staffProfileId });
  });

  it("brings a voided item back when it is reissued", async () => {
    const item = await boughtItem();
    await voidClientItemAction(clinic, item.id, { reason: "Mistake" });

    await reissueClientItemAction(clinic, item.id, { reason: "Actually they should have it" });

    const after = await rawDb.redeemableItem.findUniqueOrThrow({ where: { id: item.id } });
    // Available again, and no longer described as taken back.
    expect(after).toMatchObject({ status: "AVAILABLE", voidedReason: null, voidedAt: null, voidedByStaffProfileId: null });
  });

  it("refuses to reissue something already collected", async () => {
    const item = await boughtItem();
    await redeemItemAction(clinic, { itemId: item.id, method: "MANUAL" });

    expect(await reissueClientItemAction(clinic, item.id, { reason: "Again please" })).toMatchObject({ error: expect.any(String) });
  });

  it("gives an item that has no purchase behind it", async () => {
    const res = await giftClientItemAction(clinic, clientProfileId, {
      name: "Complimentary facial",
      itemType: "SERVICE",
      reason: "Cancelled appointment",
    });
    if ("error" in res) throw new Error(res.error);

    const item = await rawDb.redeemableItem.findUniqueOrThrow({ where: { id: res.id } });
    expect(item).toMatchObject({
      source: "GIFT",
      status: "AVAILABLE",
      name: "Complimentary facial",
      issuedReason: "Cancelled appointment",
      issuedByStaffProfileId: staffProfileId,
    });
    // No order, because there was no sale — inventing one would put money
    // that never moved into the client's history and the clinic's figures.
    expect(item.orderId).toBeNull();
    expect(item.orderItemId).toBeNull();
  });

  it("lets a gift be redeemed like anything else", async () => {
    const res = await giftClientItemAction(clinic, clientProfileId, { name: "Gift massage", itemType: "SERVICE", reason: "Goodwill" });
    if ("error" in res) throw new Error(res.error);

    expect(await redeemItemAction(clinic, { itemId: res.id, method: "MANUAL", note: "Given at the desk" })).toMatchObject({ ok: true });
    expect(await rawDb.redeemableItem.findUniqueOrThrow({ where: { id: res.id } })).toMatchObject({ status: "REDEEMED" });
  });

  it("shows gifts in the client's items beside what they bought", async () => {
    await giftClientItemAction(clinic, clientProfileId, { name: "Listed gift", itemType: "PRODUCT", reason: "Goodwill" });

    const res = await clientItemsAction(clinic, clientProfileId);
    if ("error" in res) throw new Error(res.error);
    const gift = res.items.find((i) => i.name === "Listed gift");
    expect(gift).toMatchObject({ source: "GIFT", status: "AVAILABLE" });
  });

  it("insists on a reason for all three", async () => {
    const item = await boughtItem();
    expect(await voidClientItemAction(clinic, item.id, { reason: " " })).toMatchObject({ error: expect.any(String) });
    expect(await reissueClientItemAction(clinic, item.id, { reason: "" })).toMatchObject({ error: expect.any(String) });
    expect(await giftClientItemAction(clinic, clientProfileId, { name: "Thing", itemType: "SERVICE", reason: "" })).toMatchObject({
      error: expect.any(String),
    });
    expect(await rawDb.redeemableItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "AVAILABLE" });
  });

  it("writes each one to the audit log and tells the client", async () => {
    const item = await boughtItem("Audited item");
    await voidClientItemAction(clinic, item.id, { reason: "Wrong client" });

    expect(await rawDb.auditLog.findFirstOrThrow({ where: { tenantId: clinic, action: "item.voided", entityId: item.id } })).toMatchObject({
      actorUserId: staffUserId,
      entityType: "RedeemableItem",
    });

    const [userId, message] = push.notify.mock.calls[0] as [string, { body: string }];
    expect(userId).toBe(clientUserId);
    expect(message.body).toContain("Audited item");
    expect(message.body).toContain("Wrong client");
  });

  it("refuses another clinic's item", async () => {
    const item = await boughtItem();
    const other = await rawDb.tenant.create({ data: { slug: `items-other-${stamp}`, name: "Other Clinic" } });
    try {
      authMock.auth.mockResolvedValue({
        user: {
          id: staffUserId,
          email: `s-${stamp}@x.com`,
          name: "Sam",
          role: "TENANT_ADMIN",
          tenantId: other.id,
          tenantSlug: null,
          staffProfileId: null,
          customerProfileId: null,
          permissions: "ALL",
        },
      });
      expect(await voidClientItemAction(other.id, item.id, { reason: "Not mine" })).toMatchObject({ error: expect.any(String) });
      expect(await rawDb.redeemableItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "AVAILABLE" });
    } finally {
      await deleteTenantCompletely(other.id);
    }
  });
});
