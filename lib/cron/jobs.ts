import "server-only";
import { rawDb } from "@/lib/db";
import { sweepExpiredRateLimits } from "@/lib/rate-limit";
import { IMPERSONATION_MAX_MS } from "@/lib/impersonation-policy";
import { getTenantDb } from "@/lib/tenant-db";
import { releaseFailedOrder } from "@/lib/order-completion";

/** How long an unpaid order may hold stock and redeemed points. */
const ABANDONED_ORDER_MS = 60 * 60 * 1000;

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

    // Orders whose payment was never completed — the client closed the tab in
    // the middle of it. Their stock and redeemed points are given back; the
    // webhook does this for payments that actually fail, this is for the ones
    // that simply never finish.
    const abandoned = await rawDb.order.findMany({
      where: { status: "PENDING", placedAt: { lt: new Date(now.getTime() - ABANDONED_ORDER_MS) } },
      select: { id: true, tenantId: true },
      take: 200,
    });
    for (const order of abandoned) {
      await releaseFailedOrder(getTenantDb(order.tenantId), order.id, "the payment was never completed");
    }

    // Stripe only replays an event for a few days; older markers are dead weight.
    const { count: stripeEvents } = await rawDb.processedStripeEvent.deleteMany({
      where: { processedAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } },
    });

    return { rateLimits, resetTokens, impersonationsClosed: stale.length, abandonedOrders: abandoned.length, stripeEvents };
  },
};
