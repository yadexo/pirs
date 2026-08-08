"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaffContext, requirePermission, requireCustomerContext } from "@/lib/rbac";
import { sendCampaign } from "@/lib/notifications-service";

const campaignSchema = z.object({
  name: z.string().min(1, "Name is required").max(160),
  channel: z.enum(["IN_APP", "EMAIL", "SMS", "PUSH"]),
  segment: z.enum(["ALL", "NEW", "MEMBERS", "NON_MEMBERS", "TAGGED"]),
  segmentTagId: z.string().optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1, "Message body is required").max(2000),
});

export async function createCampaignAction(_prevState: unknown, formData: FormData) {
  await requirePermission("promotions.create");
  const { db, user } = await requireStaffContext();

  const parsed = campaignSchema.safeParse({
    name: formData.get("name"),
    channel: formData.get("channel"),
    segment: formData.get("segment"),
    segmentTagId: formData.get("segmentTagId") || undefined,
    subject: formData.get("subject") || undefined,
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  await db.notificationCampaign.create({
    data: { ...parsed.data, createdByStaffProfileId: user.staffProfileId, status: "DRAFT" } as never,
  });

  revalidatePath("/admin/notifications");
  return { success: true };
}

export async function sendCampaignAction(campaignId: string) {
  await requirePermission("promotions.create");
  const { db } = await requireStaffContext();
  const result = await sendCampaign(db, campaignId);
  revalidatePath("/admin/notifications");
  return result;
}

export async function markNotificationReadAction(notificationId: string) {
  const { db, user } = await requireCustomerContext();
  await db.notification.updateMany({
    where: { id: notificationId, customerProfileId: user.customerProfileId! },
    data: { readAt: new Date() },
  });
}

export async function updateNotificationPreferencesAction(_prevState: unknown, formData: FormData) {
  const { db, user } = await requireCustomerContext();
  await db.customerProfile.updateMany({
    where: { id: user.customerProfileId! },
    data: {
      emailConsent: formData.get("emailConsent") === "on",
      smsConsent: formData.get("smsConsent") === "on",
      pushConsent: formData.get("pushConsent") === "on",
      marketingConsent: formData.get("marketingConsent") === "on",
    },
  });
  return { success: true };
}
