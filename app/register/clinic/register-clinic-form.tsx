"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { registerClinicAction } from "@/lib/actions/register";
import { Button } from "@/components/ui/button";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { PasswordFields } from "../password-fields";

const field = "h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary";
const label = "mb-1.5 block text-[12px] font-medium";

export function RegisterClinicForm({ defaultLocale, choosePassword = false }: { defaultLocale: string; choosePassword?: boolean }) {
  const t = useTranslations("register.clinic");
  const [state, action, pending] = useActionState(registerClinicAction, undefined);

  const errors = state && "fieldErrors" in state ? (state.fieldErrors ?? {}) : {};
  const message = state && "error" in state ? state.error : undefined;

  if (state && "ok" in state) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-[10px] bg-primary-soft px-3 py-3 text-[13px] leading-relaxed text-ink">
          {state.readyToSignIn ? t("done.ready") : state.emailed ? t("done.emailed", { email: state.email }) : t("done.notEmailed")}
        </p>
        {!state.emailed && !state.readyToSignIn && (
          <div className="rounded-[10px] bg-app p-3">
            <p className="break-all font-mono text-[12px]">{state.loginUrl}</p>
          </div>
        )}
        <Link href="/login" className="block text-center text-[13px] font-medium text-primary underline underline-offset-2">
          {t("done.signIn")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3.5">
      <div>
        <label htmlFor="name" className={label}>
          {t("clinicName")}
        </label>
        <input id="name" name="name" required maxLength={120} autoComplete="organization" className={field} />
        {errors.name && <p className="mt-1 text-[12px] text-[var(--accent-red)]">{errors.name}</p>}
      </div>
      <div>
        <label htmlFor="ownerName" className={label}>
          {t("yourName")}
        </label>
        <input id="ownerName" name="ownerName" required maxLength={120} autoComplete="name" className={field} />
        {errors.ownerName && <p className="mt-1 text-[12px] text-[var(--accent-red)]">{errors.ownerName}</p>}
      </div>
      <div>
        <label htmlFor="email" className={label}>
          {t("email")}
        </label>
        <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" className={field} />
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{t("emailHint")}</p>
        {errors.email && <p className="mt-1 text-[12px] text-[var(--accent-red)]">{errors.email}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="locale" className={label}>
            {t("language")}
          </label>
          <select id="locale" name="locale" defaultValue={defaultLocale === "en" ? "en" : "nl"} className={field}>
            <option value="nl">Nederlands</option>
            <option value="en">English</option>
          </select>
        </div>
        <div>
          <label htmlFor="currency" className={label}>
            {t("currency")}
          </label>
          <select id="currency" name="currency" defaultValue="EUR" className={field}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      {choosePassword && <PasswordFields errors={errors} />}
      <div>
        <label htmlFor="code" className={label}>
          {t("code")}
        </label>
        <input id="code" name="code" required inputMode="numeric" autoComplete="off" className={`${field} tracking-widest`} />
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{t("codeHint")}</p>
      </div>
      {message && (
        <p role="alert" className="text-[12px] text-[var(--accent-red)]">
          {message}
        </p>
      )}
      <Button type="submit" loading={pending} className="w-full">
        {t("submit")}
      </Button>
      <p className="text-[11px] leading-relaxed text-ink-muted">{choosePassword ? t("twoFactorNote") : t("passwordNote")}</p>
    </form>
  );
}
