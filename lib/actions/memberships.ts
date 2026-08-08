"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext, requirePermission, requireCustomerContext } from "@/lib/rbac";
import { getPaymentProvider } from "@/lib/providers/payments";
import { writeAuditLog } from "@/lib/audit";

const planSchema = z.object({
  name: z.string().min(1, "Name is required").max(160),
  description: z.string().max(2000).optional(),
  billingFrequency: z.enum(["MONTHLY", "ANNUAL"]),
  serviceDiscountPercent: z.coerce.number().int().min(0).max(100).optional(),
  productDiscountPercent: z.coerce.number().int().min(0).max(100).optional(),
  minimumCommitmentMonths: z.coerce.number().int().min(1).optional(),
  maxPauseMonths: z.coerce.number().int().min(1).optional(),
  cancellationPolicy: z.string().max(1000).optional(),
});

export async function createMembershipPlanAction(_prevState: unknown, formData: FormData) {
  await requirePermission("memberships.manage");
  const { db } = await requireStaffContext();

  const parsed = planSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    billingFrequency: formData.get("billingFrequency"),
    serviceDiscountPercent: formData.get("serviceDiscountPercent") || undefined,
    productDiscountPercent: formData.get("productDiscountPercent") || undefined,
    minimumCommitmentMonths: formData.get("minimumCommitmentMonths") || undefined,
    maxPauseMonths: formData.get("maxPauseMonths") || undefined,
    cancellationPolicy: formData.get("cancellationPolicy") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const priceCents = Math.round(Number(formData.get("price") ?? 0) * 100);
  const includedCreditCents = Math.round(Number(formData.get("includedCredit") ?? 0) * 100);
  const priorityAccess = formData.get("priorityAccess") === "on";
  const pauseAllowed = formData.get("pauseAllowed") === "on";
  const includedServiceIds = formData.getAll("includedServiceIds").map(String).filter(Boolean);

  const plan = await db.membershipPlan.create({
    data: { ...parsed.data, priceCents, includedCreditCents, priorityAccess, pauseAllowed } as never,
  });

  if (includedServiceIds.length > 0) {
    await db.membershipBenefit.createMany({
      data: includedServiceIds.map((serviceId) => ({
        membershipPlanId: plan.id,
        type: "INCLUDED_SERVICE",
        serviceId,
        description: "Included in membership",
      })),
    });
  }

  revalidatePath("/admin/memberships");
  return { success: true };
}

export async function archiveMembershipPlanAction(id: string) {
  await requirePermission("memberships.manage");
  const { db } = await requireStaffContext();
  await db.membershipPlan.updateMany({ where: { id }, data: { active: false, archivedAt: new Date() } });
  revalidatePath("/admin/memberships");
}

function periodEnd(start: Date, frequency: "MONTHLY" | "ANNUAL") {
  const end = new Date(start);
  if (frequency === "MONTHLY") end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  return end;
}

