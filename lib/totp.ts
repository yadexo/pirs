import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238, on top of HOTP/RFC 4226) and backup codes, hand-rolled —
 * the same reasoning as the rest of this codebase's security primitives
 * (password hashing aside, which genuinely needs a vetted, slow, salted
 * algorithm bcryptjs already provides): this is ~60 lines of well-specified,
 * widely-interoperable arithmetic, not worth a dependency for. Any
 * authenticator app (Google Authenticator, Authy, 1Password, Apple's own)
 * implements the identical spec and will produce the same codes.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh secret for a new enrollment — 160 bits, the size every authenticator app expects. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    (((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff)) %
    10 ** DIGITS;
  return code.toString().padStart(DIGITS, "0");
}

/** The current code — for the setup page's own preview, and for tests. */
export function totpCode(secretBase32: string, time: number = Date.now()): string {
  return hotp(base32Decode(secretBase32), Math.floor(time / 1000 / STEP_SECONDS));
}

/**
 * Accepts a code from the current step or one step either side (±30s), so a
 * phone's clock being slightly off — the single most common real-world TOTP
 * failure — doesn't lock someone out.
 */
export function verifyTotp(secretBase32: string, code: string, time: number = Date.now(), window = 1): boolean {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(time / 1000 / STEP_SECONDS);
  const key = base32Decode(secretBase32);
  const given = Buffer.from(normalized);
  for (let i = -window; i <= window; i++) {
    const expected = Buffer.from(hotp(key, counter + i));
    if (timingSafeEqual(expected, given)) return true;
  }
  return false;
}

/** What an authenticator app's QR code (or manual-entry fallback) encodes. */
export function totpUri(secretBase32: string, accountLabel: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --------------------------------------------------------------- backup codes

/** "7GQJK-4RXTM" style — easy to read off a screen and type once, each good for one sign-in. */
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Case- and dash-insensitive, so "7gqjk4rxtm" types the same as what was shown. */
export function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * A fast one-way hash, not bcrypt: a backup code is random and high-entropy
 * (unlike a chosen password), so it needs no slow, salted work to resist
 * guessing — only to not be stored in the clear.
 */
export function hashBackupCode(code: string): string {
  return createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}
