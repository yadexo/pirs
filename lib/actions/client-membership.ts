"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, requireMerchantAction, runAction, type ActionResult } from "@/lib/merchant-action";
import { MEMBERSHIP_HOLDS_SLOT, membershipGivesBenefits } from "@/lib/membership-status";
import {
  addBillingPeriods,
  cancelAtPeriodEnd,
  cancelMembershipSubscription,
  currentPeriodEndOf,
  ensureStripePrice,
  pauseCollection,
  readSubscription,
  skipBillingUntil,
  switchSubscriptionPrice,
} from "@/lib/memberships-billing";
import { notifyMembershipChanged } from "@/lib/client-notifications";
import { tenantCurrency } from "@/lib/currency";
import { getTenantDb } from "@/lib/tenant-db";

/**
 * A clinic managing one client's membership.
 *
 * Everything here changes something the client is paying for, so it goes to
 * Stripe first and our row second: Stripe owns the schedule and the money,
 * and the webhook that follows is what settles any disagreement. Writing our
 * side first and telling Stripe afterwards is how a database ends up claiming
 * somebody is cancelled while their card is still being charged.
 *
 * Every change needs a reason, is written to the membership's billing history
 * with the staff member's name, goes to the audit log, and is told to the
 * client.
 */

const reason = z.string().trim().min(1, "A reason is required").max(200, "Keep the reason under 200 characters");

export interface MembershipBillingRow {
  id: string;
  type: string;
  amountCents: number | null;
  description: string | null;
  at: string;
}

export interface ClientMembershipView {
  id: string;
  planId: string;
  planName: string;
  status: string;
  priceCents: number;
  frequency: string;
  currency: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  pastDueSince: string | null;
  givesBenefits: boolean;
  /** Set when this membership is billed by Stripe rather than the mock. */
  stripeSubscriptionId: string | null;
  history: MembershipBillingRow[];
}

export interface PlanOption {
  id: string;
  name: string;
  priceCents: number;
  frequency: string;
}

/** The client's membership as it stands, with the plans they could move to. */
export async function clientMembershipAction(
  merchantId: string,
  customerProfileId: string,
): Promise<ActionResult<{ membership: ClientMembershipView | null; plans: PlanOption[] }>> {
  return runAction(async () => {
    const ctx = await requireMerchantAction(merchantId, "customers.view");

    const [membership, plans, currency] = await Promise.all([
      ctx.db.customerMembership.findFirst({
        where: { customerProfileId, status: { in: [...MEMBERSHIP_HOLDS_SLOT] } },
        orderBy: { startedAt: "desc" },
        include: {
          membershipPlan: { select: { id: true, name: true, priceCents: true, billingFrequency: true } },
          billingEvents: { orderBy: { occurredAt: "desc" }, take: 50 },
        },
      }),
      ctx.db.membershipPlan.findMany({
        where: { active: true, archivedAt: null },
        orderBy: { priceCents: "asc" },
        select: { id: true, name: true, priceCents: true, billingFrequency: true },
      }),
      tenantCurrency(ctx.db),
    ]);

    return {
      membership: membership
        ? {
            id: membership.id,
            planId: membership.membershipPlanId,
            planName: membership.membershipPlan?.name ?? "Plan",
            status: membership.status,
            priceCents: membership.membershipPlan?.priceCents ?? 0,
            frequency: membership.membershipPlan?.billingFrequency ?? "MONTHLY",
            currency,
            currentPeriodStart: membership.currentPeriodStart.toISOString(),
            currentPeriodEnd: membership.currentPeriodEnd.toISOString(),
            nextBillingAt: membership.nextBillingAt?.toISOString() ?? null,
            cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
            cancelledAt: membership.cancelledAt?.toISOString() ?? null,
            pastDueSince: membership.pastDueSince?.toISOString() ?? null,
            givesBenefits: membershipGivesBenefits(membership),
            stripeSubscriptionId: membership.stripeSubscriptionId,
            history: membership.billingEvents.map((e) => ({
              id: e.id,
              type: e.type,
              amountCents: e.amountCents,
              description: e.description,
              at: e.occurredAt.toISOString(),
            })),
          }
        : null,
      plans: plans.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents, frequency: p.billingFrequency })),
    };
  });
}

