import type Stripe from "stripe";
import type { StripeConnectStatus } from "@prisma/client";
import { rawDb } from "@/lib/db";

/**
 * What Stripe says about a connected account, and how that is stored.
 *
 * Deliberately free of "server-only": the one-off script that diagnoses a stuck
 * clinic (prisma/stripe-account-status.ts) runs outside Next and needs exactly
 * this logic — a second copy of it would be a second thing to get wrong.
 */

type AccountFlags = Pick<Stripe.Account, "charges_enabled" | "payouts_enabled" | "details_submitted"> & {
  requirements?: Pick<Stripe.Account.Requirements, "disabled_reason"> | null;
};

/**
 * - ACTIVE: Stripe has enabled card payments.
 * - PENDING_VERIFICATION: the form is submitted and Stripe is still checking.
 * - RESTRICTED: Stripe has disabled payments until the clinic acts (for example
 *   past-due information or a rejection).
 * - ONBOARDING: the account exists but the form isn't finished.
 */
export function deriveStripeStatus(account: AccountFlags): StripeConnectStatus {
  if (account.charges_enabled) return "ACTIVE";
  if (!account.details_submitted) return "ONBOARDING";
  const reason = account.requirements?.disabled_reason ?? null;
  if (!reason || reason === "requirements.pending_verification" || reason === "under_review") return "PENDING_VERIFICATION";
  return "RESTRICTED";
}

/**
 * Stores what Stripe says about the account. `observedAt` is when Stripe
 * produced that state (a webhook's `created`); an older observation never
 * overwrites a newer one, so out-of-order webhooks can't roll the status back.
 */
export async function syncClinicFromAccount(account: Stripe.Account, observedAt: Date = new Date()): Promise<boolean> {
  const status = deriveStripeStatus(account);
  const updated = await rawDb.tenant.updateMany({
    where: {
      stripeAccountId: account.id,
      OR: [{ stripeStatusCheckedAt: null }, { stripeStatusCheckedAt: { lte: observedAt } }],
    },
    data: {
      stripeStatus: status,
      stripeChargesEnabled: Boolean(account.charges_enabled),
      stripePayoutsEnabled: Boolean(account.payouts_enabled),
      stripeDetailsSubmitted: Boolean(account.details_submitted),
      stripeCountry: account.country ?? undefined,
      stripeStatusCheckedAt: observedAt,
    },
  });
  return updated.count > 0;
}

/** The clinic removed the platform's access to its Stripe account. */
export async function disconnectClinicAccount(accountId: string): Promise<void> {
  await rawDb.tenant.updateMany({
    where: { stripeAccountId: accountId },
    data: {
      stripeAccountId: null,
      stripeStatus: "NOT_CONNECTED",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false,
      stripeCountry: null,
      stripeStatusCheckedAt: new Date(),
    },
  });
}
