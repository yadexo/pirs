"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { staffSaveLocaleAction } from "@/lib/actions/account";
import type { AppLocale } from "@/lib/locale";

export function LanguageManager({ locale }: { locale: AppLocale }) {
  const router = useRouter();
  const t = useTranslations("accountLanguage");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function choose(option: AppLocale) {
    if (option === locale || pending) return;
    setError(null);
    setPending(true);
    const res = await staffSaveLocaleAction(option);
    setPending(false);
    if ("error" in res) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="space-y-2">
      {(["nl", "en"] as const).map((option) => (
        <button
          key={option}
          type="button"
          disabled={pending}
          onClick={() => choose(option)}
          className={`flex h-11 w-full items-center justify-between rounded-[10px] border px-3 text-[13px] font-medium outline-none transition-colors ${
            locale === option ? "border-primary bg-primary/5 text-primary" : "border-border bg-surface text-ink hover:bg-app"
          }`}
        >
          {option === "nl" ? t("dutch") : t("english")}
          {locale === option && <span aria-hidden>✓</span>}
        </button>
      ))}
      {error && <p className="mt-2 text-[12px] text-[var(--accent-red)]">{error}</p>}
    </div>
  );
}
