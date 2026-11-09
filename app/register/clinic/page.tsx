import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { rawDb } from "@/lib/db";
import { registrationEnabled } from "@/lib/registration-code";
import { resolveLocale } from "@/lib/locale";
import { GuestLocaleSwitcher } from "@/components/auth/guest-locale-switcher";
import { RegisterClinicForm } from "./register-clinic-form";

/**
 * Registering a clinic, reached from the clinic login page.
 *
 * Closed unless REGISTRATION_CODE is set — a 404, not a message, so an
 * instance with registration off does not advertise that it has the page at
 * all. The action refuses on its own too (lib/registration-guard.ts): a page
 * being absent is not the same as the server saying no.
 */
export default async function RegisterClinicPage() {
  if (!registrationEnabled()) notFound();

  const t = await getTranslations("register.clinic");
  const locale = await resolveLocale();
  const agency = await rawDb.agencySettings.findFirst({ select: { name: true } });

  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white">
            {(agency?.name ?? "D").charAt(0)}
          </span>
          <span className="text-[15px] font-semibold">{agency?.name ?? "Deza"}</span>
        </div>

        <div className="rounded-card border border-border bg-surface p-6 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-primary">{t("section")}</p>
          <h1 className="mt-1 text-[18px] font-semibold">{t("title")}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{t("subtitle")}</p>
          <div className="mt-5">
            <RegisterClinicForm defaultLocale={locale} />
          </div>
        </div>

        <p className="mt-4 text-center text-[12.5px] text-ink-muted">
          <Link href="/login" className="underline underline-offset-2">
            {t("haveAnAccount")}
          </Link>
        </p>
        <GuestLocaleSwitcher locale={locale} path="/register/clinic" />
      </div>
    </main>
  );
}
