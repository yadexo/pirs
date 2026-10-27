import { guestSaveLocaleAction } from "@/lib/actions/guest-locale";
import type { AppLocale } from "@/lib/locale-cookie";

/**
 * NL/EN toggle for the pre-auth pages (login, forgot-password, set-password)
 * — no account exists yet to read a saved locale from, so this just writes
 * the fallback cookie (see lib/locale.ts's resolveLocale priority order) and
 * reloads the same page. Two plain forms rather than client-side state: no
 * JS is required for it to work, consistent with the rest of these pages.
 */
export function GuestLocaleSwitcher({ locale, path }: { locale: AppLocale; path: string }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-[12px] text-ink-muted">
      {(["nl", "en"] as const).map((option) => (
        <form key={option} action={guestSaveLocaleAction}>
          <input type="hidden" name="locale" value={option} />
          <input type="hidden" name="redirectTo" value={path} />
          <button
            type="submit"
            disabled={locale === option}
            className={locale === option ? "font-semibold text-ink" : "underline underline-offset-2 hover:text-ink"}
          >
            {option === "nl" ? "Nederlands" : "English"}
          </button>
        </form>
      ))}
    </div>
  );
}
