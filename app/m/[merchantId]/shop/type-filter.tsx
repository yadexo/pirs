"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/** The old Orders / Payments split, now a single filter over one table. */
export function TypeFilter({ merchantId, value }: { merchantId: string; value: string }) {
  const router = useRouter();
  const t = useTranslations("portal.shop.typeFilter");
  return (
    <select
      value={value}
      onChange={(e) =>
        router.push(`/m/${merchantId}/shop${e.target.value === "all" ? "" : `?type=${e.target.value}`}`)
      }
      className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none"
    >
      <option value="all">{t("all")}</option>
      <option value="orders">{t("orders")}</option>
      <option value="payments">{t("payments")}</option>
      <option value="refunds">{t("refunds")}</option>
    </select>
  );
}
