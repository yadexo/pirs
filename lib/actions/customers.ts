"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

export async function addCustomerNoteAction(customerProfileId: string, _prevState: unknown, formData: FormData) {
  await requirePermission("customers.edit");
  const { db, user } = await requireStaffContext();

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Note cannot be empty." };

  await db.customerNote.create({
    data: { customerProfileId, authorStaffProfileId: user.staffProfileId, body } as never,
  });

  revalidatePath(`/admin/customers/${customerProfileId}`);
  return { success: true };
}

export async function adjustAccountCreditAction(_prevState: unknown, formData: FormData) {
  await requirePermission("customers.edit");
  const { db, user } = await requireStaffContext();

  const customerProfileId = String(formData.get("customerProfileId") ?? "");
  const amountCents = Math.round(Number(formData.get("amount") ?? 0) * 100);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!customerProfileId || !amountCents) return { error: "Enter a non-zero amount." };
  if (!reason) return { error: "A reason is required for manual adjustments." };

  const profile = await db.customerProfile.findFirst({ where: { id: customerProfileId } });
  if (!profile) return { error: "Customer not found." };

  const newBalance = profile.accountCreditBalanceCents + amountCents;
  await db.customerProfile.updateMany({ where: { id: customerProfileId }, data: { accountCreditBalanceCents: newBalance } });
  await db.accountCreditTransaction.create({
    data: {
      customerProfileId,
      type: "MANUAL_ADJUSTMENT",
      amountCents,
      balanceAfterCents: newBalance,
      reason,
      performedByStaffProfileId: user.staffProfileId,
    } as never,
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "credit.manual_adjustment",
    entityType: "CustomerProfile",
    entityId: customerProfileId,
    reason,
    metadata: { amountCents },
  });

  revalidatePath(`/admin/customers/${customerProfileId}`);
  return { success: true };
}

export async function createCustomerTagAction(_prevState: unknown, formData: FormData) {
  await requirePermission("customers.edit");
  const { db } = await requireStaffContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Tag name is required." };
  await db.customerTag.create({ data: { name } as never });
  revalidatePath("/admin/customers");
  return { success: true };
}

export async function toggleCustomerTagAction(customerProfileId: string, tagId: string, apply: boolean) {
  await requirePermission("customers.edit");
  const { db } = await requireStaffContext();

  if (apply) {
    await db.customerProfileTag.create({ data: { customerProfileId, tagId } }).catch(() => {});
  } else {
    await db.customerProfileTag.deleteMany({ where: { customerProfileId, tagId } });
  }
  revalidatePath(`/admin/customers/${customerProfileId}`);
}
