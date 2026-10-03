"use server";

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { hashPassword } from "@/lib/password";
import { slugify } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";

const createSchema = z.object({
  name: z.string().min(2, "Business name is required").max(120),
  contactEmail: z.string().email("Enter a valid email"),
  phone: z.string().max(40).optional(),
  country: z.string().max(80).optional(),
  currency: z.string().length(3).default("EUR"),
  timezone: z.string().min(1).default("Europe/Amsterdam"),
});

export async function createMerchantAction(_prevState: unknown, formData: FormData) {
  const user = await requireRole("PLATFORM_ADMIN");

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    contactEmail: formData.get("contactEmail"),
    phone: formData.get("phone") || undefined,
    country: formData.get("country") || undefined,
    currency: formData.get("currency") || "EUR",
    timezone: formData.get("timezone") || "Europe/Amsterdam",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const logoUrl = String(formData.get("logoUrl") ?? "") || undefined;

  // Slugs stay unique even when two merchants share a trading name.
  let slug = slugify(parsed.data.name);
  if (await rawDb.tenant.findUnique({ where: { slug } })) {
    slug = `${slug}-${randomBytes(3).toString("hex")}`;
  }

  const tempPassword = randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const merchant = await rawDb.$transaction(async (tx) => {
    const created = await tx.tenant.create({
      data: {
        slug,
        name: parsed.data.name,
        status: "ACTIVE",
        subscriptionStatus: "TRIAL",
        branding: {
          create: {
            businessName: parsed.data.name,
            logoUrl,
            contactEmail: parsed.data.contactEmail,
            contactPhone: parsed.data.phone,
            country: parsed.data.country,
            currency: parsed.data.currency,
            timeZone: parsed.data.timezone,
          },
        },
        settings: { create: { publiclyListed: true } },
        // Seed defaults so App Builder is usable the moment they log in.
        loyaltyProgramme: { create: { pointsPerCents: 0.01, pointsPerVisit: 0 } },
      },
    });

    await tx.location.create({
      data: { tenantId: created.id, name: `${parsed.data.name} — Main`, isPrimary: true },
    });

    const owner = await tx.user.create({
      data: {
        tenantId: created.id,
        email: parsed.data.contactEmail.toLowerCase(),
        passwordHash,
        role: "TENANT_ADMIN",
      },
    });

    const [firstName, ...rest] = parsed.data.name.split(" ");
    await tx.staffProfile.create({
      data: {
        tenantId: created.id,
        userId: owner.id,
        firstName: firstName || parsed.data.name,
        lastName: rest.join(" ") || "Owner",
        active: true,
        activatedAt: new Date(),
      },
    });

    return created;
  });

  await writeAuditLog({
    tenantId: merchant.id,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: "merchant.created",
    entityType: "Tenant",
    entityId: merchant.id,
  });

  revalidatePath("/agency");
  return {
    success: true as const,
    merchantId: merchant.id,
    email: parsed.data.contactEmail,
    tempPassword,
  };
}

export async function setMerchantActiveAction(merchantId: string, active: boolean) {
  const user = await requireRole("PLATFORM_ADMIN");

  await rawDb.tenant.update({
    where: { id: merchantId },
    data: {
      status: active ? "ACTIVE" : "SUSPENDED",
      suspendedAt: active ? null : new Date(),
      suspendedReason: active ? null : "Suspended by agency",
    },
  });

  await writeAuditLog({
    tenantId: merchantId,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: active ? "merchant.reactivated" : "merchant.suspended",
    entityType: "Tenant",
    entityId: merchantId,
  });

  revalidatePath("/agency");
}

/**
 * The platform's cut of this clinic's memberships.
 *
 * The agency's decision, not the clinic's — which is why it lives here, behind
 * PLATFORM_ADMIN, and not in the clinic's own settings. Blank means "the same
 * as this clinic's other sales"; 0 is a real answer and means the platform
 * takes nothing from its memberships.
 */
export async function setMembershipFeeAction(
  merchantId: string,
  percent: number | null,
): Promise<{ error: string } | { ok: true; percent: number | null }> {
  const user = await requireRole("PLATFORM_ADMIN");

  if (percent !== null) {
    if (!Number.isFinite(percent) || percent < 0) return { error: "Enter a percentage of 0 or more, or leave it blank." };
    if (percent > 100) return { error: "A fee above 100% isn't possible." };
  }
  // Stripe takes two decimal places; round rather than silently losing the rest.
  const value = percent === null ? null : Math.round(percent * 100) / 100;

  await rawDb.tenant.update({ where: { id: merchantId }, data: { membershipFeePercent: value } });

  await writeAuditLog({
    tenantId: merchantId,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: "merchant.membership_fee_set",
    entityType: "Tenant",
    entityId: merchantId,
    metadata: { percent: value },
  });

  revalidatePath("/agency");
  return { ok: true, percent: value };
}

export async function deleteMerchantAction(merchantId: string) {
  const user = await requireRole("PLATFORM_ADMIN");

  const merchant = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { name: true } });
  if (!merchant) return;

  // Audit first — the cascade removes the tenant-scoped rows, so a log
  // written afterwards would have nothing to attach to.
  await writeAuditLog({
    tenantId: null,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: "merchant.deleted",
    entityType: "Tenant",
    entityId: merchantId,
    metadata: { name: merchant.name },
  });

  await deleteTenantCompletely(merchantId);
  revalidatePath("/agency");
}
