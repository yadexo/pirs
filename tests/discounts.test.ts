import { describe, it, expect } from "vitest";
import { bestDiscount, discountFor, discountedUnitPrice, lineQualifies, subtotalOf, type BasketLine, type DiscountCandidate } from "@/lib/discounts";

/**
 * What a client is charged. These are the sums the browser is not trusted to
 * do: every case here is one a devtools-edited page could otherwise claim.
 */

const product = (id: string, priceCents: number, categoryId: string | null = "cat-skin", quantity = 1): BasketLine => ({
  kind: "PRODUCT",
  id,
  categoryId,
  unitPriceCents: priceCents,
  quantity,
});
const service = (id: string, priceCents: number, categoryId: string | null = "cat-face", quantity = 1): BasketLine => ({
  kind: "SERVICE",
  id,
  categoryId,
  unitPriceCents: priceCents,
  quantity,
});

const promo = (over: Partial<DiscountCandidate> = {}): DiscountCandidate => ({
  id: "promo-1",
  title: "Winter sale",
  discountType: "PERCENT",
  discountValue: 20,
  minOrderCents: null,
  perCustomerLimit: null,
  usageLimit: null,
  eligibility: [],
  ...over,
});

describe("what a discount is worth", () => {
  it("takes a percentage off the whole shop when nothing is listed", () => {
    const lines = [product("p1", 10_000), service("s1", 5_000)];
    expect(discountFor(lines, promo())).toMatchObject({ discountCents: 3_000, promotionId: "promo-1" });
  });

  it("takes a fixed amount off, in cents", () => {
    const lines = [product("p1", 10_000)];
    expect(discountFor(lines, promo({ discountType: "FIXED_AMOUNT", discountValue: 2_500 }))).toMatchObject({ discountCents: 2_500 });
  });

  it("counts quantity", () => {
    const lines = [product("p1", 10_000, "cat-skin", 3)];
    expect(subtotalOf(lines)).toBe(30_000);
    expect(discountFor(lines, promo({ discountValue: 10 }))).toMatchObject({ discountCents: 3_000 });
  });

  it("never gives back more than the qualifying lines are worth", () => {
    // €30 off a €20 product, with €100 of other things in the basket: the
    // discount is capped at the product, not at the basket.
    const lines = [product("p1", 2_000), product("p2", 10_000, "cat-other")];
    const candidate = promo({ discountType: "FIXED_AMOUNT", discountValue: 3_000, eligibility: [{ productId: "p1", serviceId: null, productCategoryId: null, serviceCategoryId: null }] });
    expect(discountFor(lines, candidate)).toMatchObject({ discountCents: 2_000 });
  });

  it("applies to one named product only", () => {
    const lines = [product("p1", 10_000), product("p2", 10_000)];
    const candidate = promo({ eligibility: [{ productId: "p1", serviceId: null, productCategoryId: null, serviceCategoryId: null }] });
    expect(discountFor(lines, candidate)).toMatchObject({ discountCents: 2_000, lineIds: ["p1"] });
  });

  it("applies to a whole category without listing its products", () => {
    const lines = [product("p1", 10_000, "cat-skin"), product("p2", 10_000, "cat-hair")];
    const candidate = promo({ eligibility: [{ productId: null, serviceId: null, productCategoryId: "cat-skin", serviceCategoryId: null }] });
    expect(discountFor(lines, candidate)).toMatchObject({ discountCents: 2_000, lineIds: ["p1"] });
  });

  it("keeps treatments and products apart", () => {
    const lines = [service("s1", 10_000, "cat-face")];
    const productOnly = promo({ eligibility: [{ productId: null, serviceId: null, productCategoryId: "cat-face", serviceCategoryId: null }] });
    const treatmentOnly = promo({ eligibility: [{ productId: null, serviceId: null, productCategoryId: null, serviceCategoryId: "cat-face" }] });

    expect(lineQualifies(lines[0]!, productOnly)).toBe(false);
    expect(discountFor(lines, productOnly)).toBeNull();
    expect(discountFor(lines, treatmentOnly)).toMatchObject({ discountCents: 2_000 });
  });

  it("refuses a basket under the minimum", () => {
    const candidate = promo({ minOrderCents: 5_000 });
    expect(discountFor([product("p1", 4_999)], candidate)).toBeNull();
    expect(discountFor([product("p1", 5_000)], candidate)).toMatchObject({ discountCents: 1_000 });
  });

  it("judges the minimum on the whole basket, not the qualifying part", () => {
    // A €50 minimum, met by the basket as a whole, with only p1 discounted.
    const lines = [product("p1", 2_000), product("p2", 4_000, "cat-other")];
    const candidate = promo({
      minOrderCents: 5_000,
      eligibility: [{ productId: "p1", serviceId: null, productCategoryId: null, serviceCategoryId: null }],
    });
    expect(discountFor(lines, candidate)).toMatchObject({ discountCents: 400 });
  });

  it("gives nothing when nothing in the basket qualifies", () => {
    const candidate = promo({ eligibility: [{ productId: "not-here", serviceId: null, productCategoryId: null, serviceCategoryId: null }] });
    expect(discountFor([product("p1", 10_000)], candidate)).toBeNull();
  });

  it("rounds a percentage to whole cents", () => {
    expect(discountFor([product("p1", 999)], promo({ discountValue: 33 }))).toMatchObject({ discountCents: 330 });
  });
});

describe("choosing between discounts", () => {
  it("gives the client the better one", () => {
    const lines = [product("p1", 10_000)];
    const small = promo({ id: "small", discountValue: 10 });
    const big = promo({ id: "big", discountValue: 25 });
    expect(bestDiscount(lines, [small, big])).toMatchObject({ promotionId: "big", discountCents: 2_500 });
    expect(bestDiscount(lines, [big, small])).toMatchObject({ promotionId: "big" });
  });

  it("returns nothing when none of them apply", () => {
    const lines = [product("p1", 1_000)];
    expect(bestDiscount(lines, [promo({ minOrderCents: 50_000 })])).toBeNull();
    expect(bestDiscount(lines, [])).toBeNull();
  });
});

describe("the price shown in the shop", () => {
  it("strikes through a qualifying product", () => {
    const line = product("p1", 10_000);
    expect(discountedUnitPrice(line, [promo({ discountValue: 20 })])).toEqual({ priceCents: 8_000, promotionTitle: "Winter sale" });
  });

  it("leaves a product no promotion covers alone", () => {
    const line = product("p1", 10_000, "cat-hair");
    const candidate = promo({ eligibility: [{ productId: null, serviceId: null, productCategoryId: "cat-skin", serviceCategoryId: null }] });
    expect(discountedUnitPrice(line, [candidate])).toEqual({ priceCents: 10_000, promotionTitle: null });
  });

  it("doesn't advertise a discount that needs a bigger basket", () => {
    // It still applies at checkout once the basket is large enough; it just
    // isn't promised on a single product's price.
    const line = product("p1", 2_000);
    expect(discountedUnitPrice(line, [promo({ minOrderCents: 10_000 })])).toEqual({ priceCents: 2_000, promotionTitle: null });
  });
});
