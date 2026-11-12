/**
 * The cart, against a browser that does not send what the app would.
 *
 * This is the attack from docs/security/review-2026-11.md (P-1), kept as a
 * test: a line of minus one cancelled the price of the rest of the basket and
 * the order completed, free, with both items issued. Every case here calls
 * the action the way a hand-made request does — with arguments TypeScript
 * would never let the app pass.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { MAX_CART_QUANTITY } from "@/lib/cart-quantity";

const clientAuthMock = vi.hoisted(() => ({ clientAuth: vi.fn(), clientSignIn: vi.fn(), clientSignOut: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/client-auth", () => clientAuthMock);

const clientApp = await import("@/lib/actions/client-app");

describe("a cart that is sent quantities the app would never send", () => {
  const stamp = Date.now();
  const slug = `cartq-${stamp}`;
  let clinic: string;
  let clientUserId: string;
  let clientProfileId: string;
  let cheapId: string;
  let dearId: string;
  let productId: string;
  let packageId: string;

  /** The same call the app makes, with the type checker told to look away. */
  const add = (kind: unknown, id: unknown, qty: unknown) => clientApp.clientAddToCartAction(slug, kind as never, id as never, qty as never);
  const setQty = (itemId: unknown, qty: unknown) => clientApp.clientSetCartQtyAction(slug, itemId as never, qty as never);
  const lines = () => rawDb.basketItem.findMany({ where: { basket: { customerProfileId: clientProfileId, status: "OPEN" } }, orderBy: { id: "asc" } });
  const orders = () => rawDb.order.count({ where: { customerProfileId: clientProfileId } });
  const emptyCart = async () => {
    await rawDb.basketItem.deleteMany({ where: { basket: { customerProfileId: clientProfileId } } });
    await rawDb.basket.deleteMany({ where: { customerProfileId: clientProfileId } });
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    clinic = (await rawDb.tenant.create({ data: { slug, name: "Cart Clinic" } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: clinic, businessName: "Cart Clinic", currency: "EUR" } });
    await rawDb.tenantSettings.create({ data: { tenantId: clinic, vatRateBasisPoints: 2100 } });

    const user = await rawDb.user.create({ data: { tenantId: clinic, email: `cq-${stamp}@example.com`, passwordHash: "x", role: "CUSTOMER" } });
    clientUserId = user.id;
    clientProfileId = (await rawDb.customerProfile.create({ data: { tenantId: clinic, userId: user.id, firstName: "Cara", lastName: "Client" } })).id;

    const treatments = await rawDb.serviceCategory.create({ data: { tenantId: clinic, name: "Treatments" } });
    cheapId = (await rawDb.service.create({ data: { tenantId: clinic, categoryId: treatments.id, name: "Wanted", priceCents: 15_000, durationMinutes: 30 } })).id;
    dearId = (await rawDb.service.create({ data: { tenantId: clinic, categoryId: treatments.id, name: "Offset", priceCents: 16_000, durationMinutes: 30 } })).id;
    const goods = await rawDb.productCategory.create({ data: { tenantId: clinic, name: "Goods" } });
    productId = (await rawDb.product.create({ data: { tenantId: clinic, categoryId: goods.id, name: "Serum", priceCents: 4_000, sku: `CQ-${stamp}`, inventoryQuantity: 500 } })).id;
    packageId = (await rawDb.package.create({ data: { tenantId: clinic, name: "Course", priceCents: 50_000, totalUses: 5 } as never })).id;
  });

  afterAll(async () => {
    await deleteTenantCompletely(clinic);
  });

  beforeEach(async () => {
    clientAuthMock.clientAuth.mockResolvedValue({
      user: { id: clientUserId, email: `cq-${stamp}@example.com`, name: "C", role: "CUSTOMER", tenantId: clinic, tenantSlug: slug, staffProfileId: null, customerProfileId: clientProfileId, permissions: [] },
    });
    await emptyCart();
  });

  it("the attack itself: a line of minus one no longer makes the order free", async () => {
    expect(await add("service", cheapId, 1)).toEqual({ ok: true });
    const offset = await add("service", dearId, -1);
    expect(offset).toHaveProperty("error");

    // The wanted treatment is still in the cart, at its real price, alone.
    const cart = await lines();
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ serviceId: cheapId, quantity: 1, unitPriceCents: 15_000 });
  });

  it("refuses every quantity that is not a whole number from one to the maximum, for every kind of item", async () => {
    const bad = [-1, 0, -1000, 0.5, 1.5, MAX_CART_QUANTITY + 1, Number.MAX_SAFE_INTEGER, NaN, Infinity, "1", "-1", null, undefined, {}, [1]];
    for (const [kind, id] of [
      ["service", cheapId],
      ["product", productId],
      ["package", packageId],
    ] as const) {
      for (const qty of bad) {
        expect(await add(kind, id, qty), `${kind} × ${String(qty)}`).toHaveProperty("error");
      }
    }
    expect(await lines()).toHaveLength(0);
  });

  it("refuses a kind or an id that is not what the app sends", async () => {
    expect(await add("membership", cheapId, 1)).toHaveProperty("error");
    expect(await add("service", { id: cheapId }, 1)).toHaveProperty("error");
    expect(await add("service", "", 1)).toHaveProperty("error");
    expect(await lines()).toHaveLength(0);
  });

  it("will not let adding again push a line past the maximum", async () => {
    expect(await add("product", productId, MAX_CART_QUANTITY)).toEqual({ ok: true });
    expect(await add("product", productId, 1)).toHaveProperty("error");
    expect((await lines())[0]!.quantity).toBe(MAX_CART_QUANTITY);
  });

  it("setting a line: zero removes it, and nothing goes below zero or above the maximum", async () => {
    await add("product", productId, 2);
    const [line] = await lines();

    for (const qty of [-1, -5, 0.5, MAX_CART_QUANTITY + 1, "3", null, NaN]) {
      expect(await setQty(line!.id, qty), String(qty)).toHaveProperty("error");
    }
    expect((await lines())[0]!.quantity).toBe(2);

    expect(await setQty(line!.id, 5)).toEqual({ ok: true });
    expect((await lines())[0]!.quantity).toBe(5);

    expect(await setQty(line!.id, 0)).toEqual({ ok: true });
    expect(await lines()).toHaveLength(0);
  });

  it("the till refuses a basket that already holds a bad line, however it got there", async () => {
    // A row written before these checks existed, or by a path that forgets
    // them. The database refuses a new one (see the migration), so this is
    // put in the only way left: with the constraint switched off for a moment.
    await add("service", cheapId, 1);
    const basket = await rawDb.basket.findFirstOrThrow({ where: { customerProfileId: clientProfileId, status: "OPEN" } });
    await rawDb.$executeRawUnsafe(`ALTER TABLE "BasketItem" DISABLE TRIGGER ALL`).catch(() => undefined);
    await rawDb.$executeRawUnsafe(`ALTER TABLE "BasketItem" DROP CONSTRAINT IF EXISTS "BasketItem_quantity_positive"`);
    try {
      await rawDb.basketItem.create({ data: { basketId: basket.id, itemType: "SERVICE", serviceId: dearId, quantity: -1, unitPriceCents: 16_000 } });
      const before = await orders();
      const result = await clientApp.clientCheckoutAction(slug, null, {});
      expect(result).toHaveProperty("error");
      // Refused before anything was written: no order, nothing issued.
      expect(await orders()).toBe(before);
      expect(await rawDb.redeemableItem.count({ where: { customerProfileId: clientProfileId } })).toBe(0);
    } finally {
      await rawDb.basketItem.deleteMany({ where: { basketId: basket.id, quantity: { lt: 1 } } });
      await rawDb.$executeRawUnsafe(`ALTER TABLE "BasketItem" ADD CONSTRAINT "BasketItem_quantity_positive" CHECK ("quantity" > 0)`);
      await rawDb.$executeRawUnsafe(`ALTER TABLE "BasketItem" ENABLE TRIGGER ALL`).catch(() => undefined);
    }
  });

  it("the database itself refuses a line of zero or less", async () => {
    await add("service", cheapId, 1);
    const basket = await rawDb.basket.findFirstOrThrow({ where: { customerProfileId: clientProfileId, status: "OPEN" } });
    await expect(
      rawDb.basketItem.create({ data: { basketId: basket.id, itemType: "SERVICE", serviceId: dearId, quantity: -1, unitPriceCents: 16_000 } }),
    ).rejects.toThrow();
    await expect(
      rawDb.basketItem.create({ data: { basketId: basket.id, itemType: "SERVICE", serviceId: dearId, quantity: 0, unitPriceCents: 16_000 } }),
    ).rejects.toThrow();
  });

  it("an ordinary order still goes through", async () => {
    // Mock payments (no Stripe key in this file): the order completes, at the
    // real total, with exactly what was bought.
    delete process.env.STRIPE_SECRET_KEY;
    expect(await add("service", cheapId, 2)).toEqual({ ok: true });
    const result = await clientApp.clientCheckoutAction(slug, null, {});
    expect(result).toMatchObject({ ok: true, paid: true });
    const order = await rawDb.order.findFirstOrThrow({ where: { customerProfileId: clientProfileId }, orderBy: { placedAt: "desc" }, include: { items: true } });
    expect(order.subtotalCents).toBe(30_000);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ quantity: 2, totalCents: 30_000 });
  });
});