/** The membership, the clinic's Stripe account, and the staff member's name. */
async function openMembership(merchantId: string, membershipId: string, permission: "memberships.manage") {
  const ctx = await requireMerchantAction(merchantId, permission);
  const membership = await ctx.db.customerMembership.findFirst({
    where: { id: membershipId },
    include: { membershipPlan: { select: { id: true, name: true, billingFrequency: true, priceCents: true } } },
  });
  if (!membership) throw new ActionError("That membership no longer exists.");

  const clinic = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { id: true, stripeAccountId: true, membershipFeePercent: true } });
  const staff = ctx.user.staffProfileId
    ? await ctx.db.staffProfile.findFirst({ where: { id: ctx.user.staffProfileId }, select: { firstName: true, lastName: true } })
    : null;
  const staffName = staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : "a staff member";

  return { ctx, membership, clinic, staffName };
}

/** One line in the membership's own history, naming who did it and why. */
async function record(
  tenantId: string,
  membershipId: string,
  description: string,
  type: "STATUS_CHANGE" | "CHARGE" | "CREDIT_GRANT" = "STATUS_CHANGE",
): Promise<void> {
  await rawDb.membershipBillingEvent.create({
    data: { tenantId, customerMembershipId: membershipId, type, description, occurredAt: new Date() } as never,
  });
}

const cancelInput = z.object({ when: z.enum(["now", "period_end"]), reason });

/**
 * Ends a membership, either on the spot or when the paid-for period runs out.
 *
 * "At the end of the period" is the kinder default for a client who has
 * already paid: they keep what they bought, and nothing more is taken.
 */
export async function cancelClientMembershipAction(
  merchantId: string,
  membershipId: string,
  input: z.input<typeof cancelInput>,
): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const { ctx, membership, clinic, staffName } = await openMembership(merchantId, membershipId, "memberships.manage");
    const { when, reason: why } = cancelInput.parse(input);

    if (membership.status === "CANCELLED") throw new ActionError("That membership has already ended.");

    const onStripe = clinic?.stripeAccountId && membership.stripeSubscriptionId?.startsWith("sub_");
    if (onStripe) {
      try {
        if (when === "now") await cancelMembershipSubscription(clinic!.stripeAccountId!, membership.stripeSubscriptionId!);
        else await cancelAtPeriodEnd(clinic!.stripeAccountId!, membership.stripeSubscriptionId!, true);
      } catch (err) {
        console.error("[membership] Stripe refused the cancellation:", err instanceof Error ? err.message : err);
        throw new ActionError("The payment provider wouldn't accept that. Nothing has been changed.");
      }
    }

    const status = when === "now" ? "CANCELLED" : membership.status;
    await ctx.db.customerMembership.updateMany({
      where: { id: membershipId },
      data:
        when === "now"
          ? { status: "CANCELLED", cancelledAt: new Date(), cancelAtPeriodEnd: false }
          : { cancelAtPeriodEnd: true },
    });

    const ends = membership.currentPeriodEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    const line = when === "now" ? `Cancelled by ${staffName}: ${why}` : `Set to end on ${ends} by ${staffName}: ${why}`;
    await record(merchantId, membershipId, line);
    await ctx.audit("membership.cancelled", "CustomerMembership", membershipId, { when, reason: why });
    await notifyMembershipChanged(membershipId, when === "now" ? "Your membership has ended." : `Your membership will end on ${ends}.`, why).catch(
      (err) => console.error("[membership] notice not sent:", err instanceof Error ? err.message : err),
    );

    revalidatePath(`/m/${merchantId}/clients`);
    return { status };
  });
}

const pauseInput = z.object({ reason });

