import "server-only";
import { rawDb } from "@/lib/db";
import { getTenantDb } from "@/lib/tenant-db";
import { planPriceChange } from "@/lib/membership-price-change";
import { MEMBERSHIP_HOLDS_SLOT } from "@/lib/membership-status";
import { ensureStripePrice, switchSubscriptionPrice } from "@/lib/memberships-billing";
import { notifyPriceChange } from "@/lib/client-notifications";

/**
 * Moving a clinic's existing members onto a new price.
 *
 * Three promises are kept here, and each one is a decision somebody could get
 * wrong by being helpful:
 *
 *  - nobody pays more without a month's warning, so the date each member's
 *    new price starts is worked out per member (lib/membership-price-change.ts)
 *    rather than once for everybody;
 *  - Stripe is told only when its next invoice is the one the member was
 *    warned about, because switching a price changes the very next bill;
 *  - everybody is told immediately, in their own terms — their price, their
 *    date, and how to leave before it.
 *
 * One member failing does not stop the rest: a clinic that raised its price
 * must not be left with half its members moved and no record of which.
 */

export interface RolloutResult {
  members: number;
  /** Moved at Stripe now, because their next invoice is the right one. */
  appliedNow: number;
  /** Waiting for an invoice to go out first; the cron finishes these. */
  deferred: number;
  notified: number;
  failed: number;
}

export async function rolloutPlanPrice(params: {
  tenantId: string;
  planId: string;
  oldPriceCents: number;
  newPriceCents: number;
  reason: string | null;
  staffProfileId: string | null;
  now?: Date;
}): Promise<RolloutResult> {
  const now = params.now ?? new Date();
  const db = getTenantDb(params.tenantId);

  const [clinic, plan, members] = await Promise.all([
    rawDb.tenant.findUnique({ where: { id: params.tenantId }, select: { id: true, stripeAccountId: true, membershipFeePercent: true } }),
    db.membershipPlan.findFirst({ where: { id: params.planId }, select: { id: true, name: true, priceCents: true, billingFrequency: true, stripeProductId: true, stripePriceId: true } }),
    db.customerMembership.findMany({
      where: { membershipPlanId: params.planId, status: { in: [...MEMBERSHIP_HOLDS_SLOT] } },
      select: { id: true, customerProfileId: true, nextBillingAt: true, currentPeriodEnd: true, stripeSubscriptionId: true },
    }),
  ]);
  if (!plan) return { members: 0, appliedNow: 0, deferred: 0, notified: 0, failed: 0 };

  const currency = (await db.tenantBranding.findFirst({ where: {}, select: { currency: true } }))?.currency ?? "EUR";
  const result: RolloutResult = { members: members.length, appliedNow: 0, deferred: 0, notified: 0, failed: 0 };

  // One price object for the whole rollout rather than one per member.
  let priceId: string | null = null;
  if (clinic?.stripeAccountId) {
    priceId = await ensureStripePrice(
      { id: clinic.id, stripeAccountId: clinic.stripeAccountId, membershipFeePercent: clinic.membershipFeePercent },
      plan,
      currency,
    ).catch((err) => {
      console.error("[price-rollout] could not make the new price at Stripe:", err instanceof Error ? err.message : err);
      return null;
    });
  }

  for (const member of members) {
    try {
      const timing = planPriceChange({
        nextBillingAt: member.nextBillingAt ?? member.currentPeriodEnd,
        frequency: plan.billingFrequency,
        now,
      });

      const onStripe = Boolean(clinic?.stripeAccountId && priceId && member.stripeSubscriptionId?.startsWith("sub_"));

      // Recorded first: if Stripe or the notification fails below, the clinic
      // can still see who was promised what.
      const change = await rawDb.membershipPriceChange.create({
        data: {
          tenantId: params.tenantId,
          customerMembershipId: member.id,
          membershipPlanId: plan.id,
          oldPriceCents: params.oldPriceCents,
          newPriceCents: params.newPriceCents,
          effectiveAt: timing.effectiveAt,
          applyAfter: timing.applyAfter,
          reason: params.reason,
          createdByStaffProfileId: params.staffProfileId,
        },
        select: { id: true },
      });

      if (timing.immediate) {
        if (onStripe) await switchSubscriptionPrice(clinic!.stripeAccountId!, member.stripeSubscriptionId!, priceId!);
        await rawDb.membershipPriceChange.update({ where: { id: change.id }, data: { appliedAt: new Date() } });
        result.appliedNow += 1;
      } else {
        // Left for the cron: telling Stripe now would put the new price on
        // the invoice the member was never warned about.
        result.deferred += 1;
      }

      await notifyPriceChange(member.customerProfileId, {
        planName: plan.name,
        newPriceCents: params.newPriceCents,
        currency,
        effectiveAt: timing.effectiveAt,
      });
      await rawDb.membershipPriceChange.update({ where: { id: change.id }, data: { noticeSentAt: new Date() } });
      result.notified += 1;
    } catch (err) {
      // One member's failure must not strand the rest half-moved.
      console.error(`[price-rollout] membership ${member.id} not moved:`, err instanceof Error ? err.message : err);
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Finishes the changes that had to wait for an invoice to go out.
 *
 * Run from the memberships cron. Safe to run twice: a change is claimed by
 * stamping appliedAt, and only an unclaimed one is sent to Stripe.
 */
export async function applyDuePriceChanges(now = new Date()): Promise<{ applied: number; failed: number }> {
  const due = await rawDb.membershipPriceChange.findMany({
    where: { appliedAt: null, applyAfter: { lte: now } },
    take: 200,
    select: {
      id: true,
      tenantId: true,
      membershipPlanId: true,
      customerMembership: { select: { id: true, stripeSubscriptionId: true } },
    },
  });

  let applied = 0;
  let failed = 0;
  for (const change of due) {
    try {
      // Claim it first, so two overlapping runs cannot both call Stripe.
      const { count } = await rawDb.membershipPriceChange.updateMany({
        where: { id: change.id, appliedAt: null },
        data: { appliedAt: now },
      });
      if (count === 0) continue;

      const [clinic, plan] = await Promise.all([
        rawDb.tenant.findUnique({ where: { id: change.tenantId }, select: { id: true, stripeAccountId: true, membershipFeePercent: true } }),
        rawDb.membershipPlan.findUnique({
          where: { id: change.membershipPlanId },
          select: { id: true, name: true, priceCents: true, billingFrequency: true, stripeProductId: true, stripePriceId: true },
        }),
      ]);

      const subscriptionId = change.customerMembership?.stripeSubscriptionId;
      if (clinic?.stripeAccountId && plan && subscriptionId?.startsWith("sub_")) {
        const currency =
          (await rawDb.tenantBranding.findFirst({ where: { tenantId: change.tenantId }, select: { currency: true } }))?.currency ?? "EUR";
        const priceId = await ensureStripePrice(
          { id: clinic.id, stripeAccountId: clinic.stripeAccountId, membershipFeePercent: clinic.membershipFeePercent },
          plan,
          currency,
        );
        await switchSubscriptionPrice(clinic.stripeAccountId, subscriptionId, priceId);
      }
      applied += 1;
    } catch (err) {
      // Put it back so the next run tries again rather than losing it.
      await rawDb.membershipPriceChange.updateMany({ where: { id: change.id }, data: { appliedAt: null } }).catch(() => undefined);
      console.error(`[price-rollout] deferred change ${change.id} failed:`, err instanceof Error ? err.message : err);
      failed += 1;
    }
  }

  return { applied, failed };
}
