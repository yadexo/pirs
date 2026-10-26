import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "@/lib/locale";

/**
 * Locale comes from resolveLocale() (lib/locale.ts), never from the request
 * itself — next-intl's own Accept-Language detection is unused on purpose.
 * See that file's own comment for why: a browser-guessed locale can disagree
 * with the one the server already rendered, and that mismatch breaks
 * hydration.
 */
export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
