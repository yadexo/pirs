import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentClientBasePath } from "@/lib/public-clinic";
import { resolveLocale } from "@/lib/locale";
import { GuestLocaleSwitcher } from "@/components/auth/guest-locale-switcher";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ clinic?: string }> }) {
  const { clinic } = await searchParams;
  // Only a well-formed slug is carried into the form.
  const slug = clinic && /^[a-z0-9-]{1,80}$/.test(clinic) ? clinic : null;
  // The clinic app's address on this host, so a client installed on the root
  // domain comes back inside their app rather than beside it.
  const backToApp = slug ? await currentClientBasePath(slug) : "/login";
  const t = await getTranslations("auth.resetPassword");
  const locale = await resolveLocale();
  const path = `/forgot-password${clinic ? `?clinic=${encodeURIComponent(clinic)}` : ""}`;
  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-sm">
        <div className="rounded-card border border-border bg-surface p-6 shadow-card">
          <h1 className="text-[18px] font-semibold">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-ink-muted">{t("description")}</p>
          <div className="mt-5">
            <ForgotPasswordForm clinic={slug} />
          </div>
          <Link
            href={backToApp}
            className="mt-4 block text-center text-[12.5px] text-ink-muted underline underline-offset-2"
          >
            {t("backToSignIn")}
          </Link>
        </div>
        <GuestLocaleSwitcher locale={locale} path={path} />
      </div>
    </main>
  );
}
