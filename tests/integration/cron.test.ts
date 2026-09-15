import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { IMPERSONATION_MAX_MS } from "@/lib/impersonation-policy";
import { CRON_JOBS } from "@/lib/cron/jobs";
import { GET as cronRoute } from "@/app/api/cron/[job]/route";

const HOUR = 60 * 60 * 1000;
const call = (job: string, auth?: string) =>
  cronRoute(new NextRequest(`http://localhost/api/cron/${job}`, { headers: auth ? { authorization: auth } : {} }), {
    params: Promise.resolve({ job }),
  });

describe("cron", () => {
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const tenant = await rawDb.tenant.create({ data: { slug: `cron-${Date.now()}`, name: "Cron Test" } });
    tenantId = tenant.id;
    const user = await rawDb.user.create({
      data: { email: `cron-admin-${Date.now()}@example.com`, passwordHash: await hashPassword("x"), role: "PLATFORM_ADMIN" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await rawDb.user.delete({ where: { id: userId } });
    await rawDb.tenant.delete({ where: { id: tenantId } });
  });

  describe("endpoint authentication", () => {
    const original = process.env.CRON_SECRET;
    afterEach(() => {
      process.env.CRON_SECRET = original;
    });

    it("refuses every call when CRON_SECRET is not configured", async () => {
      delete process.env.CRON_SECRET;
      expect((await call("cleanup", "Bearer anything")).status).toBe(503);
    });

    it("rejects a missing or wrong secret", async () => {
      process.env.CRON_SECRET = "correct-horse-battery-staple";
      expect((await call("cleanup")).status).toBe(401);
      expect((await call("cleanup", "Bearer wrong")).status).toBe(401);
      // Same length as the real secret, so the length check can't be what rejects it.
      expect("correct-horse-battery-stapl3").toHaveLength("correct-horse-battery-staple".length);
      expect((await call("cleanup", "Bearer correct-horse-battery-stapl3")).status).toBe(401);
    });

    it("runs the job with the right secret", async () => {
      process.env.CRON_SECRET = "correct-horse-battery-staple";
      const res = await call("cleanup", "Bearer correct-horse-battery-staple");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ job: "cleanup", ok: true });
      expect(body.result).toHaveProperty("rateLimits");
    });

    it("404s unknown jobs, including prototype keys", async () => {
      process.env.CRON_SECRET = "s3cret";
      expect((await call("nope", "Bearer s3cret")).status).toBe(404);
      expect((await call("constructor", "Bearer s3cret")).status).toBe(404);
      expect((await call("__proto__", "Bearer s3cret")).status).toBe(404);
    });
  });

  describe("cleanup job", () => {
    it("closes impersonations left open past the cap, at the moment they expired", async () => {
      const startedLongAgo = new Date(Date.now() - IMPERSONATION_MAX_MS - 2 * HOUR);
      const stale = await rawDb.impersonationSession.create({
        data: { actorUserId: userId, merchantId: tenantId, startedAt: startedLongAgo },
      });
      const live = await rawDb.impersonationSession.create({
        data: { actorUserId: userId, merchantId: tenantId, startedAt: new Date(Date.now() - HOUR) },
      });

      const result = await CRON_JOBS.cleanup!();
      expect(Number(result.impersonationsClosed)).toBeGreaterThanOrEqual(1);

      const closed = await rawDb.impersonationSession.findUnique({ where: { id: stale.id } });
      expect(closed!.endedAt!.getTime()).toBe(startedLongAgo.getTime() + IMPERSONATION_MAX_MS);
      expect((await rawDb.impersonationSession.findUnique({ where: { id: live.id } }))!.endedAt).toBeNull();

      // Running twice is harmless.
      await CRON_JOBS.cleanup!();
      const again = await rawDb.impersonationSession.findUnique({ where: { id: stale.id } });
      expect(again!.endedAt!.getTime()).toBe(closed!.endedAt!.getTime());
    });

    it("removes spent reset tokens after a day, and keeps fresh ones", async () => {
      const dayAndABitAgo = new Date(Date.now() - 25 * HOUR);
      const old = await rawDb.passwordResetToken.create({
        data: { userId, tokenHash: `old-${Date.now()}`, expiresAt: new Date(Date.now() - 24 * HOUR), createdAt: dayAndABitAgo },
      });
      const fresh = await rawDb.passwordResetToken.create({
        data: { userId, tokenHash: `fresh-${Date.now()}`, expiresAt: new Date(Date.now() + HOUR) },
      });

      await CRON_JOBS.cleanup!();
      expect(await rawDb.passwordResetToken.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await rawDb.passwordResetToken.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    });
  });
});
