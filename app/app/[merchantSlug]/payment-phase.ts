/**
 * What the server's answer about an order means for the client's screen.
 *
 * Kept apart from the component because this is the part that must not be
 * wrong: the only thing that may show "paid" is an order the server says is
 * paid. Coming back from a bank, a ?paid=1 in the address, or a Payment
 * Element that resolved are all just the client returning — none of them is
 * money having moved.
 */

export type Phase = "confirming" | "paid" | "failed" | "unknown";

/** Long enough for a webhook, short enough that nobody sits watching a spinner. */
export const POLL_MS = 2000;
export const GIVE_UP_AFTER_MS = 45_000;

export type StatusReading =
  | { error: string }
  | { ok: true; status: string; totalCents: number; pointsEarned: number }
  | null;

export function phaseFor(res: StatusReading): Phase {
  if (!res || "error" in res) return "unknown";
  if (res.status === "PAID") return "paid";
  if (res.status === "FAILED") return "failed";
  // PENDING, AWAITING_PAYMENT, anything new: still waiting, never "paid".
  return "confirming";
}

/** Whether to ask again, or stop and tell the client it will turn up later. */
export function shouldAskAgain(phase: Phase, elapsedMs: number): boolean {
  return phase === "confirming" && elapsedMs <= GIVE_UP_AFTER_MS;
}
