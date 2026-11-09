"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { registerPlatformAdminAction } from "@/lib/actions/register";
import { Button } from "@/components/ui/button";

const field = "h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary";
const label = "mb-1.5 block text-[12px] font-medium";

export function RegisterAdminForm() {
  const t = useTranslations("register.admin");
  const [state, action, pending] = useActionState(registerPlatformAdminAction, undefined);

  const errors = state && "fieldErrors" in state ? (state.fieldErrors ?? {}) : {};
  const message = state && "error" in state ? state.error : undefined;

  if (state && "ok" in state) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-[10px] bg-primary-soft px-3 py-3 text-[13px] leading-relaxed text-ink">
          {state.emailed ? t("done.emailed", { email: state.email }) : t("done.notEmailed")}
        </p>
        {!state.emailed && (
          <div className="rounded-[10px] bg-app p-3">
            <p className="break-all font-mono text-[12px]">{state.loginUrl}</p>
          </div>
        )}
        <Link
          href={`/login?next=${encodeURIComponent("/agency")}`}
          className="block text-center text-[13px] font-medium text-primary underline underline-offset-2"
        >
          {t("done.signIn")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3.5">
      <div>
        <label htmlFor="name" className={label}>
          {t("yourName")}
        </label>
        <input id="name" name="name" required maxLength={120} autoComplete="name" className={field} />
        {errors.name && <p className="mt-1 text-[12px] text-[var(--accent-red)]">{errors.name}</p>}
      </div>
      <div>
        <label htmlFor="email" className={label}>
          {t("email")}
        </label>
        <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" className={field} />
        {errors.email && <p className="mt-1 text-[12px] text-[var(--accent-red)]">{errors.email}</p>}
      </div>
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
      <p className="text-[11px] leading-relaxed text-ink-muted">{t("securityNote")}</p>
    </form>
  );
}
