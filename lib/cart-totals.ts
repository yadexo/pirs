import { computeVatCents } from "@/lib/checkout-calculations";

/**
 * What the cart shows: the bill, and what is left to pay after the client's
 * credit.
 *
 * The server works these out again at checkout from the database, and that
 * figure is the one charged — this is the preview. It lives apart from the
 * component because one question it answers has to be right: whether there is
 * anything left to pay. A cart that offers a card for an order already
 * settled, or says "paid with credit" for a free order, is lying to a client
 * about their own money.
 */

export interface CartTotalsInput {
  subtotalCents: number;
  /** A loyalty reward the client picked in the cart. */
  rewardDiscountCents: number;
  /** The promotion or member price the server resolved for this basket. */
  autoDiscountCents: number;
  /** What the client has, not what this order takes. */
  creditAvailableCents: number;
  useCredit: boolean;
  /**
   * The VAT already inside the prices, in basis points. Nothing is added with
   * it; it only lets the cart say how much of the total is VAT.
   */
  vatRateBasisPoints?: number;
}

export interface CartTotals {
  /** The bill before credit: items less every discount. */
  billCents: number;
  /** The VAT already inside the bill — a share of it, never an addition. */
  vatCents: number;
  creditUsedCents: number;
  /** What a card has to cover. */
  totalCents: number;
  /**
   * True only when credit actually settled the whole bill — so a free basket
   * is not described as paid for with credit the client never spent.
   */
  settledByCreditAlone: boolean;
}

export function cartTotals(input: CartTotalsInput): CartTotals {
  // Prices include VAT, so the bill is simply what is being asked for the
  // items, less whatever comes off. Nothing is added at any point — the same
  // order of operations as clientCheckoutAction, which is what charges.
  const billCents = Math.max(0, input.subtotalCents - input.rewardDiscountCents - input.autoDiscountCents);
  const vatCents = computeVatCents(billCents, 0, input.vatRateBasisPoints ?? 0);
  // Credit comes off the bill rather than acting as a discount: the VAT was on
  // what the client bought, however they end up paying for it.
  const creditUsedCents = input.useCredit ? Math.max(0, Math.min(input.creditAvailableCents, billCents)) : 0;
  const totalCents = Math.max(0, billCents - creditUsedCents);
  return {
    billCents,
    vatCents,
    creditUsedCents,
    totalCents,
    settledByCreditAlone: totalCents === 0 && creditUsedCents > 0,
  };
}
