import "server-only";
import Stripe from "stripe";
import type { StripeConnectStatus } from "@prisma/client";
import { rawDb } from "@/lib/db";

/**
 * Stripe Connect for clinics: each clinic links its own Standard account, and
 * clients' payments go to that account. Onboarding uses Stripe's hosted flow
 * (Accounts API + Account Links), never OAuth.
 *
 * The status stored on the clinic is always derived from Stripe's own flags —
 * returning from onboarding does not mean the account is verified.
 */

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe isn't configured on this platform yet (STRIPE_SECRET_KEY is empty).");
  }
}

/** The subset of the Stripe client this module uses — lets tests pass a fake. */
export interface StripeConnectClient {
  accounts: {
    create: (params: Stripe.AccountCreateParams, options?: Stripe.RequestOptions) => Promise<Stripe.Account>;
    retrieve: (id: string) => Promise<Stripe.Account>;
  };
  accountLinks: {
    create: (params: Stripe.AccountLinkCreateParams) => Promise<Stripe.AccountLink>;
  };
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeClient(): StripeConnectClient {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  return new Stripe(key) as unknown as StripeConnectClient;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Country
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  usa: "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  holland: "NL",
  "the netherlands": "NL",
  nederland: "NL",
  deutschland: "DE",
  belgië: "BE",
  belgie: "BE",
  belgique: "BE",
  "the united kingdom": "GB",
};

/** Codes Intl names that aren't countries a Stripe account can be in. UK is an alias; Stripe uses GB. */
const NOT_COUNTRIES = new Set(["UK", "EU", "UN", "EZ", "QO", "XA", "XB", "ZZ"]);

let nameIndex: Map<string, string> | null = null;

/** Country names in a few languages, built from the runtime's own Intl data. */
function countryNames(): Map<string, string> {
  if (nameIndex) return nameIndex;
  nameIndex = new Map();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const displays = ["en", "nl", "de", "fr", "es"].map((l) => new Intl.DisplayNames([l], { type: "region", fallback: "none" }));
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b;
      if (NOT_COUNTRIES.has(code)) continue;
      for (const display of displays) {
        const name = display.of(code)?.toLowerCase();
        // First code wins, so an alias can never replace the real one.
        if (name && name !== code.toLowerCase() && !nameIndex.has(name)) nameIndex.set(name, code);
      }
    }
  }
  return nameIndex;
}

/**
 * Two-letter country code from the free-text country on the clinic's address:
 * "NL", "Netherlands", "Nederland", "USA" and similar. Null when it can't be
 * read with confidence — the owner then fixes the address instead of us
 * guessing, because a Stripe account's country can never be changed.
 */
export function countryCodeFrom(text: string | null | undefined): string | null {
  const value = (text ?? "").trim().replace(/\.$/, "");
  if (!value) return null;
  if (/^[A-Za-z]{2}$/.test(value)) {
    const code = value.toUpperCase();
    if (code === "UK") return "GB";
    if (NOT_COUNTRIES.has(code)) return null;
    const known = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(code);
    return known && known !== "Unknown Region" ? code : null;
  }
  const key = value.toLowerCase();
  return ALIASES[key] ?? countryNames().get(key) ?? null;
}

export function countryName(code: string): string {
  return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

/** Where Stripe sends the clinic's browser back to, on the host they came from. */
export function onboardingUrls(origin: string, merchantId: string) {
  const base = `${origin.replace(/\/+$/, "")}/m/${encodeURIComponent(merchantId)}/stripe`;
  return { refresh_url: `${base}/refresh`, return_url: `${base}/return` };
}

/**
 * Creates the clinic's Standard account once. The idempotency key makes a
 * double click (or two tabs) return the same account instead of creating two.
 */
export async function ensureConnectedAccount(
  stripe: StripeConnectClient,
  clinic: { id: string; name: string; email: string | null; stripeAccountId: string | null },
  country: string,
): Promise<string> {
  if (clinic.stripeAccountId) return clinic.stripeAccountId;

  const account = await stripe.accounts.create(
    {
      type: "standard",
      country,
      email: clinic.email ?? undefined,
      business_profile: { name: clinic.name },
      metadata: { tenantId: clinic.id },
    },
    { idempotencyKey: `connect-account-${clinic.id}-${country}` },
  );

  // Only store it if nothing else did first; otherwise keep the stored one.
  const claimed = await rawDb.tenant.updateMany({
    where: { id: clinic.id, stripeAccountId: null },
    data: { stripeAccountId: account.id, stripeCountry: account.country ?? country },
  });
  if (claimed.count === 0) {
    const current = await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic.id }, select: { stripeAccountId: true } });
    return current.stripeAccountId ?? account.id;
  }
  await syncClinicFromAccount(account);
  return account.id;
}

/** A fresh, single-use link into Stripe's hosted onboarding. Links expire within minutes. */
export async function createOnboardingLink(stripe: StripeConnectClient, accountId: string, origin: string, merchantId: string): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    ...onboardingUrls(origin, merchantId),
  });
  return link.url;
}

/** Reads the account from Stripe now and stores its status. */
export async function refreshClinicStatus(stripe: StripeConnectClient, accountId: string): Promise<StripeConnectStatus> {
  const account = await stripe.accounts.retrieve(accountId);
  await syncClinicFromAccount(account);
  return deriveStripeStatus(account);
}