export async function joinMembershipAction(tenantSlug: string, planId: string): Promise<{ error: string } | void> {
  const { db, user } = await requireCustomerContext();

  const plan = await db.membershipPlan.findFirst({ where: { id: planId, active: true } });
  if (!plan) return { error: "This membership plan is no longer available." };

  const existing = await db.customerMembership.findFirst({
    where: { customerProfileId: user.customerProfileId!, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "PAUSED"] } },
  });
  if (existing) return { error: "You already have an active membership." };

  const provider = getPaymentProvider();
  const sub = await provider.createSubscription({
    customerRef: user.customerProfileId!,
    planRef: plan.name,
    amountCents: plan.priceCents,
    currency: "USD",
    intervalMonths: plan.billingFrequency === "MONTHLY" ? 1 : 12,
  });

  const now = new Date();
  const membership = await db.customerMembership.create({
    data: {
      customerProfileId: user.customerProfileId!,
      membershipPlanId: plan.id,
      status: "ACTIVE",
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd(now, plan.billingFrequency),
      nextBillingAt: periodEnd(now, plan.billingFrequency),
      creditBalanceCents: plan.includedCreditCents,
      stripeSubscriptionId: sub.providerSubscriptionId,
    } as never,
  });

  await db.membershipBillingEvent.create({
    data: {
      customerMembershipId: membership.id,
      type: "CHARGE",
      amountCents: plan.priceCents,
      description: `${plan.name} — first billing period`,
      occurredAt: now,
    } as never,
  });

  if (plan.includedCreditCents > 0) {
    const profile = await db.customerProfile.findFirst({ where: { id: user.customerProfileId! } });
    const newBalance = (profile?.accountCreditBalanceCents ?? 0) + plan.includedCreditCents;
    await db.customerProfile.updateMany({ where: { id: user.customerProfileId! }, data: { accountCreditBalanceCents: newBalance } });
    await db.accountCreditTransaction.create({
      data: {
        customerProfileId: user.customerProfileId!,
        type: "MEMBERSHIP_GRANT",
        amountCents: plan.includedCreditCents,
        balanceAfterCents: newBalance,
        reason: `${plan.name} membership credit`,
      } as never,
    });
  }

  redirect(`/${tenantSlug}/memberships?joined=1`);
}

export async function pauseMembershipAction(tenantSlug: string, membershipId: string) {
  const { db, user } = await requireCustomerContext();
  const membership = await db.customerMembership.findFirst({
    where: { id: membershipId, customerProfileId: user.customerProfileId! },
    include: { membershipPlan: true },
  });
  if (!membership || !membership.membershipPlan.pauseAllowed) throw new Error("Pausing is not available for this plan.");

  const maxMonths = membership.membershipPlan.maxPauseMonths ?? 1;
  const resumesAt = new Date();
  resumesAt.setMonth(resumesAt.getMonth() + maxMonths);

  await db.customerMembership.updateMany({
    where: { id: membershipId },
    data: { status: "PAUSED", pausedAt: new Date(), resumesAt },
  });
  await db.membershipBillingEvent.create({
    data: { customerMembershipId: membershipId, type: "STATUS_CHANGE", description: "Membership paused" } as never,
  });
  revalidatePath(`/${tenantSlug}/memberships`);
}

export async function resumeMembershipAction(tenantSlug: string, membershipId: string) {
  const { db, user } = await requireCustomerContext();
  const membership = await db.customerMembership.findFirst({
    where: { id: membershipId, customerProfileId: user.customerProfileId! },
  });
  if (!membership) throw new Error("Membership not found.");

  await db.customerMembership.updateMany({
    where: { id: membershipId },
    data: { status: "ACTIVE", pausedAt: null, resumesAt: null },
  });
  await db.membershipBillingEvent.create({
    data: { customerMembershipId: membershipId, type: "STATUS_CHANGE", description: "Membership resumed" } as never,
  });
  revalidatePath(`/${tenantSlug}/memberships`);
}

export async function cancelMembershipAction(tenantSlug: string, membershipId: string) {
  const { db, user } = await requireCustomerContext();
  const membership = await db.customerMembership.findFirst({
    where: { id: membershipId, customerProfileId: user.customerProfileId! },
  });
  if (!membership) throw new Error("Membership not found.");

  if (membership.stripeSubscriptionId) {
    await getPaymentProvider().cancelSubscription(membership.stripeSubscriptionId);
  }

  await db.customerMembership.updateMany({
    where: { id: membershipId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  await db.membershipBillingEvent.create({
    data: { customerMembershipId: membershipId, type: "STATUS_CHANGE", description: "Membership cancelled" } as never,
  });

  await writeAuditLog({
    tenantId: user.tenantId,
    actorUserId: user.id,
    actorType: "SYSTEM",
    action: "membership.cancelled_by_customer",
    entityType: "CustomerMembership",
    entityId: membershipId,
  });

  revalidatePath(`/${tenantSlug}/memberships`);
}
