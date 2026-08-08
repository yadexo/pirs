"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { adjustLoyaltyPoints } from "@/lib/loyalty";
import { writeAuditLog } from "@/lib/audit";

const programmeSchema = z.object({
  name: z.string().min(1).max(120),
  pointsPerDollar: z.coerce.number().min(0),
  pointsPerVisit: z.coerce.number().int().min(0),
  referralPoints: z.coerce.number().int().min(0),
  birthdayPoints: z.coerce.number().int().min(0),
  pointsExpiryDays: z.coerce.number().int().min(1).optional(),
});

export async function upsertLoyaltyProgrammeAction(_prevState: unknown, formData: FormData) {
  await requirePermission("loyalty.adjust");
  const { db, user } = await requireStaffContext();

  const parsed = programmeSchema.safeParse({
    name: formData.get("name"),
    pointsPerDollar: formData.get("pointsPerCents"),
    pointsPerVisit: formData.get("pointsPerVisit"),
    referralPoints: formData.get("referralPoints"),
    birthdayPoints: formData.get("birthdayPoints"),
    pointsExpiryDays: formData.get("pointsExpiryDays") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { pointsPerDollar, ...rest } = parsed.data;
  const data = { ...rest, pointsPerCents: pointsPerDollar / 100 };
  const active = formData.get("active") === "on";
  const existing = await db.loyaltyProgramme.findFirst({ where: {} });

  if (existing) {
    await db.loyaltyProgramme.updateMany({ where: { id: existing.id }, data: { ...data, active } });
  } else {
    await db.loyaltyProgramme.create({ data: { ...data, active } as never });
  }

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "loyalty_programme.updated",
    entityType: "LoyaltyProgramme",
  });

  revalidatePath("/admin/loyalty");
  return { success: true };
}

const rewardSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  pointsCost: z.coerce.number().int().min(1),
  rewardType: z.enum(["DISCOUNT_PERCENT", "DISCOUNT_AMOUNT", "FREE_SERVICE", "FREE_PRODUCT"]),
  discountPercent: z.coerce.number().int().min(1).max(100).optional(),
  serviceId: z.string().optional(),
  productId: z.string().optional(),
});

export async function createLoyaltyRewardAction(_prevState: unknown, formData: FormData) {
  await requirePermission("loyalty.adjust");
  const { db } = await requireStaffContext();

  const parsed = rewardSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    pointsCost: formData.get("pointsCost"),
    rewardType: formData.get("rewardType"),
    discountPercent: formData.get("discountPercent") || undefined,
    serviceId: formData.get("serviceId") || undefined,
    productId: formData.get("productId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const discountAmountCents = formData.get("discountAmount")
    ? Math.round(Number(formData.get("discountAmount")) * 100)
    : undefined;

  const programme = await db.loyaltyProgramme.findFirst({ where: {} });
  if (!programme) return { error: "Set up your loyalty programme before adding rewards." };

  await db.loyaltyReward.create({
    data: { ...parsed.data, discountAmountCents, loyaltyProgrammeId: programme.id } as never,
  });

  revalidatePath("/admin/loyalty");
  return { success: true };
}

export async function archiveLoyaltyRewardAction(id: string) {
  await requirePermission("loyalty.adjust");
  const { db } = await requireStaffContext();
  await db.loyaltyReward.updateMany({ where: { id }, data: { active: false } });
  revalidatePath("/admin/loyalty");
}

export async function manualLoyaltyAdjustmentAction(_prevState: unknown, formData: FormData) {
  await requirePermission("loyalty.adjust");
  const { db, user } = await requireStaffContext();

  const customerProfileId = String(formData.get("customerProfileId") ?? "");
  const points = Number(formData.get("points") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!customerProfileId || !points) return { error: "Enter a non-zero point amount." };
  if (!reason) return { error: "A reason is required for manual adjustments." };

  await adjustLoyaltyPoints(db, {
    customerProfileId,
    points,
    type: "MANUAL_ADJUSTMENT",
    reason,
    performedByStaffProfileId: user.staffProfileId ?? undefined,
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "loyalty.manual_adjustment",
    entityType: "CustomerProfile",
    entityId: customerProfileId,
    reason,
    metadata: { points },
  });

  revalidatePath(`/admin/customers/${customerProfileId}`);
  return { success: true };
}
