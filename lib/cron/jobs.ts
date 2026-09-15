import "server-only";
import { rawDb } from "@/lib/db";
import { sweepExpiredRateLimits } from "@/lib/rate-limit";
import { IMPERSONATION_MAX_MS } from "@/lib/impersonation-policy";

export type CronResult = Record<string, number | string>;

/**
 * Scheduled work, run by whatever scheduler the host provides (Vercel Cron,
 * a Kubernetes CronJob, crontab + curl) calling /api/cron/<name>. Every job
 * must be safe to run twice in a row and safe to skip a run.
 *
 * Later phases register appointment reminders and membership dunning here.
 */
export const CRON_JOBS: Record<string, () => Promise<CronResult>> = {
  /** Hourly: delete expired state that would otherwise accumulate forever. */
  async cleanup() {
    const now = new Date();

    const rateLimits = await sweepExpiredRateLimits();

    // Used or expired reset tokens have no further purpose; keep a day of
    // history for support questions ("I never got the email").
    const { count: resetTokens } = await rawDb.passwordResetToken.deleteMany({
      where: {
        OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }],
        createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });

    // The cookie has expired by now, so the session is over in fact; record
    // the latest moment it could have ended rather than leaving it open.
    const cutoff = new Date(now.getTime() - IMPERSONATION_MAX_MS);
    const stale = await rawDb.impersonationSession.findMany({
      where: { endedAt: null, startedAt: { lt: cutoff } },
      select: { id: true, startedAt: true },
    });
    for (const s of stale) {
      await rawDb.impersonationSession.update({
        where: { id: s.id },
        data: { endedAt: new Date(s.startedAt.getTime() + IMPERSONATION_MAX_MS) },
      });
    }

    return { rateLimits, resetTokens, impersonationsClosed: stale.length };
  },
};
