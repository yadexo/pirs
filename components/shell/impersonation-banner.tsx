"use client";

import { useTransition } from "react";
import { Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { stopImpersonationAction } from "@/lib/actions/impersonation";

export function ImpersonationBanner({ merchantName }: { merchantName: string }) {
  const t = useTranslations("portal");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-center gap-2 bg-[var(--accent-indigo)] px-4 py-1.5 text-[12px] text-white">
      <Eye className="h-3.5 w-3.5" />
      <span>
        {t("viewingAs")} <span className="font-semibold">{merchantName}</span>
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => stopImpersonationAction())}
        className="ml-1 underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
      >
        {t("exit")}
      </button>
    </div>
  );
}