/** Stops the billing and the benefits, without ending the membership. */
export async function pauseClientMembershipAction(
  merchantId: string,
  membershipId: string,
  input: z.input<typeof pauseInput>,
): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const { ctx, membership, clinic, staffName } = await openMembership(merchantId, membershipId, "memberships.manage");
    const { reason: why } = pauseInput.parse(input);

    if (membership.status === "PAUSED") throw new ActionError("That membership is already paused.");
    if (membership.status === "CANCELLED") throw new ActionError("That membership has ended.");

    if (clinic?.stripeAccountId && membership.stripeSubscriptionId?.startsWith("sub_")) {
      try {
        await pauseCollection(clinic.stripeAccountId, membership.stripeSubscriptionId, true);
      } catch (err) {
        console.error("[membership] Stripe refused the pause:", err instanceof Error ? err.message : err);
        throw new ActionError("The payment provider wouldn't accept that. Nothing has been changed.");
      }
    }

    await ctx.db.customerMembership.updateMany({ where: { id: membershipId }, data: { status: "PAUSED", pausedAt: new Date() } });
    await record(merchantId, membershipId, `Paused by ${staffName}: ${why}`);
    await ctx.audit("membership.paused", "CustomerMembership", membershipId, { reason: why });
    await notifyMembershipChanged(membershipId, "Your membership is paused — nothing will be charged while it is.", why).catch(() => undefined);

    revalidatePath(`/m/${merchantId}/clients`);
    return { status: "PAUSED" };
  });
}

/** Starts the billing and the benefits again. */
export async function resumeClientMembershipAction(
  merchantId: string,
  membershipId: string,
  input: z.input<typeof pauseInput>,
): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const { ctx, membership, clinic, staffName } = await openMembership(merchantId, membershipId, "memberships.manage");
    const { reason: why } = pauseInput.parse(input);

    if (membership.status !== "PAUSED") throw new ActionError("That membership isn't paused.");

    if (clinic?.stripeAccountId && membership.stripeSubscriptionId?.startsWith("sub_")) {
      try {
        await pauseCollection(clinic.stripeAccountId, membership.stripeSubscriptionId, false);
      } catch (err) {
        console.error("[membership] Stripe refused the resume:", err instanceof Error ? err.message : err);
        throw new ActionError("The payment provider wouldn't accept that. Nothing has been changed.");
      }
    }

    await ctx.db.customerMembership.updateMany({
      where: { id: membershipId },
      data: { status: "ACTIVE", pausedAt: null, resumesAt: null },
    });
    await record(merchantId, membershipId, `Resumed by ${staffName}: ${why}`);
    await ctx.audit("membership.resumed", "CustomerMembership", membershipId, { reason: why });
    await notifyMembershipChanged(membershipId, "Your membership is active again.", why).catch(() => undefined);

    revalidatePath(`/m/${merchantId}/clients`);
    return { status: "ACTIVE" };
  });
}

const switchInput = z.object({ planId: z.string().min(1, "Pick a plan"), reason });

/**
 * Moves the client onto another plan from their next billing period.
 *
 * Nothing is charged or refunded in the middle of a period they have already
 * paid for: they keep the plan they bought until it runs out, and the new one
 * starts when the next payment would have been taken anyway.
 */
