import "server-only";
import { rawDb } from "@/lib/db";
import { sweepExpiredRateLimits } from "@/lib/rate-limit";
import { IMPERSONATION_MAX_MS } from "@/lib/impersonation-policy";
import { getTenantDb } from "@/lib/tenant-db";
import { releaseFailedOrder } from "@/lib/order-completion";
import { runMarketing } from "@/lib/cron/marketing";
import { PAST_DUE_GRACE_MS } from "@/lib/membership-status";
import { notifyMembershipSuspended } from "@/lib/client-notifications";
import { applyDuePriceChanges } from "@/lib/membership-price-rollout";
import { EXPIRY_REMINDER_DAYS } from "@/lib/package-pricing";
import { notifySessionsExpiring } from "@/lib/client-notifications";
import { formatDay } from "@/lib/client-format";
import { describeError, vercelConfig, vercelDomainsApi } from "@/lib/vercel-domains";
import { forgetClinicHosts } from "@/lib/clinic-hosts";
import { writeAuditLog } from "@/lib/audit";
import { logDomain } from "@/lib/signin-log";

/** How long an unpaid order may hold stock and redeemed points. */
const ABANDONED_ORDER_MS = 60 * 60 * 1000;

/**
 * How long a membership may wait for its first payment. Longer than Stripe's
 * own patience with an unpaid first invoice (about a day), so this only ever
 * catches sign-ups whose incomplete_expired event never reached us.
 */
