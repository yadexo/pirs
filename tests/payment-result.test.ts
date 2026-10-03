import { describe, it, expect } from "vitest";
import { phaseFor, shouldAskAgain, GIVE_UP_AFTER_MS, POLL_MS } from "../app/app/[merchantSlug]/payment-phase";

/**
 * The screen a client sees after paying has three honest answers — confirmed,
 * refused, and not yet — and this is the decision behind them.
 *
 * The invariant worth defending: "paid" comes from the server saying the
 * order is paid, and from nothing else. A client returning from their bank,
 * a redirect flag in the address, or a Payment Element that resolved all
 * mean only that the client is back.
 */
describe("what a payment result means", () => {
  const reading = (status: string) => ({ ok: true as const, status, totalCents: 5_000, pointsEarned: 3 });

  it("confirms a payment only when the server says the order is paid", () => {
    expect(phaseFor(reading("PAID"))).toBe("paid");
  });

  it("holds at confirming while the order is still pending", () => {
    expect(phaseFor(reading("PENDING"))).toBe("confirming");
  });

  it("reports a refused payment", () => {
    expect(phaseFor(reading("FAILED"))).toBe("failed");
  });

  it("never reads an unfamiliar status as paid", () => {
    // A status added later must fall to waiting, not to a success claim.
    for (const s of ["AWAITING_PAYMENT", "PROCESSING", "", "paid", "SOMETHING_NEW"]) {
      expect(phaseFor(reading(s))).toBe("confirming");
    }
  });

  it("says it cannot tell when the order cannot be read", () => {
    expect(phaseFor({ error: "That order no longer exists." })).toBe("unknown");
    expect(phaseFor(null)).toBe("unknown");
  });

  it("keeps asking the server while a payment is unconfirmed", () => {
    expect(shouldAskAgain("confirming", 0)).toBe(true);
    expect(shouldAskAgain("confirming", POLL_MS * 5)).toBe(true);
  });

  it("stops asking once the answer is settled", () => {
    expect(shouldAskAgain("paid", 0)).toBe(false);
    expect(shouldAskAgain("failed", 0)).toBe(false);
    expect(shouldAskAgain("unknown", 0)).toBe(false);
  });

  it("gives up waiting rather than spinning forever", () => {
    expect(shouldAskAgain("confirming", GIVE_UP_AFTER_MS + 1)).toBe(false);
  });
});
