import { describe, it, expect, afterAll } from "vitest";
import { rawDb } from "@/lib/db";
import type Stripe from "stripe";
import { alreadyProcessed, markProcessed, forgetProcessed } from "@/lib/stripe-webhook";

/**
 * Stripe retries an event until it gets a 2xx, and can deliver the same one
 * twice over. Claiming the event stops two deliveries acting at once — but a
 * claim is not proof that the work was done, and an event whose handler was
 * killed halfway has to be retryable, or an order stays unpaid for good.
 */
describe("claiming a Stripe event", () => {
  const stamp = Date.now();
  const ids: string[] = [];

  const event = (suffix: string): Stripe.Event => {
    const id = `evt_claim_${stamp}_${suffix}`;
    ids.push(id);
    return { id, type: "payment_intent.succeeded", account: `acct_${stamp}`, created: 1 } as unknown as Stripe.Event;
  };

  /** Puts a claim far enough in the past that no handler could still hold it. */
  const age = (id: string, minutes: number) =>
    rawDb.processedStripeEvent.updateMany({ where: { id }, data: { processedAt: new Date(Date.now() - minutes * 60_000) } });

  afterAll(async () => {
    await rawDb.processedStripeEvent.deleteMany({ where: { id: { in: ids } } });
  });

  it("lets the first delivery through and holds the second back", async () => {
    const e = event("first");
    expect(await alreadyProcessed(e)).toBe(false);
    // The first delivery is still working; this one must not act as well.
    expect(await alreadyProcessed(e)).toBe(true);
  });

  it("never runs an event again once its handler finished", async () => {
    const e = event("done");
    expect(await alreadyProcessed(e)).toBe(false);
    await markProcessed(e.id);

    expect(await alreadyProcessed(e)).toBe(true);
    // Not even much later: a finished event is finished.
    await age(e.id, 60);
    expect(await alreadyProcessed(e)).toBe(true);
  });

  it("hands an abandoned claim to a later retry", async () => {
    const e = event("abandoned");
    expect(await alreadyProcessed(e)).toBe(false);

    // The instance died here: claimed, never stamped. Stripe retries later.
    await age(e.id, 30);
    expect(await alreadyProcessed(e)).toBe(false);

    const row = await rawDb.processedStripeEvent.findUniqueOrThrow({ where: { id: e.id } });
    // Re-claimed, so a retry that arrives now steps back again.
    expect(row.processedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(row.completedAt).toBeNull();
    expect(await alreadyProcessed(e)).toBe(true);
  });

  it("only one of several retries takes over an abandoned claim", async () => {
    const e = event("race");
    await alreadyProcessed(e);
    await age(e.id, 30);

    const results = await Promise.all([alreadyProcessed(e), alreadyProcessed(e), alreadyProcessed(e)]);
    expect(results.filter((skipped) => !skipped)).toHaveLength(1);
  });

  it("a handler that failed outright is retried at once", async () => {
    const e = event("failed");
    expect(await alreadyProcessed(e)).toBe(false);

    // What the route does when the handler throws: drop the claim so Stripe's
    // next delivery is handled rather than waiting the claim out.
    await forgetProcessed(e.id);
    expect(await alreadyProcessed(e)).toBe(false);
  });
});