export async function switchClientPlanAction(
  merchantId: string,
  membershipId: string,
  input: z.input<typeof switchInput>,
): Promise<ActionResult<{ planId: string }>> {
  return runAction(async () => {
    const { ctx, membership, clinic, staffName } = await openMembership(merchantId, membershipId, "memberships.manage");
    const { planId, reason: why } = switchInput.parse(input);

    if (planId === membership.membershipPlanId) throw new ActionError("They're already on that plan.");
    if (membership.status === "CANCELLED") throw new ActionError("That membership has ended.");

    const plan = await ctx.db.membershipPlan.findFirst({ where: { id: planId, active: true, archivedAt: null } });
    if (!plan) throw new ActionError("That plan is no longer available.");

    if (clinic?.stripeAccountId && membership.stripeSubscriptionId?.startsWith("sub_")) {
      try {
        const currency = await tenantCurrency(ctx.db);
        const priceId = await ensureStripePrice(
          { id: clinic.id, stripeAccountId: clinic.stripeAccountId, membershipFeePercent: clinic.membershipFeePercent },
          plan,
          currency,
        );
        await switchSubscriptionPrice(clinic.stripeAccountId, membership.stripeSubscriptionId, priceId);
      } catch (err) {
        console.error("[membership] Stripe refused the plan change:", err instanceof Error ? err.message : err);
        throw new ActionError("The payment provider wouldn't accept that. Nothing has been changed.");
      }
    }

    // The plan on our row changes now; the price only bites at the next
    // period, which is what Stripe was told and what the client is told.
    await ctx.db.customerMembership.updateMany({ where: { id: membershipId }, data: { membershipPlanId: planId } });

    const from = membership.currentPeriodEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    await record(merchantId, membershipId, `Moved from ${membership.membershipPlan?.name ?? "their plan"} to ${plan.name} by ${staffName}: ${why}`);
    await ctx.audit("membership.plan_changed", "CustomerMembership", membershipId, { from: membership.membershipPlanId, to: planId, reason: why });
    await notifyMembershipChanged(membershipId, `You're moving to ${plan.name} from ${from}. Nothing changes before then.`, why).catch(() => undefined);

    revalidatePath(`/m/${merchantId}/clients`);
    return { planId };
  });
}

const freeInput = z.object({
  periods: z
    .string()
    .trim()
    .min(1, "How many periods?")
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0 && n <= 12, "Between 1 and 12 periods"),
  reason,
});

/**
 * Gives the client free time: the next payments are skipped and the benefits
 * carry on, which is what a clinic means by making something right.
 */
export async function giveFreePeriodsAction(
  merchantId: string,
  membershipId: string,
  input: z.input<typeof freeInput>,
): Promise<ActionResult<{ nextBillingAt: string }>> {
  return runAction(async () => {
    const { ctx, membership, clinic, staffName } = await openMembership(merchantId, membershipId, "memberships.manage");
    const { periods, reason: why } = freeInput.parse(input);

    if (membership.status === "CANCELLED") throw new ActionError("That membership has ended.");

    const frequency = membership.membershipPlan?.billingFrequency ?? "MONTHLY";
    let until = addBillingPeriods(membership.currentPeriodEnd, periods, frequency);

    if (clinic?.stripeAccountId && membership.stripeSubscriptionId?.startsWith("sub_")) {
      try {
        // From what Stripe thinks the period is, not from our copy of it.
        const subscription = await readSubscription(clinic.stripeAccountId, membership.stripeSubscriptionId);
        if (subscription) until = addBillingPeriods(currentPeriodEndOf(subscription), periods, frequency);
        await skipBillingUntil(clinic.stripeAccountId, membership.stripeSubscriptionId, until);
      } catch (err) {
        console.error("[membership] Stripe refused the free periods:", err instanceof Error ? err.message : err);
        throw new ActionError("The payment provider wouldn't accept that. Nothing has been changed.");
      }
    }

    await ctx.db.customerMembership.updateMany({
      where: { id: membershipId },
      data: { currentPeriodEnd: until, nextBillingAt: until },
    });

    const when = until.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const label = `${periods} ${frequency === "MONTHLY" ? "month" : "year"}${periods === 1 ? "" : "s"}`;
    await record(merchantId, membershipId, `${label} free, given by ${staffName}: ${why}`);
    await ctx.audit("membership.free_periods", "CustomerMembership", membershipId, { periods, until: until.toISOString(), reason: why });
    await notifyMembershipChanged(membershipId, `You've been given ${label} free — your next payment is ${when}.`, why).catch(() => undefined);

    revalidatePath(`/m/${merchantId}/clients`);
    return { nextBillingAt: until.toISOString() };
  });
}

/** Used by the tests and the cron: the tenant-scoped client for a clinic. */
export async function membershipDb(merchantId: string) {
  return getTenantDb(merchantId);
}
