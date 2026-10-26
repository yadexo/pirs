import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { loadLiveAccount } from "@/lib/live-account";
import { rawDb } from "@/lib/db";
import { LanguageManager } from "./language-manager";

/**
 * Self-service language switch for staff/agency/platform-admin accounts —
 * the clinic-portal and agency-admin counterpart to the client app's
 * Profile > Account > Language sheet (app/app/[merchantSlug]/profile/profile-view.tsx).
 */
export default async function AccountLanguagePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const live = await loadLiveAccount(session.user.id, session.user.authTime);
  if (!live) redirect("/login?reason=access-changed");
  if (live.role === "CUSTOMER") redirect("/login");

  const t = await getTranslations("accountLanguage");
  const account = await rawDb.user.findUnique({ where: { id: session.user.id }, select: { locale: true } });

  return (
    <div className="mx-auto w-full max-w-md px-5 py-12">
      <h1 className="text-[20px] font-semibold text-ink">{t("title")}</h1>
      <p className="mt-1 text-[13px] text-ink-muted">{t("description")}</p>
      <div className="mt-6">
        <LanguageManager locale={account?.locale === "en" ? "en" : "nl"} />
      </div>
    </div>
  );
}
