/**
 * How many of one thing a cart line may hold.
 *
 * Pure, with no imports, because this is a rule about money and rules about
 * money get tests.
 *
 * It exists because a server action's arguments are whatever the browser
 * sent. `qty: number` in a function signature is a note to the next developer,
 * not a check: the client app's "add to cart" took its quantity on trust, and
 * a line of minus one — one request, no tooling needed — subtracted its price
 * from the rest of the basket. Two treatments went out for nothing, recorded
 * as a completed sale (docs/security/review-2026-11.md, P-1).
 */

/** More than anyone buys in one go, and small enough that price × quantity stays far inside an integer. */
export const MAX_CART_QUANTITY = 99;

/**
 * A quantity that can be added to a cart: a whole number from 1 to the
 * maximum. Anything else — negative, zero, a fraction, a string, NaN,
 * Infinity, an object — is null, and the caller refuses.
 *
 * Deliberately no coercion. "2" is not 2 here: the app sends numbers, so a
 * string is somebody else sending something else.
 */
export function addableQuantity(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > MAX_CART_QUANTITY) return null;
  return value;
}

/**
 * What a cart line may be set to: the same, plus zero, which means "take it
 * out". The stepper in the cart counts down to zero; nothing counts below it.
 */
export function settableQuantity(value: unknown): number | null {
  if (value === 0) return 0;
  return addableQuantity(value);
}

/**
 * Whether a stored line is one the till may charge for.
 *
 * Checked again at checkout, on what is in the database rather than on what
 * was asked for: a basket written before the checks above existed, or by any
 * path that forgets them, must not reach a total. The price is checked too —
 * a negative price does the same damage as a negative quantity.
 */
export function chargeableLine(line: { quantity: number; unitPriceCents: number }): boolean {
  return addableQuantity(line.quantity) !== null && Number.isInteger(line.unitPriceCents) && line.unitPriceCents >= 0;
}
