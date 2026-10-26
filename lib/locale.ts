import "server-only";
import { headers, cookies } from "next/headers";
import { auth } from "@/auth";
import { clientAuth } from "@/client-auth";
import { rawDb } from "@/lib/db";
import { slugFromAppPath } from "@/lib/clinic-link";
import { DEFAULT_LOCALE, LOCALE_COOKIE, asLocale, type AppLocale } from "@/lib/locale-cookie";

export { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE, setLocaleCookie, type AppLocale } from "@/lib/locale-cookie";

/**
 * Explicit, server-only locale resolution — never Accept-Language, never
 * anything the browser decides on its own. The page is rendered once on the
 * server and the result is handed to the client as-is; if the two ever
 * disagreed on what locale to use, React would see the hydrated tree as
 * mismatched text and throw it away, the same class of bug
 * lib/client-format.ts's APP_LOCALE already guards against for dates and
 * numbers (see the comment at the top of that file, and its #418 reference).
 *
 * Order, strictly: a signed-in account's own `User.locale` (staff in the
 * portal and agency, clients in the client app) always wins over everything
 * else — it is a choice someone made, re-read fresh from the database every
 * time rather than trusted from the session, the same reasoning
 * loadLiveAccount() uses for role and permissions. Only once nobody is
 * signed in does anything else get a say: the LOCALE_COOKIE from this
 * browser's last known choice, then (client app only) the clinic's own
 * TenantSettings.defaultClientLocale, then the platform default.
 */
export async function resolveLocale(): Promise<AppLocale> {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const cookieLocale = asLocale((await cookies()).get(LOCALE_COOKIE)?.value);

  if (pathname.startsWith("/app/")) {
    const clientSession = await clientAuth();
    if (clientSession?.user?.id) {
      const locale = await userLocale(clientSession.user.id);
      if (locale) return locale;
    }
    if (cookieLocale) return cookieLocale;
    const slug = slugFromAppPath(pathname);
    if (slug) {
      const tenant = await rawDb.tenant.findUnique({ where: { slug }, select: { settings: { select: { defaultClientLocale: true } } } });
      const locale = asLocale(tenant?.settings?.defaultClientLocale);
      if (locale) return locale;
    }
    return DEFAULT_LOCALE;
  }

  const staffSession = await auth();
  if (staffSession?.user?.id) {
    const locale = await userLocale(staffSession.user.id);
    if (locale) return locale;
  }

  return cookieLocale ?? DEFAULT_LOCALE;
}

async function userLocale(userId: string): Promise<AppLocale | null> {
  const user = await rawDb.user.findUnique({ where: { id: userId }, select: { locale: true } });
  return asLocale(user?.locale);
}

/** Whether a clinic's client app addresses its clients as "je" or "u" — only read for `locale === "nl"`; English copy doesn't distinguish. */
export async function resolveClientFormality(merchantSlug: string): Promise<"INFORMAL" | "FORMAL"> {
  const tenant = await rawDb.tenant.findUnique({ where: { slug: merchantSlug }, select: { settings: { select: { clientFormality: true } } } });
  return tenant?.settings?.clientFormality ?? "INFORMAL";
}
