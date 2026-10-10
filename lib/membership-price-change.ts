/**
 * When a price rise is allowed to reach a member.
 *
 * A member gets at least a month's warning before they pay more. Their next
 * billing date is the obvious moment, but it is often days away — so the new
 * price starts at the first billing date that falls far enough after they are
 * told, which may be the period after next.
 *
 * Pure, because this is the part that must be right: everything else is
 * calling Stripe and sending a message about whatever this decides.
 */

/** The warning a member is owed before a price rise reaches them. */
export const PRICE_NOTICE_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

export interface PriceChangeTiming {
  /** The billing date the new price first applies on. */
  effectiveAt: Date;
  /**
   * When it is safe to tell Stripe. Switching a price makes the *next*
   * invoice use it, so when the new price is not meant for the next invoice,
   * the switch has to wait until that one has gone out.
   */
  applyAfter: Date;
  /** True when Stripe can be told straight away. */
  immediate: boolean;
  /** How many billing dates are skipped before it bites — 0 or 1 in practice. */
  periodsDeferred: number;
}

function addPeriod(from: Date, frequency: string): Date {
  const out = new Date(from);
  if (frequency === "MONTHLY") out.setMonth(out.getMonth() + 1);
  else out.setFullYear(out.getFullYear() + 1);
  return out;
}

/**
 * Works out when a member's new price starts, and when Stripe may be told.
 *
 * `nextBillingAt` is the next date this member pays. If it is at least
 * PRICE_NOTICE_DAYS away, the new price starts there and Stripe can be
 * updated now. If it is sooner, that payment goes out at the old price and
 * the new one starts at the following date.
 */
export function planPriceChange({
  nextBillingAt,
  frequency,
  now = new Date(),
  noticeDays = PRICE_NOTICE_DAYS,
}: {
  nextBillingAt: Date;
  frequency: string;
  now?: Date;
  noticeDays?: number;
}): PriceChangeTiming {
  const earliest = new Date(now.getTime() + noticeDays * DAY);

  if (nextBillingAt.getTime() >= earliest.getTime()) {
    return { effectiveAt: nextBillingAt, applyAfter: now, immediate: true, periodsDeferred: 0 };
  }

  // Their next payment is too soon to be warned about, so it goes out at the
  // price they already know, and the new one starts the period after.
  let effectiveAt = addPeriod(nextBillingAt, frequency);
  let periodsDeferred = 1;
  // A plan billed so often that even the period after is too soon keeps
  // moving out — a weekly plan would, if one ever existed.
  while (effectiveAt.getTime() < earliest.getTime() && periodsDeferred < 24) {
    effectiveAt = addPeriod(effectiveAt, frequency);
    periodsDeferred += 1;
  }

  return {
    effectiveAt,
    // Safe once the invoice the member was not warned about has gone out.
    applyAfter: nextBillingAt,
    immediate: false,
    periodsDeferred,
  };
}
