import { describe, it, expect } from "vitest";
import { addableQuantity, chargeableLine, MAX_CART_QUANTITY, settableQuantity } from "@/lib/cart-quantity";

describe("what can be added to a cart", () => {
  it("is a whole number from one to the maximum", () => {
    expect(addableQuantity(1)).toBe(1);
    expect(addableQuantity(7)).toBe(7);
    expect(addableQuantity(MAX_CART_QUANTITY)).toBe(MAX_CART_QUANTITY);
  });

  it("is never negative — the line that made an order free", () => {
    expect(addableQuantity(-1)).toBeNull();
    expect(addableQuantity(-1000)).toBeNull();
  });

  it("is never zero, a fraction, or more than the maximum", () => {
    expect(addableQuantity(0)).toBeNull();
    expect(addableQuantity(0.5)).toBeNull();
    expect(addableQuantity(1.0000001)).toBeNull();
    expect(addableQuantity(MAX_CART_QUANTITY + 1)).toBeNull();
    expect(addableQuantity(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("is never something that is not a number, however number-like", () => {
    // A server action receives whatever was posted. None of these is coerced.
    for (const value of ["1", "-1", null, undefined, NaN, Infinity, -Infinity, true, [1], { valueOf: () => 1 }, 1n]) {
      expect(addableQuantity(value), String(value)).toBeNull();
    }
  });
});

describe("what a cart line can be set to", () => {
  it("is the same, plus zero for taking it out", () => {
    expect(settableQuantity(0)).toBe(0);
    expect(settableQuantity(3)).toBe(3);
  });

  it("is never below zero — removing is zero, not minus one", () => {
    expect(settableQuantity(-1)).toBeNull();
    expect(settableQuantity(-0.5)).toBeNull();
    expect(settableQuantity("0")).toBeNull();
    expect(settableQuantity(MAX_CART_QUANTITY + 1)).toBeNull();
  });
});

describe("what the till will charge for", () => {
  it("is a line with a real quantity and a price that is not negative", () => {
    expect(chargeableLine({ quantity: 1, unitPriceCents: 15000 })).toBe(true);
    // Free items exist: a gift line at zero is still a line.
    expect(chargeableLine({ quantity: 2, unitPriceCents: 0 })).toBe(true);
  });

  it("is not a line that would take money off the rest", () => {
    expect(chargeableLine({ quantity: -1, unitPriceCents: 16000 })).toBe(false);
    expect(chargeableLine({ quantity: 1, unitPriceCents: -16000 })).toBe(false);
    expect(chargeableLine({ quantity: 0, unitPriceCents: 16000 })).toBe(false);
    expect(chargeableLine({ quantity: 1, unitPriceCents: 99.5 })).toBe(false);
  });
});
