import "server-only";
import { rawDb } from "@/lib/db";

/**
 * Fixed-window rate limiter for sensitive endpoints (sign-in, registration,
 * uploads). Counters live in Postgres so the limit is shared by every server
 * instance — an in-memory map would give each instance its own allowance.
 *
 * One atomic upsert per call: the first hit in a window inserts count=1, a
 * hit after the window has expired resets it, anything else increments. Two
 * concurrent requests cannot both read "under the limit" and both pass.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; remaining: number }> {
  const rows = await rawDb.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
    VALUES (${key}, 1, NOW() + (${windowMs} * INTERVAL '1 millisecond'))
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimitBucket"."resetAt" <= NOW() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= NOW()
                       THEN NOW() + (${windowMs} * INTERVAL '1 millisecond')
                       ELSE "RateLimitBucket"."resetAt" END
    RETURNING "count"
  `;
  const count = Number(rows[0]?.count ?? 1);
  return { ok: count <= limit, remaining: Math.max(0, limit - count) };
}

/**
 * Deletes counters whose window has closed. Run by the cleanup cron job.
 *
 * Compares against the database's clock, the same clock that set each window.
 * Using the app server's clock here would let two drifting clocks decide
 * whether a live counter gets deleted early.
 */
export async function sweepExpiredRateLimits(): Promise<number> {
  return rawDb.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "resetAt" <= NOW()`;
}
