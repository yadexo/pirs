/**
 * What a session package costs, and what it saves — worked out per viewer.
 *
 * A package is a fixed number of sessions for one price. Whether it saves
 * anything depends on who is looking: a member already pays the member price
 * for a single session, so the same package saves them less, and sometimes
 * nothing. That is why the saving is never stored on the package — it is a
 * comparison with a price, and the price depends on the reader.
 *
 * The comparison is deliberately against the *cheapest* covered treatment. A
 * package covering three treatments can be spent on any of them, so the
 * smallest honest claim is the one against the cheapest, and the wording says
 * "at least" to make that explicit rather than quietly picking a flattering
 * number.
 */

export interface PackageSaving {
  /** Price ÷ sessions, to the cent. */
  perSessionCents: number;
  /** What the package saves this viewer, or null when it saves them nothing. */
  savingCents: number | null;
  /**
   * "Save €38" for a package covering one treatment, "Save at least €38" when
   * it covers several and the comparison was against the cheapest.
   */
  atLeast: boolean;
}

export interface PackageSavingInput {
  packagePriceCents: number;
  sessions: number;
  /**
   * What this viewer pays for one session of each covered treatment: the
   * regular price for a non-member, the member price for a member. Empty when
   * the package covers nothing, which is a package nobody can use.
   */
  coveredSinglePricesCents: number[];
}

export function packageSaving(input: PackageSavingInput): PackageSaving {
  const { packagePriceCents, sessions, coveredSinglePricesCents } = input;
  const perSessionCents = sessions > 0 ? Math.round(packagePriceCents / sessions) : 0;

  if (sessions <= 0 || coveredSinglePricesCents.length === 0) {
    return { perSessionCents, savingCents: null, atLeast: false };
  }

  const cheapest = Math.min(...coveredSinglePricesCents);
  const buyingSeparately = cheapest * sessions;
  const savingCents = buyingSeparately - packagePriceCents;

  // Nothing at all when there is no saving: no line, no tag, no text. A
  // package that costs more than buying the sessions one by one should say
  // so by saying nothing, not by showing "Save €0".
  if (savingCents <= 0) return { perSessionCents, savingCents: null, atLeast: false };

  return { perSessionCents, savingCents, atLeast: coveredSinglePricesCents.length > 1 };
}

/** "Save €38" / "Save at least €38", or null when there is nothing to claim. */
export function savingLabel(saving: PackageSaving, money: (cents: number) => string): string | null {
  if (saving.savingCents === null) return null;
  return `${saving.atLeast ? "Save at least" : "Save"} ${money(saving.savingCents)}`;
}

/* ------------------------------------------------------------- expiry */

/**
 * When a package bought today runs out.
 *
 * Fixed at purchase, from the purchase date — so a clinic that later changes
 * "valid 365 days" to 180 does not shorten what somebody already owns. Null
 * when the package never expires.
 */
export function packageExpiresAt(purchasedAt: Date, expiryDays: number | null | undefined): Date | null {
  if (!expiryDays || expiryDays <= 0) return null;
  return new Date(purchasedAt.getTime() + expiryDays * 86_400_000);
}

export function isExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !!expiresAt && expiresAt.getTime() <= now.getTime();
}

/** "3 of 5 sessions left" — the client's own count, in their own words. */
export function sessionsLeftLabel(remaining: number, total: number): string {
  return `${remaining} of ${total} session${total === 1 ? "" : "s"} left`;
}

/* ---------------------------------------------------------- reminders */

/** How long before the end date a client is reminded they still have sessions. */
export const EXPIRY_REMINDER_DAYS = 14;

/**
 * Whether a package should be reminded about now: it still has sessions, it
 * has an end date, that date is within the window, and it has not passed.
 * A package already reminded is handled by the caller, which only asks about
 * ones with no reminder recorded.
 */
export function needsExpiryReminder(
  pkg: { remainingUses: number; expiresAt: Date | null; status: string },
  now: Date = new Date(),
  windowDays = EXPIRY_REMINDER_DAYS,
): boolean {
  if (pkg.status !== "ACTIVE" || pkg.remainingUses <= 0 || !pkg.expiresAt) return false;
  const msLeft = pkg.expiresAt.getTime() - now.getTime();
  if (msLeft <= 0) return false;
  return msLeft <= windowDays * 86_400_000;
}

/* ---------------------------------------------------------- transfers */

export type TransferRefusal =
  | { ok: true }
  | { ok: false; reason: "expired" | "none-left" | "too-many" | "not-transferable" | "self"; message: string };

/**
 * Whether these sessions may be given away, and why not when they may not.
 *
 * Giving is final and immediate, so every reason to refuse is checked before
 * anything moves — and each one is phrased as something the client can act on.
 */
export function canGiveSessions(input: {
  transferable: boolean;
  remainingUses: number;
  requested: number;
  expiresAt: Date | null;
  giverProfileId: string;
  receiverProfileId: string | null;
  now?: Date;
}): TransferRefusal {
  const now = input.now ?? new Date();

  if (!input.transferable) {
    return { ok: false, reason: "not-transferable", message: "These sessions can't be given to someone else." };
  }
  if (isExpired(input.expiresAt, now)) {
    return { ok: false, reason: "expired", message: "These sessions have passed their end date, so they can't be given away." };
  }
  if (input.remainingUses <= 0) {
    return { ok: false, reason: "none-left", message: "There are no sessions left to give." };
  }
  if (input.requested < 1 || input.requested > input.remainingUses) {
    return { ok: false, reason: "too-many", message: `You can give between 1 and ${input.remainingUses} sessions.` };
  }
  if (input.receiverProfileId && input.receiverProfileId === input.giverProfileId) {
    return { ok: false, reason: "self", message: "These are already yours." };
  }
  return { ok: true };
}
