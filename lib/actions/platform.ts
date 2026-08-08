"use server";

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformContext } from "@/lib/rbac";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { slugify } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";

const createTenantSchema = z.object({
  clinicName: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).optional(),
  adminFirstName: z.string().min(1).max(80),
  adminLastName: z.string().min(1).max(80),
  adminEmail: z.string().email(),
});

function generateTempPassword() {
  return randomBytes(9).toString("base64url");
}

export async function createTenantAction(_prevState: unknown, formData: FormData) {
  const { user } = await requirePlatformContext();

  const parsed = createTenantSchema.safeParse({
    clinicName: formData.get("clinicName"),
    slug: formData.get("slug") || undefined,
    adminFirstName: formData.get("adminFirstName"),
    adminLastName: formData.get("adminLastName"),
    adminEmail: formData.get("adminEmail"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { clinicName, adminFirstName, adminLastName, adminEmail } = parsed.data;
  const slug = slugify(parsed.data.slug || clinicName);

  const existing = await rawDb.tenant.findUnique({ where: { slug } });
  if (existing) return { error: `The workspace slug "${slug}" is already taken.` };

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const tenant = await rawDb.$transaction(async (tx) => {
    const created = await tx.tenant.create({
      data: {
        slug,
        name: clinicName,
        status: "ACTIVE",
        subscriptionStatus: "TRIAL",
        branding: { create: { businessName: clinicName, currency: "USD", timeZone: "America/New_York" } },
        settings: { create: {} },
      },
    });

    const adminUser = await tx.user.create({
      data: { tenantId: created.id, email: adminEmail.toLowerCase(), passwordHash, role: "TENANT_ADMIN" },
    });

    await tx.staffProfile.create({
      data: {
        tenantId: created.id,
        userId: adminUser.id,
        firstName: adminFirstName,
        lastName: adminLastName,
        active: true,
        activatedAt: new Date(),
      },
    });

    return created;
  });

  await writeAuditLog({
    tenantId: tenant.id,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: "tenant.created",
    entityType: "Tenant",
    entityId: tenant.id,
  });

  revalidatePath("/platform/tenants");
  return { success: true, slug, tempPassword, adminEmail };
}

export async function setTenantStatusAction(tenantId: string, status: "ACTIVE" | "SUSPENDED", reason?: string) {
  const { user } = await requirePlatformContext();

  await rawDb.tenant.update({
    where: { id: tenantId },
    data: {
      status,
      suspendedAt: status === "SUSPENDED" ? new Date() : null,
      suspendedReason: status === "SUSPENDED" ? reason ?? "Suspended by platform admin" : null,
    },
  });

  await writeAuditLog({
    tenantId,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: status === "SUSPENDED" ? "tenant.suspended" : "tenant.reactivated",
    entityType: "Tenant",
    entityId: tenantId,
    reason,
  });

  revalidatePath("/platform/tenants");
  revalidatePath(`/platform/tenants/${tenantId}`);
}

export async function updateSubscriptionStatusAction(
  tenantId: string,
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED",
) {
  const { user } = await requirePlatformContext();
  await rawDb.tenant.update({ where: { id: tenantId }, data: { subscriptionStatus: status } });
  await writeAuditLog({
    tenantId,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: "tenant.subscription_updated",
    entityType: "Tenant",
    entityId: tenantId,
    metadata: { status },
  });
  revalidatePath(`/platform/tenants/${tenantId}`);
}
