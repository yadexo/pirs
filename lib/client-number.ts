/**
 * The number a client reads out at the desk.
 *
 * Derived from the profile id rather than stored, so there is no new column to
 * keep unique and no backfill: the same client always gets the same number,
 * and it changes only if their profile does. Eight digits, grouped in fours,
 * which is short enough to say down a phone.
 *
 * It identifies, it does not authenticate. The QR code carries a signed,
 * short-lived token and that is what check-in verifies — this is for a human
 * reading a screen, and nothing may be granted on the strength of it.
 *
 * Not searchable in the clinic portal yet; see docs/design/handoff-gaps.md.
 */

/** FNV-1a, for a stable spread over the 8-digit space from any id. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function clientNumber(customerProfileId: string): string {
  const digits = String(hash(customerProfileId) % 100_000_000).padStart(8, "0");
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

/** "DezaAI 4821 3390" — the platform's own white-label name, never a fixed one. */
export function clientNumberLabel(customerProfileId: string, platformName: string): string {
  // A platform with no name of its own contributes nothing, not a space.
  return `${platformName} ${clientNumber(customerProfileId)}`.trim();
}
