"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaffContext, requirePermission } from "@/lib/rbac";

const promotionSchema = z.object({
  title: z.string().min(1, "Title is required").max(160),
  description: z.string().max(2000).optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  discountType: z.enum(["PERCENT", "FIXED_AMOUNT"]),
  code: z.string().max(40).optional(),
  usageLimit: z.coerce.number().int().min(1).optional(),
  perCustomerLimit: z.coerce.number().int().min(1).optional(),
  customerSegment: z.enum(["ALL", "NEW", "MEMBERS", "NON_MEMBERS", "TAGGED"]),
});

export async function createPromotionAction(_prevState: unknown, formData: FormData) {
  await requirePermission("promotions.create");
  const { db } = await requireStaffContext();

  const parsed = promotionSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    startAt: formData.get("startAt"),
    endAt: formData.get("endAt"),
    discountType: formData.get("discountType"),
    code: formData.get("code") || undefined,
    usageLimit: formData.get("usageLimit") || undefined,
    perCustomerLimit: formData.get("perCustomerLimit") || undefined,
    customerSegment: formData.get("customerSegment") || "ALL",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  if (parsed.data.endAt <= parsed.data.startAt) return { error: "End date must be after the start date." };

  const discountValue =
    parsed.data.discountType === "PERCENT"
      ? Number(formData.get("discountPercent") ?? 0)
      : Math.round(Number(formData.get("discountAmount") ?? 0) * 100);
  if (discountValue <= 0) return { error: "Enter a discount value." };

  const appOnly = formData.get("appOnly") === "on";
  const serviceIds = formData.getAll("serviceIds").map(String).filter(Boolean);
  const productIds = formData.getAll("productIds").map(String).filter(Boolean);
  const packageIds = formData.getAll("packageIds").map(String).filter(Boolean);

  if (parsed.data.code) {
    const existing = await db.promotion.findFirst({ where: { code: parsed.data.code } });
    if (existing) return { error: "This promo code is already in use." };
  }

  const promo = await db.promotion.create({
    data: { ...parsed.data, discountValue, appOnly } as never,
  });

  const eligibility = [
    ...serviceIds.map((serviceId) => ({ promotionId: promo.id, serviceId })),
    ...productIds.map((productId) => ({ promotionId: promo.id, productId })),
    ...packageIds.map((packageId) => ({ promotionId: promo.id, packageId })),
  ];
  if (eligibility.length > 0) {
    await db.promotionEligibility.createMany({ data: eligibility });
  }

  revalidatePath("/admin/promotions");
  return { success: true };
}

export async function archivePromotionAction(id: string) {
  await requirePermission("promotions.create");
  const { db } = await requireStaffContext();
  await db.promotion.updateMany({ where: { id }, data: { active: false } });
  revalidatePath("/admin/promotions");
}
