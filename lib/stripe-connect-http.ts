import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, type MerchantActionContext } from "@/lib/merchant-action";
import {
  StripeNotConfiguredError,
  countryCodeFrom,
  createOnboardingLink,
  ensureConnectedAccount,
  isStripeConfigured,
  refreshClinicStatus,
  stripeClient,
  type StripeConnectClient,
} from "@/lib/stripe-connect";

/**
 * The Stripe Connect endpoints under /m/[merchantId]/stripe/*. The route files
 * only call these, so tests can run them with a fake Stripe client.
 */

export type StripeNotice = "returned" | "not-configured" | "owner-only" | "no-country" | "country-changed" | "not-confirmed" | "failed";

/** Back to App Builder → Settings → Integrations, with a notice for the page to show. */
export function settingsRedirect(req: NextRequest, merchantId: string, notice?: StripeNotice): NextResponse {
  const url = new URL(`/m/${encodeURIComponent(merchantId)}/app-builder`, requestOrigin(req));
  url.searchParams.set("tab", "settings");
  url.searchParams.set("section", "integrations");
  if (notice) url.searchParams.set("stripe", notice);
  return NextResponse.redirect(url, 303);
}

/**
 * The origin the clinic's browser is actually on (clinic.pirs.io, a preview
 * URL, localhost), so Stripe returns them to the same host they left from —
 * where their session cookie lives.
 */
export function requestOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")).split(",")[0]!.trim();
  return `${proto}://${host}`;
}

/**
 * Only the clinic's own owner may start or finish onboarding. The account is
 * the clinic's, and Stripe asks for its legal details, identity and bank — so
 * agency admins, who otherwise can act inside any clinic, are refused here.
 */
export async function requireStripeOwner(merchantId: string): Promise<MerchantActionContext> {
  const ctx = await requireMerchantAction(merchantId, "owner");
  if (ctx.user.role !== "TENANT_ADMIN") throw new ActionError("Only the clinic owner can connect Stripe.");
  return ctx;
}

async function ownerOrRedirect(req: NextRequest, merchantId: string): Promise<MerchantActionContext | NextResponse> {
  try {
    return await requireStripeOwner(merchantId);
  } catch (err) {
    if (err instanceof ActionError) return settingsRedirect(req, merchantId, "owner-only");
    throw err;
  }
}

function logFailure(where: string, merchantId: string, err: unknown) {
  // Stripe's message, never the request: it can name the account but carries no secrets.
  console.error(`[stripe-connect] ${where} failed for clinic ${merchantId}:`, err instanceof Error ? err.message : err);
}

// ---------------------------------------------------------------------------
// POST /m/[merchantId]/stripe/connect — "Connect Stripe" / "Continue setup"
// ---------------------------------------------------------------------------

/**
 * Creates the clinic's Standard account the first time, in the country the
 * owner confirmed from the clinic's address, then sends the browser to a fresh
 * Stripe-hosted onboarding link.
 */
export async function handleConnect(req: NextRequest, merchantId: string, stripe?: StripeConnectClient): Promise<NextResponse> {
  // A cross-site form can't start onboarding on the owner's behalf.
  if (req.headers.get("origin") !== requestOrigin(req)) {
    return NextResponse.json({ error: "Request refused." }, { status: 403 });
  }

  const ctx = await ownerOrRedirect(req, merchantId);
  if (ctx instanceof NextResponse) return ctx;
  if (!stripe && !isStripeConfigured()) return settingsRedirect(req, merchantId, "not-configured");

  const clinic = await rawDb.tenant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { id: true, name: true, stripeAccountId: true, branding: { select: { businessName: true, country: true, contactEmail: true } } },
  });

  let country = "";
  if (!clinic.stripeAccountId) {
    const form = await req.formData();
    const onFile = countryCodeFrom(clinic.branding?.country);
    if (!onFile) return settingsRedirect(req, merchantId, "no-country");
    // The owner confirmed a specific country. If the address changed since the
    // page loaded, make them look again rather than create it somewhere else.
    if (form.get("country") !== onFile) return settingsRedirect(req, merchantId, "country-changed");
    if (form.get("confirmed") !== "on") return settingsRedirect(req, merchantId, "not-confirmed");
    country = onFile;
  }

  try {
    const client = stripe ?? stripeClient();
    const accountId = await ensureConnectedAccount(
      client,
      {
        id: clinic.id,
        name: clinic.branding?.businessName ?? clinic.name,
        email: clinic.branding?.contactEmail ?? ctx.user.email,
        stripeAccountId: clinic.stripeAccountId,
      },
      country,
    );
    if (!clinic.stripeAccountId) await ctx.audit("stripe.account_created", "Tenant", merchantId, { stripeAccountId: accountId, country });
    const url = await createOnboardingLink(client, accountId, requestOrigin(req), merchantId);
    await ctx.audit("stripe.onboarding_started", "Tenant", merchantId, { stripeAccountId: accountId });
    return NextResponse.redirect(url, 303);
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) return settingsRedirect(req, merchantId, "not-configured");
    logFailure("connect", merchantId, err);
    return settingsRedirect(req, merchantId, "failed");
  }
}

// ---------------------------------------------------------------------------
// GET /m/[merchantId]/stripe/refresh — Stripe's refresh_url
// ---------------------------------------------------------------------------

/**
 * Stripe sends the browser here when an onboarding link has expired or was
 * already used. Issue a fresh one and send them straight back into Stripe.
 */
export async function handleRefresh(req: NextRequest, merchantId: string, stripe?: StripeConnectClient): Promise<NextResponse> {
  const ctx = await ownerOrRedirect(req, merchantId);
  if (ctx instanceof NextResponse) return ctx;
  if (!stripe && !isStripeConfigured()) return settingsRedirect(req, merchantId, "not-configured");

  const clinic = await rawDb.tenant.findUniqueOrThrow({ where: { id: merchantId }, select: { stripeAccountId: true } });
  if (!clinic.stripeAccountId) return settingsRedirect(req, merchantId);

  try {
    const client = stripe ?? stripeClient();
    const url = await createOnboardingLink(client, clinic.stripeAccountId, requestOrigin(req), merchantId);
    return NextResponse.redirect(url, 303);
  } catch (err) {
    logFailure("refresh", merchantId, err);
    return settingsRedirect(req, merchantId, "failed");
  }
}

// ---------------------------------------------------------------------------
// GET /m/[merchantId]/stripe/return — Stripe's return_url
// ---------------------------------------------------------------------------

/**
 * Coming back from Stripe says nothing about whether onboarding is finished,
 * let alone verified. Read the account from Stripe and store what it says;
 * the settings page then shows "pending verification" until Stripe enables
 * card payments.
 */
export async function handleReturn(req: NextRequest, merchantId: string, stripe?: StripeConnectClient): Promise<NextResponse> {
  const ctx = await ownerOrRedirect(req, merchantId);
  if (ctx instanceof NextResponse) return ctx;

  const clinic = await rawDb.tenant.findUniqueOrThrow({ where: { id: merchantId }, select: { stripeAccountId: true } });
  if (!clinic.stripeAccountId) return settingsRedirect(req, merchantId);

  try {
    const client = stripe ?? stripeClient();
    const status = await refreshClinicStatus(client, clinic.stripeAccountId);
    await ctx.audit("stripe.onboarding_returned", "Tenant", merchantId, { stripeAccountId: clinic.stripeAccountId, status });
    return settingsRedirect(req, merchantId, "returned");
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) return settingsRedirect(req, merchantId, "not-configured");
    logFailure("return", merchantId, err);
    return settingsRedirect(req, merchantId, "failed");
  }
}
