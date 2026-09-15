import { describe, it, expect, afterAll } from "vitest";
import { rawDb } from "@/lib/db";
import { rateLimit, sweepExpiredRateLimits } from "@/lib/rate-limit";

const prefix = `test-rl-${Date.now()}`;

describe("Postgres-backed rate limiter", () => {
  afterAll(async () => {
    await rawDb.rateLimitBucket.deleteMany({ where: { key: { startsWith: prefix } } });
  });

  it("allows up to the limit, then refuses", async () => {
    const key = `${prefix}:basic`;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await rateLimit(key, 3, 60_000));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false]);
    expect(results[2]!.remaining).toBe(0);
  });

  it("keeps separate counters per key", async () => {
    await rateLimit(`${prefix}:a`, 1, 60_000);
    expect((await rateLimit(`${prefix}:a`, 1, 60_000)).ok).toBe(false);
    expect((await rateLimit(`${prefix}:b`, 1, 60_000)).ok).toBe(true);
  });

  /**
   * No sleeping: the window is moved into the past directly. A real-time wait
   * made this depend on machine speed — two slow round-trips could outlast a
   * short window and turn a correct refusal into a pass.
   */
  it("opens a fresh window once the old one expires", async () => {
    const key = `${prefix}:window`;
    expect((await rateLimit(key, 1, 60_000)).ok).toBe(true);
    expect((await rateLimit(key, 1, 60_000)).ok).toBe(false);

    await rawDb.$executeRaw`UPDATE "RateLimitBucket" SET "resetAt" = NOW() - INTERVAL '1 second' WHERE "key" = ${key}`;

    const reopened = await rateLimit(key, 1, 60_000);
    expect(reopened.ok).toBe(true);
    expect((await rawDb.rateLimitBucket.findUnique({ where: { key } }))!.count).toBe(1);
  });

  /**
   * The reason this is one atomic statement: with read-then-write, parallel
   * requests all read "under the limit" and all pass. An attacker firing
   * sign-in attempts concurrently must still be capped at the limit.
   */
  it("holds the limit under concurrent requests", async () => {
    const key = `${prefix}:burst`;
    const results = await Promise.all(Array.from({ length: 25 }, () => rateLimit(key, 10, 60_000)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    const row = await rawDb.rateLimitBucket.findUnique({ where: { key } });
    expect(row!.count).toBe(25);
  });

  it("sweeps only expired counters", async () => {
    await rawDb.$executeRaw`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt") VALUES
        (${`${prefix}:live`}, 1, NOW() + INTERVAL '1 hour'),
        (${`${prefix}:dead`}, 1, NOW() - INTERVAL '1 hour')`;

    await sweepExpiredRateLimits();

    expect(await rawDb.rateLimitBucket.findUnique({ where: { key: `${prefix}:live` } })).not.toBeNull();
    expect(await rawDb.rateLimitBucket.findUnique({ where: { key: `${prefix}:dead` } })).toBeNull();
  });
});
