import "server-only";
import Stripe from "stripe";
import type { StripeConnectStatus } from "@prisma/client";
import { rawDb } from "@/lib/db";
import { deriveStripeStatus, syncClinicFromAccount } from "@/lib/stripe-status";

/**
 * Stripe Connect for clinics: each clinic links its own Stripe account, and
 * clients' payments go to that account. Onboarding uses Stripe's hosted flow,
 * never OAuth.
 *
 * Accounts are created with Stripe's Accounts v2 API (POST /v2/core/accounts):
 * Stripe refuses Accounts v1 creation for new Connect platforms. The account is
 * the v2 equivalent of a Standard account — the clinic gets the full Stripe
 * Dashboard, and Stripe (not the platform) collects its fees and covers losses.
 * Onboarding links are v2 too (POST /v2/core/account_links).
 *
 * Reading an account still uses GET /v1/accounts/:id, which Stripe supports for
 * v2 accounts and answers in the v1 shape — so the status logic, and the v1
 * `account.updated` webhook (still sent for v2 accounts), stay as they were.
 *
 * The status stored on the clinic is always derived from Stripe's own flags —
 * returning from onboarding does not mean the account is verified.
 */

/** Stripe's stable API version that serves the v2 Accounts endpoints used here. */
export const STRIPE_V2_API_VERSION = "2026-08-26.dahlia";

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe isn't configured on this platform yet (STRIPE_SECRET_KEY is empty).");
  }
}

/** Body of POST /v2/core/accounts, limited to what this module sends. */
export interface V2AccountCreateBody {
  contact_email?: string;
  display_name: string;
  dashboard: "full";
  identity: { country: string };
  configuration: { merchant: { capabilities: { card_payments: { requested: true } } } };
  defaults: { responsibilities: { fees_collector: "stripe"; losses_collector: "stripe" } };
  metadata: Record<string, string>;
  include: "identity"[];
}

/** Body of POST /v2/core/account_links for onboarding. */
export interface V2AccountLinkBody {
  account: string;
  use_case: {
    type: "account_onboarding";
    account_onboarding: { configurations: "merchant"[]; refresh_url: string; return_url: string };
  };
}

/** The Stripe calls this module makes — lets tests pass a fake. */
export interface StripeConnectClient {
  /** POST /v2/core/accounts */
  createAccount: (body: V2AccountCreateBody, idempotencyKey: string) => Promise<{ id: string; identity?: { country?: string | null } | null }>;
  /** POST /v2/core/account_links */
  createAccountLink: (body: V2AccountLinkBody) => Promise<{ url: string }>;
  /** GET /v1/accounts/:id — answered in the v1 shape, including for v2 accounts. */
  retrieveAccount: (id: string) => Promise<Stripe.Account>;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** `config` is for tests that point the client at a local server. */
export function stripeClient(config?: Stripe.StripeConfig): StripeConnectClient {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  const stripe = new Stripe(key, config);
  // The installed SDK has no typed v2 Accounts methods; rawRequest sends /v2
  // paths as JSON with the v2 headers. The API version is pinned per request so
  // the rest of the app keeps its own.
  const v2 = { apiVersion: STRIPE_V2_API_VERSION };
  return {
    createAccount: async (body, idempotencyKey) =>
      (await stripe.rawRequest("POST", "/v2/core/accounts", { ...body }, { ...v2, idempotencyKey })) as unknown as {
        id: string;
        identity?: { country?: string | null } | null;
      },
    createAccountLink: async (body) => (await stripe.rawRequest("POST", "/v2/core/account_links", { ...body }, v2)) as unknown as { url: string },
    retrieveAccount: (id) => stripe.accounts.retrieve(id),
  };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

// The status logic lives in lib/stripe-status.ts, where the one-off diagnostic
// script can import it too (it runs outside Next, so it cannot import a
// "server-only" module). Re-exported here so callers keep a single import.
export { deriveStripeStatus, syncClinicFromAccount, disconnectClinicAccount } from "@/lib/stripe-status";

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

  const account = await stripe.createAccount(
    {
      contact_email: clinic.email ?? undefined,
      display_name: clinic.name,
      // Standard-account equivalent: the clinic's own full Stripe Dashboard, and
      // Stripe — not the platform — collects its fees and carries its losses.
      dashboard: "full",
      identity: { country: country.toLowerCase() },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      metadata: { tenantId: clinic.id },
      include: ["identity"],
    },
    // "v2" in the key: an earlier v1 attempt with the old key must not be replayed.
    `connect-account-v2-${clinic.id}-${country}`,
  );

  // Only store it if nothing else did first; otherwise keep the stored one.
  const claimed = await rawDb.tenant.updateMany({
    where: { id: clinic.id, stripeAccountId: null },
    data: {
      stripeAccountId: account.id,
      stripeCountry: (account.identity?.country ?? country).toUpperCase(),
      // A brand-new account has not been through onboarding yet. The return
      // page and account.updated webhooks fill in Stripe's real flags from here.
      stripeStatus: "ONBOARDING",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false,
    },
  });
  if (claimed.count === 0) {
    const current = await rawDb.tenant.findUniqueOrThrow({ where: { id: clinic.id }, select: { stripeAccountId: true } });
    return current.stripeAccountId ?? account.id;
  }
  return account.id;
}

/** A fresh, single-use link into Stripe's hosted onboarding. Links expire within minutes. */
export async function createOnboardingLink(stripe: StripeConnectClient, accountId: string, origin: string, merchantId: string): Promise<string> {
  const link = await stripe.createAccountLink({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: { configurations: ["merchant"], ...onboardingUrls(origin, merchantId) },
    },
  });
  return link.url;
}

/** Reads the account from Stripe now and stores its status. */
export async function refreshClinicStatus(stripe: StripeConnectClient, accountId: string): Promise<StripeConnectStatus> {
  const account = await stripe.retrieveAccount(accountId);
  await syncClinicFromAccount(account);
  return deriveStripeStatus(account);
}
