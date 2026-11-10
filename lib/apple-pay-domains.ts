import type Stripe from "stripe";

/**
 * Apple Pay only appears on domains registered with Stripe — and with direct
 * charges the registration lives on the *clinic's* connected account, not the
 * platform's. So every clinic that can take payments needs every checkout
 * domain registered on its own account.
 *
 * No "server-only" here: the one-off script that backfills already-connected
 * clinics runs outside Next.
 */

export interface DomainResult {
  domain: string;
  status: "registered" | "already" | "failed";
  /** Set when status is "failed"; Stripe's own message. */
  error?: string;
}

/** The host of a URL, without port or path. Null for anything unusable. */
function hostOf(value: string | undefined | null): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    const host = url.hostname.toLowerCase();
    // Apple Pay needs a publicly reachable HTTPS domain; localhost can't be registered.
    if (!host || host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Every domain a clinic's checkout can run on: the client app's own host
 * (login.deza.ai) and this deployment's own host (app.deza.ai). APPLE_PAY_DOMAINS
 * adds any others, comma-separated — a preview host, say, or a clinic's own
 * client domain.
 */
export function checkoutDomains(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates = [env.CLIENT_APP_URL, env.APP_URL, ...(env.APPLE_PAY_DOMAINS ?? "").split(",")];
  const domains = new Set<string>();
  for (const candidate of candidates) {
    const host = hostOf(candidate);
    if (host) domains.add(host);
  }
  return [...domains];
}

/**
 * The same, plus a clinic's own domain when it has one.
 *
 * Apple Pay only appears on a registered domain, and the registration lives
 * on the clinic's connected account — so a clinic that moves its clients to
 * app.clinicname.nl needs that host registered on its own account too, or
 * Apple Pay quietly stops appearing at its checkout and nothing says why.
 *
 * The shared hosts stay in the list: the old address keeps working, and
 * clients who installed from it are still checking out there.
 */
export function clinicCheckoutDomains(clinicHost: string | null, env: NodeJS.ProcessEnv = process.env): string[] {
  const domains = checkoutDomains(env);
  const host = hostOf(clinicHost);
  if (host && !domains.includes(host)) domains.push(host);
  return domains;
}

/** The Stripe calls this module makes — lets tests pass a fake. */
export interface PaymentMethodDomainsApi {
  list: (params: { domain_name: string; limit?: number }, options: { stripeAccount: string }) => Promise<{ data: { id: string }[] }>;
  create: (params: { domain_name: string; enabled: boolean }, options: { stripeAccount: string }) => Promise<{ id: string }>;
}

/**
 * Registers each checkout domain on one clinic's connected account, skipping
 * the ones already there. Safe to run repeatedly, and a domain that fails never
 * stops the others — the caller decides what a failure means.
 */
export async function registerApplePayDomains(
  api: PaymentMethodDomainsApi,
  stripeAccountId: string,
  domains: string[] = checkoutDomains(),
): Promise<DomainResult[]> {
  const results: DomainResult[] = [];
  for (const domain of domains) {
    try {
      const existing = await api.list({ domain_name: domain, limit: 1 }, { stripeAccount: stripeAccountId });
      if (existing.data.length > 0) {
        results.push({ domain, status: "already" });
        continue;
      }
      await api.create({ domain_name: domain, enabled: true }, { stripeAccount: stripeAccountId });
      results.push({ domain, status: "registered" });
    } catch (err) {
      results.push({ domain, status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/** The payment method domains resource of a Stripe client, typed for the above. */
export function domainsApi(stripe: Stripe): PaymentMethodDomainsApi {
  return stripe.paymentMethodDomains as unknown as PaymentMethodDomainsApi;
}
