import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { inspectPasswordToken, MIN_PASSWORD_LENGTH } from "@/lib/password-tokens";
import { resolveLocale } from "@/lib/locale";
import { GuestLocaleSwitcher } from "@/components/auth/guest-locale-switcher";
import { currentClinicHostSlug } from "@/lib/public-clinic";
import { ClinicMark } from "@/components/auth/clinic-mark";
import { SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

/** One page for both accepting a staff invitation and resetting a password. */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  // On a clinic's own domain only that clinic's client links open here; any
  // other link shows "expired", without the address it was for.
  const hostClinic = await currentClinicHostSlug();
  const info = await inspectPasswordToken(token, { clinicSlug: hostClinic });
  const t = await getTranslations("auth.setPassword");
  const locale = await resolveLocale();
  const path = `/set-password${token ? `?token=${encodeURIComponent(token)}` : ""}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-sm">
        <ClinicMark slug={hostClinic} />
        <div className="rounded-card border border-border bg-surface p-6 shadow-card">
          {info ? (
            <>
              <h1 className="text-[18px] font-semibold">{info.isInvite ? t("setupTitle") : t("resetTitle")}</h1>
              <p className="mt-1 text-[13px] text-ink-muted">
                {/* A tag, not a {placeholder}: next-intl only calls a function for a tag (tests/rich-text-messages.test.ts). */}
                {t.rich("description", {
                  address: info.email,
                  email: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
                  minLength: MIN_PASSWORD_LENGTH,
                })}
              </p>
              <div className="mt-5">
                <SetPasswordForm token={token} minLength={MIN_PASSWORD_LENGTH} />
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[18px] font-semibold">{t("linkExpiredTitle")}</h1>
              <p className="mt-1 text-[13px] text-ink-muted">{t("linkExpiredDescription")}</p>
              <Link href={hostClinic ? `/forgot-password?clinic=${encodeURIComponent(hostClinic)}` : "/forgot-password"} className="mt-5 block text-[13px] font-medium text-primary underline underline-offset-2">
                {t("sendNewLink")}
              </Link>
            </>
          )}
        </div>
        <GuestLocaleSwitcher locale={locale} path={path} />
      </div>
    </main>
  );
}
