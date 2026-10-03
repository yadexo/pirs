import type Stripe from "stripe";

/**
 * Stripe issues a signing secret per endpoint, and this app needs two
 * endpoints.
 *
 * Events about the clinics' own accounts — a client's payment succeeding, a
 * refund, an account finishing verification — are "Connect" events, delivered
 * only to an endpoint registered to listen to connected accounts. Events about
 * the platform account itself, which is where this agency's own billing of its
 * clinics lives, go to a plain account endpoint. Stripe will not send both to
 * one endpoint, so the same route has to accept both signatures.
 *
 * Both are optional and independent: an instance that only takes client
 * payments sets the Connect secret, and nothing breaks for one that has only
 * ever set STRIPE_WEBHOOK_SECRET.
 */

export type SecretKind = "platform" | "connect";

export interface WebhookSecret {
  kind: SecretKind;
  secret: string;
}

export function webhookSecrets(env: Record<string, string | undefined> = process.env): WebhookSecret[] {
  const out: WebhookSecret[] = [];
  const platform = env.STRIPE_WEBHOOK_SECRET?.trim();
  const connect = env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();
  if (platform) out.push({ kind: "platform", secret: platform });
  // Only once: the same secret in both variables is one endpoint, not two.
  if (connect && connect !== platform) out.push({ kind: "connect", secret: connect });
  return out;
}

export type Construct = (body: string, signature: string, secret: string) => Stripe.Event;

/**
 * The event, if any configured secret verifies the signature.
 *
 * Trying each is not a weakening: a signature is a MAC over the exact body,
 * so an attacker who cannot produce one for either secret cannot produce one
 * for the pair. Rejection only happens when every secret fails, which is what
 * makes a single route able to serve two endpoints.
 */
export function verifyWithAnySecret(
  body: string,
  signature: string,
  secrets: WebhookSecret[],
  construct: Construct,
): { event: Stripe.Event; matched: SecretKind } | null {
  for (const { kind, secret } of secrets) {
    try {
      return { event: construct(body, signature, secret), matched: kind };
    } catch {
      // Wrong secret for this endpoint; try the other one.
    }
  }
  return null;
}
