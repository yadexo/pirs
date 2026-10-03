/**
 * What a membership's status means for the client.
 *
 * Two different questions get asked of a membership, and conflating them is
 * how a client ends up able to sign up twice or keep benefits they stopped
 * paying for:
 *
 *   - does this membership occupy the client's one slot? (so they are not
 *     offered another plan, and a second join is refused)
 *   - does it actually give benefits right now?
 *
 * A membership awaiting its first payment occupies the slot but gives nothing.
 * One that has just failed a payment keeps its benefits for a short grace
 * period — a card expiring is not a decision to leave — and then stops.
 */

export type MembershipStatusValue =
  | "PENDING"
  | "TRIAL"
  | "ACTIVE"
  | "PAST_DUE"
  | "SUSPENDED"
  | "PAUSED"
  | "CANCELLED"
  | "EXPIRED";

/**
 * Statuses that mean "this client already has a membership". SUSPENDED is in
 * the list: the subscription still exists at Stripe and a successful payment
 * revives it, so offering a second plan would create a mess.
 */
export const MEMBERSHIP_HOLDS_SLOT = ["PENDING", "ACTIVE", "TRIAL", "PAST_DUE", "SUSPENDED", "PAUSED"] as const;

/** Statuses whose benefits apply without qualification. */
export const MEMBERSHIP_BENEFITS_NOW = ["ACTIVE", "TRIAL"] as const;

/**
 * How long benefits continue after a payment fails.
 *
 * Stripe's own retries run for weeks; this is deliberately shorter. A week is
 * long enough for somebody to notice an email and update a card, and short
 * enough that a clinic is not giving away a month of treatment for free.
 */
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface MembershipShape {
  status: string;
  pastDueSince?: Date | null;
}

/** Whether this membership's benefits apply right now. */
export function membershipGivesBenefits(membership: MembershipShape, now: Date = new Date()): boolean {
  if ((MEMBERSHIP_BENEFITS_NOW as readonly string[]).includes(membership.status)) return true;
  if (membership.status !== "PAST_DUE") return false;
  // Past due with no recorded start is treated as still in grace: the clock
  // has to start somewhere, and it is not the client's fault it is missing.
  if (!membership.pastDueSince) return true;
  return now.getTime() - membership.pastDueSince.getTime() < PAST_DUE_GRACE_MS;
}

/** Whether the grace period has run out, so the membership should be suspended. */
export function pastDueGraceExpired(membership: MembershipShape, now: Date = new Date()): boolean {
  return membership.status === "PAST_DUE" && !!membership.pastDueSince && now.getTime() - membership.pastDueSince.getTime() >= PAST_DUE_GRACE_MS;
}

/** The moment benefits stop, for telling the client how long they have. */
export function graceEndsAt(membership: MembershipShape): Date | null {
  if (membership.status !== "PAST_DUE" || !membership.pastDueSince) return null;
  return new Date(membership.pastDueSince.getTime() + PAST_DUE_GRACE_MS);
}
