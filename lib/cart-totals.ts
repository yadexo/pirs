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
   * The clinic's tax rate, in basis points. A clinic whose prices already
   * include VAT leaves it at zero; one that adds tax on top has it here, and
   * the preview has to add it too — the cart calls its figure "Total incl.
   * VAT", and that has to be true.
   */
  taxRateBasisPoints?: number;
}

export interface CartTotals {
  /** The bill before credit: items less every discount, plus tax. */
  billCents: number;
  /** Tax on the discounted basket, worked out the way checkout works it out. */
  taxCents: number;
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
  const taxableCents = Math.max(0, input.subtotalCents - input.rewardDiscountCents - input.autoDiscountCents);
  // The same order of operations as clientCheckoutAction: tax on the basket
  // after discounts, and credit off the bill after tax — the tax was on what
  // the client bought, however they end up paying for it.
  const taxCents = Math.round((taxableCents * (input.taxRateBasisPoints ?? 0)) / 10000);
  const billCents = taxableCents + taxCents;
  const creditUsedCents = input.useCredit ? Math.max(0, Math.min(input.creditAvailableCents, billCents)) : 0;
  const totalCents = Math.max(0, billCents - creditUsedCents);
  return {
    billCents,
    taxCents,
    creditUsedCents,
    totalCents,
    settledByCreditAlone: totalCents === 0 && creditUsedCents > 0,
  };
}
