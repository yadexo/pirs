"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { hashPassword } from "@/lib/password";
import { writeAuditLog } from "@/lib/audit";

const leadSchema = z.object({
  name: z.string().min(1, "Name is required").max(160),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  source: z.string().max(120).optional(),
  assignedStaffProfileId: z.string().optional(),
  valueEstimate: z.coerce.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

export async function createLeadAction(_prevState: unknown, formData: FormData) {
  await requirePermission("customers.edit");
  const { db } = await requireStaffContext();

  const parsed = leadSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email") || "",
    phone: formData.get("phone") || undefined,
    source: formData.get("source") || undefined,
    assignedStaffProfileId: formData.get("assignedStaffProfileId") || undefined,
    valueEstimate: formData.get("valueEstimate") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { valueEstimate, email, ...rest } = parsed.data;
  await db.lead.create({
    data: {
      ...rest,
      email: email || undefined,
      valueEstimateCents: valueEstimate ? Math.round(valueEstimate * 100) : undefined,
    } as never,
  });

  revalidatePath("/admin/leads");
  return { success: true };
}

export async function updateLeadStatusAction(leadId: string, status: string) {
  await requirePermission("customers.edit");
  const { db } = await requireStaffContext();
  await db.lead.updateMany({
    where: { id: leadId },
    data: { status: status as never, lastContactedAt: new Date() },
  });
  revalidatePath("/admin/leads");
  revalidatePath(`/admin/leads/${leadId}`);
}

export async function addLeadNoteAction(leadId: string, _prevState: unknown, formData: FormData) {
  await requirePermission("customers.edit");
  const { db } = await requireStaffContext();
  const note = String(formData.get("notes") ?? "").trim();
  const nextFollowUp = formData.get("nextFollowUpAt");

  await db.lead.updateMany({
    where: { id: leadId },
    data: {
      notes: note || undefined,
      lastContactedAt: new Date(),
      nextFollowUpAt: nextFollowUp ? new Date(String(nextFollowUp)) : undefined,
    },
  });
  revalidatePath(`/admin/leads/${leadId}`);
  return { success: true };
}

export async function convertLeadToCustomerAction(leadId: string): Promise<{ customerProfileId: string }> {
  await requirePermission("customers.edit");
  const { db, user } = await requireStaffContext();

  const lead = await db.lead.findFirst({ where: { id: leadId } });
  if (!lead || !lead.email) throw new Error("Lead needs an email address to convert.");

  const existing = await db.user.findFirst({ where: { email: lead.email.toLowerCase(), role: "CUSTOMER" } });
  if (existing) throw new Error("A customer with this email already exists.");

  const tempPassword = Math.random().toString(36).slice(2, 12);
  const passwordHash = await hashPassword(tempPassword);
  const [firstName, ...rest] = lead.name.split(" ");

  const newUser = await db.user.create({
    data: { email: lead.email.toLowerCase(), passwordHash, role: "CUSTOMER" } as never,
  });
  const customerProfile = await db.customerProfile.create({
    data: {
      userId: newUser.id,
      firstName: firstName || lead.name,
      lastName: rest.join(" ") || "",
      phone: lead.phone,
    } as never,
  });

  await db.lead.updateMany({
    where: { id: leadId },
    data: { status: "WON", convertedCustomerProfileId: customerProfile.id, convertedAt: new Date() },
  });

  await writeAuditLog({
    tenantId: user.tenantId!,
    actorUserId: user.id,
    actorType: "STAFF",
    action: "lead.converted",
    entityType: "Lead",
    entityId: leadId,
    metadata: { customerProfileId: customerProfile.id },
  });

  revalidatePath("/admin/leads");
  return { customerProfileId: customerProfile.id };
}
