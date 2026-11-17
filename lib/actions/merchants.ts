"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { createClinicWithOwner } from "@/lib/clinic-create";
import { SUPPORTED_LOCALES } from "@/lib/locale-cookie";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { arg, args, INVALID_REQUEST, validArgs } from "@/lib/action-args";
import { platformAdminOrRefusal } from "@/lib/platform-admin-action";

const createSchema = z.object({
  name: z.string().min(2, "Business name is required").max(120),
  /** The owner's own name. Optional: the form has only ever asked for the clinic's. */
  ownerName: z.string().max(120).optional(),
  contactEmail: z.string().email("Enter a valid email"),
  phone: z.string().max(40).optional(),
  country: z.string().max(80).optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).default("EUR"),
  timezone: z.string().min(1).default("Europe/Amsterdam"),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
}).strict();

export async function createMerchantAction(_prevState: unknown, formData: FormData) {
  if (!validArgs(args([arg.prevState, arg.formData]), [_prevState, formData])) return { error: INVALID_REQUEST };
  const guard = await platformAdminOrRefusal();
  if ("error" in guard) return { error: guard.error };
  const user = guard.user;

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    ownerName: formData.get("ownerName") || undefined,
    contactEmail: formData.get("contactEmail"),
    phone: formData.get("phone") || undefined,
    country: formData.get("country") || undefined,
    currency: formData.get("currency") || "EUR",
    timezone: formData.get("timezone") || "Europe/Amsterdam",
    locale: formData.get("locale") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  // The clinic, its owner, the one-time link and the welcome email — the same
  // code the clinic register page runs (lib/clinic-create.ts), so the two ways
  // a clinic comes into being cannot drift apart.
  const clinic = await createClinicWithOwner({
    name: parsed.data.name,
    ownerName: parsed.data.ownerName,
    contactEmail: parsed.data.contactEmail,
    phone: parsed.data.phone,
    country: parsed.data.country,
    currency: parsed.data.currency,
    timezone: parsed.data.timezone,
    locale: parsed.data.locale,
    logoUrl: String(formData.get("logoUrl") ?? "") || undefined,
    createdByUserId: user.id,
  });

  await writeAuditLog({
    tenantId: clinic.tenantId,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: "merchant.created",
    entityType: "Tenant",
    entityId: clinic.tenantId,
  });

  revalidatePath("/agency");
  return {
    success: true as const,
    merchantId: clinic.tenantId,
    email: clinic.email,
    loginUrl: clinic.loginUrl,
    emailed: clinic.emailed,
  };
}

export async function setMerchantActiveAction(merchantId: string, active: boolean): Promise<{ ok: true } | { error: string }> {
  if (!validArgs(args([arg.id, arg.bool]), [merchantId, active])) return { error: INVALID_REQUEST };
  const guard = await platformAdminOrRefusal();
  if ("error" in guard) return { error: guard.error };
  const user = guard.user;

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
  return { ok: true };
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
  if (!validArgs(args([arg.id, arg.formNumber.nullable()]), [merchantId, percent])) return { error: INVALID_REQUEST };
  const guard = await platformAdminOrRefusal();
  if ("error" in guard) return { error: guard.error };
  const user = guard.user;

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

/**
 * Switches the app's own booking on or off for a clinic.
 *
 * The platform's decision, not the clinic's: clinics book through their own
 * software, so in-app booking is off until we turn it on for one. Switching
 * it off hides and refuses booking; it deletes nothing, and switching it back
 * on shows existing appointments again.
 */
export async function setInAppBookingsAction(merchantId: string, on: boolean): Promise<{ error: string } | { ok: true; inAppBookings: boolean }> {
  if (!validArgs(args([arg.id, arg.bool]), [merchantId, on])) return { error: INVALID_REQUEST };
  const guard = await platformAdminOrRefusal();
  if ("error" in guard) return { error: guard.error };
  const user = guard.user;

  const { count } = await rawDb.tenant.updateMany({ where: { id: merchantId }, data: { inAppBookings: on } });
  if (count === 0) return { error: "That clinic no longer exists." };

  await writeAuditLog({
    tenantId: merchantId,
    actorUserId: user.id,
    actorType: "PLATFORM_ADMIN",
    action: on ? "merchant.in_app_bookings_on" : "merchant.in_app_bookings_off",
    entityType: "Tenant",
    entityId: merchantId,
  });

  revalidatePath(`/agency/clinics/${merchantId}`);
  revalidatePath(`/m/${merchantId}`, "layout");
  return { ok: true, inAppBookings: on };
}

export async function deleteMerchantAction(merchantId: string): Promise<{ ok: true } | { error: string }> {
  if (!validArgs(args([arg.id]), [merchantId])) return { error: INVALID_REQUEST };
  const guard = await platformAdminOrRefusal();
  if ("error" in guard) return { error: guard.error };
  const user = guard.user;

  const merchant = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { name: true } });
  if (!merchant) return { ok: true };

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
  return { ok: true };
}
