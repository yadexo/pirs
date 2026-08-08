"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaffContext, requireRole } from "@/lib/rbac";

const brandingSchema = z.object({
  businessName: z.string().min(1, "Business name is required").max(160),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0f766e"),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().max(40).optional(),
  addressLine1: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(30).optional(),
  country: z.string().max(120).optional(),
  website: z.string().max(200).optional(),
  currency: z.string().length(3),
  timeZone: z.string().min(1),
  termsContent: z.string().max(20000).optional(),
  privacyContent: z.string().max(20000).optional(),
  cancellationPolicy: z.string().max(5000).optional(),
});

export async function updateBrandingAction(_prevState: unknown, formData: FormData) {
  await requireRole("TENANT_ADMIN");
  const { user, db } = await requireStaffContext();

  const parsed = brandingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const logoUrl = String(formData.get("logoUrl") ?? "") || undefined;
  const coverImageUrl = String(formData.get("coverImageUrl") ?? "") || undefined;

  await db.tenantBranding.upsert({
    where: { tenantId: user.tenantId! },
    create: { ...parsed.data, logoUrl, coverImageUrl } as never,
    update: { ...parsed.data, logoUrl, coverImageUrl },
  });

  revalidatePath("/admin/branding");
  return { success: true };
}
