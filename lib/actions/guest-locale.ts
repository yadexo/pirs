"use server";

import { redirect } from "next/navigation";
import { SUPPORTED_LOCALES, setLocaleCookie, type AppLocale } from "@/lib/locale-cookie";

/**
 * The pre-auth language toggle on /login, /forgot-password and
 * /set-password — there's no account yet to save a choice to, so this only
 * ever writes the LOCALE_COOKIE fallback (see lib/locale.ts's resolveLocale)
 * and reloads the same page in the new language.
 */
export async function guestSaveLocaleAction(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/login");
  if ((SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    await setLocaleCookie(locale as AppLocale);
  }
  redirect(redirectTo);
}
