"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaffContext, requireRole } from "@/lib/rbac";

const settingsSchema = z.object({
  taxRatePercent: z.coerce.number().min(0).max(30),
  appointmentCancellationHours: z.coerce.number().int().min(0).max(168),
  appointmentReminderHours: z.coerce.number().int().min(0).max(168),
  membershipMaxPauseMonths: z.coerce.number().int().min(1).max(12),
  dataRetentionDays: z.coerce.number().int().min(30).optional(),
});

export async function updateBusinessSettingsAction(_prevState: unknown, formData: FormData) {
  await requireRole("TENANT_ADMIN");
  const { db, user } = await requireStaffContext();

  const parsed = settingsSchema.safeParse({
    taxRatePercent: formData.get("taxRatePercent"),
    appointmentCancellationHours: formData.get("appointmentCancellationHours"),
    appointmentReminderHours: formData.get("appointmentReminderHours"),
    membershipMaxPauseMonths: formData.get("membershipMaxPauseMonths"),
    dataRetentionDays: formData.get("dataRetentionDays") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { taxRatePercent, ...rest } = parsed.data;
  const data = { ...rest, taxRateBasisPoints: Math.round(taxRatePercent * 100) };

  await db.tenantSettings.upsert({
    where: { tenantId: user.tenantId! },
    create: data as never,
    update: data,
  });

  revalidatePath("/admin/settings");
  return { success: true };
}
