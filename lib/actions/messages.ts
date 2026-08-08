"use server";

import { revalidatePath } from "next/cache";
import { requireCustomerContext, requireStaffContext, requirePermission } from "@/lib/rbac";

export async function getOrCreateConversationAction() {
  const { db, user } = await requireCustomerContext();
  const existing = await db.conversation.findFirst({
    where: { customerProfileId: user.customerProfileId!, channel: "IN_APP" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing.id;

  const created = await db.conversation.create({
    data: { customerProfileId: user.customerProfileId!, channel: "IN_APP", status: "OPEN" } as never,
  });
  return created.id;
}

export async function sendCustomerMessageAction(tenantSlug: string, conversationId: string, _prevState: unknown, formData: FormData) {
  const { db, user } = await requireCustomerContext();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Message cannot be empty." };

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, customerProfileId: user.customerProfileId! },
  });
  if (!conversation) return { error: "Conversation not found." };

  await db.message.create({
    data: { conversationId, senderType: "CUSTOMER", body } as never,
  });
  await db.conversation.updateMany({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), unreadForStaff: true, status: "OPEN" },
  });

  revalidatePath(`/${tenantSlug}/messages`);
  return { success: true };
}

export async function sendStaffMessageAction(conversationId: string, _prevState: unknown, formData: FormData) {
  await requirePermission("messages.send");
  const { db, user } = await requireStaffContext();
  const body = String(formData.get("body") ?? "").trim();
  const isInternalNote = formData.get("isInternalNote") === "on";
  if (!body) return { error: "Message cannot be empty." };

  await db.message.create({
    data: {
      conversationId,
      senderType: "STAFF",
      senderStaffProfileId: user.staffProfileId,
      body,
      isInternalNote,
    } as never,
  });
  await db.conversation.updateMany({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), unreadForCustomer: !isInternalNote },
  });

  revalidatePath(`/admin/conversations/${conversationId}`);
  return { success: true };
}

export async function assignConversationAction(conversationId: string, staffProfileId: string) {
  await requirePermission("messages.send");
  const { db } = await requireStaffContext();
  await db.conversation.updateMany({ where: { id: conversationId }, data: { assignedStaffProfileId: staffProfileId || null } });
  revalidatePath("/admin/conversations");
  revalidatePath(`/admin/conversations/${conversationId}`);
}

export async function updateConversationStatusAction(conversationId: string, status: "OPEN" | "PENDING" | "CLOSED") {
  await requirePermission("messages.send");
  const { db } = await requireStaffContext();
  await db.conversation.updateMany({ where: { id: conversationId }, data: { status } });
  revalidatePath("/admin/conversations");
  revalidatePath(`/admin/conversations/${conversationId}`);
}

export async function markConversationReadAction(conversationId: string, by: "STAFF" | "CUSTOMER") {
  if (by === "STAFF") {
    await requirePermission("messages.send");
    const { db } = await requireStaffContext();
    await db.conversation.updateMany({ where: { id: conversationId }, data: { unreadForStaff: false } });
  } else {
    const { db, user } = await requireCustomerContext();
    await db.conversation.updateMany({
      where: { id: conversationId, customerProfileId: user.customerProfileId! },
      data: { unreadForCustomer: false },
    });
  }
}
