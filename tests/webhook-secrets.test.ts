import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { webhookSecrets, verifyWithAnySecret } from "@/lib/stripe-webhook-secrets";

/**
 * One route, two Stripe endpoints. Stripe will not deliver connected-account
 * events and platform-account events to the same endpoint, and signs each with
 * that endpoint's own secret — so the route has to accept either, and still
 * refuse everything else.
 */
describe("webhook signing secrets", () => {
  const signer = new Stripe("sk_test_signing_only");
  const PLATFORM = "whsec_platform_secret";
  const CONNECT = "whsec_connect_secret";
  const body = JSON.stringify({ id: "evt_1", object: "event", type: "payment_intent.succeeded", data: { object: {} } });

  const construct = (payload: string, sig: string, secret: string) => signer.webhooks.constructEvent(payload, sig, secret);
  const signWith = (secret: string) => signer.webhooks.generateTestHeaderString({ payload: body, secret });

  it("reads both secrets, and neither is required", () => {
    expect(webhookSecrets({ STRIPE_WEBHOOK_SECRET: PLATFORM, STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT })).toEqual([
      { kind: "platform", secret: PLATFORM },
      { kind: "connect", secret: CONNECT },
    ]);
    expect(webhookSecrets({ STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT })).toEqual([{ kind: "connect", secret: CONNECT }]);
    expect(webhookSecrets({})).toEqual([]);
  });

  it("ignores blank values, so an unset variable is not a secret", () => {
    expect(webhookSecrets({ STRIPE_WEBHOOK_SECRET: "", STRIPE_CONNECT_WEBHOOK_SECRET: "  " })).toEqual([]);
  });

  it("counts the same secret in both variables once", () => {
    expect(webhookSecrets({ STRIPE_WEBHOOK_SECRET: PLATFORM, STRIPE_CONNECT_WEBHOOK_SECRET: PLATFORM })).toHaveLength(1);
  });

  it("accepts an event signed with either endpoint's secret", () => {
    const secrets = webhookSecrets({ STRIPE_WEBHOOK_SECRET: PLATFORM, STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT });

    expect(verifyWithAnySecret(body, signWith(CONNECT), secrets, construct)).toMatchObject({ matched: "connect" });
    expect(verifyWithAnySecret(body, signWith(PLATFORM), secrets, construct)).toMatchObject({ matched: "platform" });
  });

  it("order does not matter: the connect secret works when listed second", () => {
    const reversed = webhookSecrets({ STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT, STRIPE_WEBHOOK_SECRET: PLATFORM });
    expect(verifyWithAnySecret(body, signWith(CONNECT), reversed, construct)?.event.id).toBe("evt_1");
  });

  it("refuses a signature from neither secret", () => {
    const secrets = webhookSecrets({ STRIPE_WEBHOOK_SECRET: PLATFORM, STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT });
    expect(verifyWithAnySecret(body, signWith("whsec_somebody_else"), secrets, construct)).toBeNull();
    expect(verifyWithAnySecret(body, "t=1,v1=forged", secrets, construct)).toBeNull();
  });

  it("refuses a body that was altered after signing", () => {
    const secrets = webhookSecrets({ STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT });
    const signature = signWith(CONNECT);
    const tampered = JSON.stringify({ id: "evt_1", object: "event", type: "payment_intent.succeeded", data: { object: { amount: 1 } } });
    expect(verifyWithAnySecret(tampered, signature, secrets, construct)).toBeNull();
  });

  it("refuses everything when no secret is configured", () => {
    expect(verifyWithAnySecret(body, signWith(CONNECT), [], construct)).toBeNull();
  });
});
