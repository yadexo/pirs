"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaffContext, requireRole } from "@/lib/rbac";

const locationSchema = z.object({
  name: z.string().min(1, "Name is required").max(160),
  addressLine1: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(30).optional(),
  country: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
});

export async function createLocationAction(_prevState: unknown, formData: FormData) {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();

  const parsed = locationSchema.safeParse({
    name: formData.get("name"),
    addressLine1: formData.get("addressLine1") || undefined,
    city: formData.get("city") || undefined,
    region: formData.get("region") || undefined,
    postalCode: formData.get("postalCode") || undefined,
    country: formData.get("country") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const existingCount = await db.location.count();
  await db.location.create({ data: { ...parsed.data, isPrimary: existingCount === 0 } as never });

  revalidatePath("/admin/locations");
  return { success: true };
}

export async function archiveLocationAction(id: string) {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();
  await db.location.updateMany({ where: { id }, data: { active: false } });
  revalidatePath("/admin/locations");
}
