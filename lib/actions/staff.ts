"use server";

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireStaffContext, requireRole } from "@/lib/rbac";
import { hashPassword } from "@/lib/password";
import { PERMISSIONS, isPermissionKey } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";

function generateTempPassword() {
  return randomBytes(9).toString("base64url");
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function createRoleAction(_prevState: unknown, formData: FormData) {
  const user = await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Role name is required." };

  const permissionKeys = formData.getAll("permissions").map(String).filter(isPermissionKey);

  const role = await db.role.create({ data: { name } as never });

  const permissionRows = await db.permission.findMany({ where: { key: { in: permissionKeys } } });
  if (permissionRows.length > 0) {
    await db.rolePermission.createMany({
      data: permissionRows.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "role.created",
    entityType: "Role",
    entityId: role.id,
  });

  revalidatePath("/admin/staff/roles");
  return { success: true };
}

export async function updateRolePermissionsAction(roleId: string, _prevState: unknown, formData: FormData) {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();

  const permissionKeys = formData.getAll("permissions").map(String).filter(isPermissionKey);
  const permissionRows = await db.permission.findMany({ where: { key: { in: permissionKeys } } });

  await db.rolePermission.deleteMany({ where: { roleId } });
  if (permissionRows.length > 0) {
    await db.rolePermission.createMany({ data: permissionRows.map((p) => ({ roleId, permissionId: p.id })) });
  }

  revalidatePath("/admin/staff/roles");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  roleId: z.string().optional(),
  isAdmin: z.boolean().optional(),
});

export async function inviteStaffAction(_prevState: unknown, formData: FormData) {
  const user = await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();

  const parsed = inviteSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    roleId: formData.get("roleId") || undefined,
    isAdmin: formData.get("isAdmin") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const email = parsed.data.email.toLowerCase();
  const existing = await db.user.findFirst({ where: { email } });
  if (existing) return { error: "A staff account with this email already exists." };

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const newUser = await db.user.create({
    data: {
      email,
      passwordHash,
      role: parsed.data.isAdmin ? "TENANT_ADMIN" : "STAFF",
    } as never,
  });

  const staffProfile = await db.staffProfile.create({
    data: {
      userId: newUser.id,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      roleId: parsed.data.isAdmin ? undefined : parsed.data.roleId,
      active: true,
      invitedAt: new Date(),
      activatedAt: new Date(),
    } as never,
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "staff.invited",
    entityType: "StaffProfile",
    entityId: staffProfile.id,
  });

  revalidatePath("/admin/staff");
  return { success: true, email, tempPassword };
}

export async function setStaffRoleAction(staffProfileId: string, roleId: string) {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();
  await db.staffProfile.updateMany({ where: { id: staffProfileId }, data: { roleId: roleId || null } });
  revalidatePath(`/admin/staff/${staffProfileId}`);
}

export async function setStaffActiveAction(staffProfileId: string, active: boolean) {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();
  await db.staffProfile.updateMany({
    where: { id: staffProfileId },
    data: { active, deactivatedAt: active ? null : new Date() },
  });
  await db.user.updateMany({
    where: { staffProfile: { id: staffProfileId } },
    data: { status: active ? "ACTIVE" : "DISABLED" },
  });
  revalidatePath(`/admin/staff/${staffProfileId}`);
  revalidatePath("/admin/staff");
}

export async function setStaffServicesAction(staffProfileId: string, formData: FormData) {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();
  const serviceIds = formData.getAll("serviceIds").map(String);

  await db.staffService.deleteMany({ where: { staffProfileId } });
  if (serviceIds.length > 0) {
    await db.staffService.createMany({ data: serviceIds.map((serviceId) => ({ staffProfileId, serviceId })) });
  }
  revalidatePath(`/admin/staff/${staffProfileId}`);
}

export async function setStaffLocationsAction(staffProfileId: string, formData: FormData) {
  await requireRole("TENANT_ADMIN");
  const { db } = await requireStaffContext();
  const locationIds = formData.getAll("locationIds").map(String);

  await db.staffLocation.deleteMany({ where: { staffProfileId } });
  if (locationIds.length > 0) {
    await db.staffLocation.createMany({ data: locationIds.map((locationId) => ({ staffProfileId, locationId })) });
  }
  revalidatePath(`/admin/staff/${staffProfileId}`);
}

export { PERMISSIONS };
