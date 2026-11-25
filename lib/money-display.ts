/**
 * Small rules for showing money so that it adds up and means what it says
 * (tests/money-display.test.ts; QA report M1, K3, M2, P3, SH6).
 */

/** A cart line: what the line costs, and the unit price beside it when there is more than one. */
export function cartLineAmounts(unitCents: number, quantity: number): { lineCents: number; unitCents: number; showUnit: boolean } {
  return { lineCents: unitCents * quantity, unitCents, showUnit: quantity > 1 };
}

export type MemberSavingCopy =
  | { key: "membersSaveAll" | "membersSaveTreatments" | "membersSaveProducts"; rate: number }
  | { key: "membersSaveSplit"; rate: number; productRate: number };

/**
 * Which "members save" sentence is true for a plan. "On everything" only when
 * treatments and products are discounted alike; otherwise it names what is.
 */
export function memberSavingCopy(servicePercent: number | null | undefined, productPercent: number | null | undefined): MemberSavingCopy | null {
  const service = servicePercent ?? 0;
  const product = productPercent ?? 0;
  if (service <= 0 && product <= 0) return null;
  if (service > 0 && product <= 0) return { key: "membersSaveTreatments", rate: service };
  if (product > 0 && service <= 0) return { key: "membersSaveProducts", rate: product };
  if (service === product) return { key: "membersSaveAll", rate: service };
  return { key: "membersSaveSplit", rate: service, productRate: product };
}

/** What an order's payment status is to the person reading it, from its refunds. */
export function orderRefundState(totalCents: number, refundedCents: number): "paid" | "partlyRefunded" | "refunded" {
  if (refundedCents <= 0) return "paid";
  return refundedCents >= totalCents ? "refunded" : "partlyRefunded";
}
