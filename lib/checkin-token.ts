import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** A screenshotted code stops working after this long. */
export const CHECKIN_TOKEN_TTL_SECONDS = 120;

/**
 * A key used only for check-in tokens, derived from AUTH_SECRET. Deriving it
 * keeps a signature made here from being valid anywhere else AUTH_SECRET is
 * used. With no secret configured this throws rather than signing with an
 * empty key, which would let anyone forge a check-in and collect points.
 */
function checkinKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set; cannot sign check-in tokens.");
  return createHmac("sha256", secret).update("deza/checkin-token/v1").digest();
}

function sign(body: string): string {
  return createHmac("sha256", checkinKey()).update(body).digest("base64url");
}

/**
 * `<tenantId>.<customerProfileId>.<expiresAt>.<signature>`. The clinic is part
 * of the signed body, so a code shown at one clinic cannot be scanned at
 * another even if an id were somehow reused.
 */
export function mintCheckinToken(tenantId: string, customerProfileId: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + CHECKIN_TOKEN_TTL_SECONDS;
  const body = `${tenantId}.${customerProfileId}.${expiresAt}`;
  return `${body}.${sign(body)}`;
}

/**
 * Returns the client only if the token is authentic, unexpired, and was issued
 * for `expectedTenantId` — the clinic doing the scanning. Server-side only:
 * this must never be exported from a "use server" module, where it would
 * become a public endpoint.
 */
export function verifyCheckinToken(
  token: string,
  expectedTenantId: string,
  now = Date.now(),
): { customerProfileId: string } | null {
  const parts = token.trim().split(".");
  if (parts.length !== 4) return null;
  const [tenantId, customerProfileId, expiresRaw, signature] = parts as [string, string, string, string];

  const expected = Buffer.from(sign(`${tenantId}.${customerProfileId}.${expiresRaw}`));
  const presented = Buffer.from(signature);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(expiresAt) || expiresAt < Math.floor(now / 1000)) return null;
  if (tenantId !== expectedTenantId) return null;

  return { customerProfileId };
}
