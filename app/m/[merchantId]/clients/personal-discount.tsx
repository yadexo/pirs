"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { describeActionFailure } from "@/lib/action-failure";
import { givePersonalDiscountAction } from "@/lib/actions/personal-discount";

/**
 * Giving one client a discount, from the record staff already have open.
 *
 * It applies itself at their next checkout — there is no code to read out and
 * nothing for them to remember. Telling them is a choice, because sometimes
 * the point is to mention it in person.
 */
export function PersonalDiscount({ merchantId, customerProfileId, clientName }: { merchantId: string; customerProfileId: string; clientName: string }) {
  const router = useRouter();
  const t = useTranslations("portal.clients.personalDiscount");
  const [percent, setPercent] = React.useState("10");
  const [days, setDays] = React.useState("14");
  const [reason, setReason] = React.useState("");
  const [notify, setNotify] = React.useState(true);
  const [pending, setPending] = React.useState(false);

  async function give() {
    setPending(true);
    const result = await givePersonalDiscountAction(merchantId, {
      customerProfileId,
      percent: Number(percent),
      days: Number(days),
      reason: reason || undefined,
      notify,
    }).catch((err) => ({ error: describeActionFailure(err) }) as const);
    setPending(false);

    if ("error" in result) return toast.error(result.error);

    toast.success(
      result.heldUntil
        ? t("toastGivenHeld", { name: clientName })
        : result.notified > 0
          ? t("toastGivenNotified", { name: clientName })
          : t("toastGiven"),
    );
    setReason("");
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-card border border-border p-3">
      <p className="text-[13px] font-medium">{t("title")}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[12px] text-ink-muted">
          {t("percentOff")}
          <input
            value={percent}
            onChange={(e) => setPercent(e.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            className="mt-1 h-9 w-full rounded-[10px] border border-border bg-surface px-2 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <label className="text-[12px] text-ink-muted">
          {t("validForDays")}
          <input
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            className="mt-1 h-9 w-full rounded-[10px] border border-border bg-surface px-2 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
      </div>
      <label className="block text-[12px] text-ink-muted">
        {t("whatToCallIt")}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={60}
          placeholder={t("reasonPlaceholder")}
          className="mt-1 h-9 w-full rounded-[10px] border border-border bg-surface px-2 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-3.5 w-3.5" />
        {t("tellThemNow")}
      </label>
      <Button size="sm" onClick={give} disabled={pending || !percent || !days}>
        {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        {t("giveDiscount")}
      </Button>
      <p className="text-[11px] text-ink-muted">{t("appliedAutomatically")}</p>
    </div>
  );
}
