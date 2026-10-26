import "server-only";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { clientAuth } from "@/client-auth";
import { rawDb } from "@/lib/db";
import { slugFromAppPath } from "@/lib/clinic-link";

export const SUPPORTED_LOCALES = ["nl", "en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "nl";

function asLocale(value: string | null | undefined): AppLocale | null {
  return value && (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as AppLocale) : null;
}

/**
 * Explicit, server-only locale resolution — never Accept-Language, never
 * anything the browser decides on its own. The page is rendered once on the
 * server and the result is handed to the client as-is; if the two ever
 * disagreed on what locale to use, React would see the hydrated tree as
 * mismatched text and throw it away, the same class of bug
 * lib/client-format.ts's APP_LOCALE already guards against for dates and
 * numbers (see the comment at the top of that file, and its #418 reference).
 *
 * Order: a signed-in account's own `User.locale` (staff in the portal and
 * agency, clients in the client app) always wins — it is a choice someone
 * made. An anonymous visitor to a specific clinic's client app gets that
 * clinic's `TenantSettings.defaultClientLocale`. Anyone else — anonymous,
 * no clinic in the URL — gets the platform default.
 */
export async function resolveLocale(): Promise<AppLocale> {
  const pathname = (await headers()).get("x-pathname") ?? "";

  if (pathname.startsWith("/app/")) {
    const clientSession = await clientAuth();
    if (clientSession?.user?.id) {
      const locale = await userLocale(clientSession.user.id);
      if (locale) return locale;
    }
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

  return DEFAULT_LOCALE;
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
