"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/rbac";
import { rawDb } from "@/lib/db";
import { SUPPORTED_LOCALES, setLocaleCookie, type AppLocale } from "@/lib/locale-cookie";

/**
 * Account > Language, for staff/agency/platform-admin accounts — the
 * clinic-portal and agency-admin counterpart to clientSaveLocaleAction
 * (lib/actions/client-app.ts). Revalidates "/" rather than a specific
 * merchant or agency path since this account can be signed into either.
 */
export async function staffSaveLocaleAction(locale: string): Promise<{ error: string } | { ok: true }> {
  const user = await requireSession("staff");
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) return { error: "Unsupported language." };

  await rawDb.user.update({ where: { id: user.id }, data: { locale } });
  await setLocaleCookie(locale as AppLocale);

  revalidatePath("/", "layout");
  return { ok: true };
}