const ABANDONED_SIGNUP_MS = 36 * 60 * 60 * 1000;

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

  /**
   * Every few minutes: scheduled campaigns and today's birthdays. Held back
   * during the quiet hours, and safe to run twice — see lib/cron/marketing.ts.
   */
  async marketing() {
    return runMarketing();
  },

  /**
   * Hourly: memberships whose grace period has run out.
   *
   * Stripe keeps retrying a failed card for weeks, which is its business, but
   * a clinic should not keep giving away treatment for weeks. A membership
   * that has been past due longer than the grace period stops here. It is not
   * cancelled — the subscription still exists, and a payment that finally
   * succeeds turns it straight back on through invoice.paid.
   */
  async memberships() {
    const cutoff = new Date(Date.now() - PAST_DUE_GRACE_MS);
    const expired = await rawDb.customerMembership.findMany({
      where: { status: "PAST_DUE", pastDueSince: { lt: cutoff } },
      select: { id: true },
      take: 500,
    });

    let suspended = 0;
    for (const membership of expired) {
      // Conditional, so a payment that landed a moment ago wins over this.
      const { count } = await rawDb.customerMembership.updateMany({
        where: { id: membership.id, status: "PAST_DUE", pastDueSince: { lt: cutoff } },
        data: { status: "SUSPENDED", dunningState: "Suspended after the grace period" },
      });
      if (count === 0) continue;
      suspended += count;

      const row = await rawDb.customerMembership.findUnique({ where: { id: membership.id }, select: { tenantId: true } });
      if (row) {
        await rawDb.membershipBillingEvent.create({
          data: {
            tenantId: row.tenantId,
            customerMembershipId: membership.id,
            type: "STATUS_CHANGE",
            description: "Suspended: payment still outstanding after the grace period",
          } as never,
        });
      }
      await notifyMembershipSuspended(membership.id).catch(() => undefined);
    }

    /**
     * Sign-ups whose first payment never happened.
     *
     * Stripe gives up on an unpaid first invoice after about a day and says so
     * with incomplete_expired, which frees the client straight away. This is
     * the backstop for when that event never arrives — a membership nobody
     * paid for must not block someone from ever joining again.
     */
    const stale = await rawDb.customerMembership.updateMany({
      where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - ABANDONED_SIGNUP_MS) } },
      data: { status: "CANCELLED", cancelledAt: new Date(), dunningState: "First payment never completed" },
    });

    /**
     * Price changes that had to wait for an invoice to go out.
     *
     * A member whose next payment came too soon to warn them about pays the
     * old price that one last time; the switch is made at Stripe afterwards,
     * so the bill they were told about is the first one at the new price.
     */
    const prices = await applyDuePriceChanges(new Date());

    /**
     * Session packages about to run out.
     *
     * A fortnight before the end date, and only while there is something left
     * to use — telling somebody their empty package is expiring is noise.
     * expiryReminderSentAt is what makes it once rather than once a day, and
     * it is written whether or not the push lands, because a client with
     * notifications off should not be queued up forever.
     */
    const now = new Date();
    const expiringSoon = await rawDb.customerPackage.findMany({
      where: {
        status: "ACTIVE",
        remainingUses: { gt: 0 },
        expiryReminderSentAt: null,
        expiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRY_REMINDER_DAYS * 86_400_000) },
      },
      select: {
        id: true,
        customerProfileId: true,
        remainingUses: true,
        expiresAt: true,
        package: { select: { name: true } },
      },
      take: 500,
    });

    let expiryReminders = 0;
    for (const row of expiringSoon) {
      // Claimed first: two overlapping runs must not both send.
      const { count } = await rawDb.customerPackage.updateMany({
        where: { id: row.id, expiryReminderSentAt: null },
        data: { expiryReminderSentAt: now },
      });
      if (count === 0) continue;
      expiryReminders += 1;
      await notifySessionsExpiring(
        row.customerProfileId,
        row.package.name,
        row.remainingUses,
        formatDay(row.expiresAt!, null),
      ).catch(() => undefined);
    }

    /** Packages whose date has passed: marked once, so the app can file them. */
    const expiredPackages = await rawDb.customerPackage.updateMany({
      where: { status: "ACTIVE", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });

    return {
      suspended,
      considered: expired.length,
      abandonedSignups: stale.count,
      priceChangesApplied: prices.applied,
      priceChangesFailed: prices.failed,
      packageExpiryReminders: expiryReminders,
      packagesExpired: expiredPackages.count,
    };
  },
  /**
   * Hourly: look again at clinic domains that have not verified yet.
   *
   * Verification is not instant — DNS takes minutes, sometimes longer — and
   * nobody should have to sit on the page pressing "Check now". A domain
   * that starts working at three in the morning should be routing by four.
   *
   * Only PENDING ones, and only while Vercel is configured. A FAILED domain
   * is waiting for a person to read why and do something; retrying it in a
   * loop would just overwrite that reason with the same one.
   */
  async domains(): Promise<CronResult> {
    const config = vercelConfig();
    if (!config) return { skipped: "Vercel is not configured", checked: 0, verified: 0, failed: 0 };

    const pending = await rawDb.clinicDomain.findMany({ where: { status: "PENDING" }, select: { id: true, host: true, tenantId: true } });
    if (pending.length === 0) return { checked: 0, verified: 0, failed: 0 };

    const api = vercelDomainsApi(config);
    let verified = 0;
    let failed = 0;

    for (const domain of pending) {
      try {
        const result = await api.verify(domain.host);
        await rawDb.clinicDomain.update({
          where: { id: domain.id },
          data: {
            status: result.verified ? "VERIFIED" : "PENDING",
            verification: result.verification as never,
            lastCheckedAt: new Date(),
            ...(result.verified ? { verifiedAt: new Date(), lastError: null } : {}),
          },
        });
        if (result.verified) {
          verified += 1;
          forgetClinicHosts();
          await writeAuditLog({
            tenantId: domain.tenantId,
            actorUserId: null,
            actorType: "SYSTEM",
            action: "clinic.domain_verified",
            entityType: "ClinicDomain",
            entityId: domain.id,
            metadata: { host: domain.host, by: "cron" },
          });
          logDomain("verified");
        }
      } catch (err) {
        // One domain Vercel cannot answer for must not stop the others.
        failed += 1;
        await rawDb.clinicDomain.update({
          where: { id: domain.id },
          data: { lastCheckedAt: new Date(), lastError: describeError(err) },
        });
        logDomain("check_failed");
      }
    }

    return { checked: pending.length, verified, failed };
  },
};
