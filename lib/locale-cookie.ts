import "server-only";
import { cookies } from "next/headers";

/**
 * Split out of lib/locale.ts on purpose: this file must stay free of
 * `@/auth` and `@/client-auth` imports. The two "change language" actions
 * (lib/actions/client-app.ts's clientSaveLocaleAction, lib/actions/account.ts's
 * staffSaveLocaleAction) import only this, not lib/locale.ts itself, so that
 * writing the fallback cookie never drags next-auth's module graph into
 * action code — and, by extension, into every test file that exercises that
 * action without itself mocking `@/auth`.
 */

export const SUPPORTED_LOCALES = ["nl", "en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "nl";

export function asLocale(value: string | null | undefined): AppLocale | null {
  return value && (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as AppLocale) : null;
}

/**
 * Written by the two "change language" actions at the same time as the
 * User.locale row, so a signed-out visit on the same browser — the install
 * reopened, the client app before signing in, this device's next anonymous
 * visit to this clinic — remembers the choice rather than resetting to the
 * clinic's default. Never consulted for a signed-in account; User.locale is
 * the only source of truth there (see lib/locale.ts's resolveLocale).
 */
export const LOCALE_COOKIE = "pirs_locale";

export async function setLocaleCookie(locale: AppLocale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
