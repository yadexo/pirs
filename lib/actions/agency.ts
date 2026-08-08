"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { requireRole } from "@/lib/rbac";

const schema = z.object({
  name: z.string().min(1, "Brand name is required").max(120),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2DD4D9"),
  logoLightUrl: z.string().max(500).optional(),
  logoDarkUrl: z.string().max(500).optional(),
  faviconUrl: z.string().max(500).optional(),
  loginBgUrl: z.string().max(500).optional(),
  customDomain: z.string().max(200).optional(),
  senderName: z.string().max(120).optional(),
  supportLabel: z.string().max(120).optional(),
  supportUrl: z.string().max(500).optional(),
});

const blankToUndefined = (v: FormDataEntryValue | null) => (v && String(v).trim() ? String(v) : undefined);

export async function saveWhiteLabelAction(_prevState: unknown, formData: FormData) {
  await requireRole("PLATFORM_ADMIN");

  const parsed = schema.safeParse({
    name: formData.get("name"),
    primaryColor: formData.get("primaryColor"),
    logoLightUrl: blankToUndefined(formData.get("logoLightUrl")),
    logoDarkUrl: blankToUndefined(formData.get("logoDarkUrl")),
    faviconUrl: blankToUndefined(formData.get("faviconUrl")),
    loginBgUrl: blankToUndefined(formData.get("loginBgUrl")),
    customDomain: blankToUndefined(formData.get("customDomain")),
    senderName: blankToUndefined(formData.get("senderName")),
    supportLabel: blankToUndefined(formData.get("supportLabel")),
    supportUrl: blankToUndefined(formData.get("supportUrl")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  // Single-agency deployment: one settings row, created on first save.
  const existing = await rawDb.agencySettings.findFirst({ select: { id: true } });
  if (existing) {
    await rawDb.agencySettings.update({ where: { id: existing.id }, data: parsed.data });
  } else {
    await rawDb.agencySettings.create({ data: parsed.data });
  }

  revalidatePath("/agency", "layout");
  return { success: true as const };
}
