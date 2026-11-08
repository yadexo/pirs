import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentClientBasePath } from "@/lib/public-clinic";
import { resolveLocale } from "@/lib/locale";
import { GuestLocaleSwitcher } from "@/components/auth/guest-locale-switcher";
import { isPortal } from "@/lib/portal-scope";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ clinic?: string; portal?: string }> }) {
  const { clinic, portal } = await searchParams;
  // Only a well-formed slug is carried into the form.
  const slug = clinic && /^[a-z0-9-]{1,80}$/.test(clinic) ? clinic : null;
  // Which door asked, so the reset goes to that kind of account and not to
  // another one that happens to share the address (lib/portal-scope.ts). A
  // clinic slug already says "a client of this clinic", so it wins.
  const door = slug ? null : isPortal(portal) && portal !== "customer" ? portal : "staff";
  // The clinic app's address on this host, so a client installed on the root
  // domain comes back inside their app rather than beside it.
  const backToApp = slug ? await currentClientBasePath(slug) : "/login";
  const t = await getTranslations("auth.resetPassword");
  const locale = await resolveLocale();
  const path = `/forgot-password${slug ? `?clinic=${encodeURIComponent(slug)}` : door ? `?portal=${encodeURIComponent(door)}` : ""}`;
  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-sm">
        <div className="rounded-card border border-border bg-surface p-6 shadow-card">
          <h1 className="text-[18px] font-semibold">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-ink-muted">{t("description")}</p>
          <div className="mt-5">
            <ForgotPasswordForm clinic={slug} portal={door} />
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
