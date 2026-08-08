"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireCustomerContext } from "@/lib/rbac";

const profileSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: z.string().max(30).optional(),
  dateOfBirth: z.string().optional(),
  addressLine1: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(30).optional(),
});

export async function updateProfileAction(tenantSlug: string, _prevState: unknown, formData: FormData) {
  const { db, user } = await requireCustomerContext();

  const parsed = profileSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    phone: formData.get("phone") || undefined,
    dateOfBirth: formData.get("dateOfBirth") || undefined,
    addressLine1: formData.get("addressLine1") || undefined,
    city: formData.get("city") || undefined,
    region: formData.get("region") || undefined,
    postalCode: formData.get("postalCode") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { dateOfBirth, ...rest } = parsed.data;

  await db.customerProfile.updateMany({
    where: { id: user.customerProfileId! },
    data: { ...rest, dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined },
  });

  revalidatePath(`/${tenantSlug}/account`);
  return { success: true };
}
