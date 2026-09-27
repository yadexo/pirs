/**
 * The bits of the redeemable-item format that both sides need: the client's
 * app builds a QR from them, the clinic's scanner reads one back.
 *
 * Pure on purpose — no database, no node:crypto — so a browser bundle can
 * import it. Everything that touches data lives in lib/redeemable.ts.
 */

/** Marks a QR as one of ours, and as an item rather than a check-in. */
export const REDEEM_QR_PREFIX = "pirs-item:";

/**
 * No 0/O, 1/I/L or 5/S: this code gets read aloud and typed by a
 * receptionist, and those are the pairs people get wrong.
 */
export const CODE_ALPHABET = "2346789ABCDEFGHJKMNPQRTUVWXYZ";
export const CODE_LENGTH = 8;

/** What the client's QR carries: the prefix and a random token, nothing else. */
export function redeemQrValue(token: string): string {
  return `${REDEEM_QR_PREFIX}${token}`;
}

/**
 * The token inside a scanned code, or null if this isn't one of ours.
 *
 * The prefix is what keeps this apart from the check-in code on the Scan tab,
 * which is a signed `tenant.client.expiry.signature`. A scanner pointed at the
 * wrong kind gets null rather than a confusing near-match.
 */
export function tokenFromScan(value: string): string | null {
  const text = value.trim();
  if (!text.startsWith(REDEEM_QR_PREFIX)) return null;
  const token = text.slice(REDEEM_QR_PREFIX.length);
  return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
}

/** A typed code, tidied: people type lower case and add spaces. */
export function normaliseCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function isBackupCode(value: string): boolean {
  const code = normaliseCode(value);
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}
