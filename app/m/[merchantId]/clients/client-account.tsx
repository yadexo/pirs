"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "@/lib/utils";
import {
  adjustClientCreditAction,
  adjustClientPointsAction,
  clientAccountAction,
  type ClientAccount,
  type LedgerRow,
} from "@/lib/actions/client-account";

/**
 * A client's balances: what they have, where it came from, and the controls
 * to change it.
 *
 * The history is the point as much as the balance. Money and points a clinic
 * gave or took back are a conversation they may have to have with the client
 * months later, so every row names the reason and the staff member who
 * decided it.
 */
export function ClientAccountPanel({
  merchantId,
  customerProfileId,
  currency,
  canEdit,
  canAdjustPoints,
}: {
  merchantId: string;
  customerProfileId: string;
  currency: string;
  /** Whether this staff member may change the money balance (customers.edit). */
  canEdit: boolean;
  /** Points are their own permission (loyalty.adjust), so their own flag. */
  canAdjustPoints: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("portal.clients.clientAccount");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [account, setAccount] = React.useState<ClientAccount | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState<null | { kind: "credit" | "points"; direction: "add" | "remove" }>(null);
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await clientAccountAction(merchantId, customerProfileId);
    setLoading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setAccount(res.account);
  }, [merchantId, customerProfileId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function openForm(kind: "credit" | "points", direction: "add" | "remove") {
    setForm({ kind, direction });
    setAmount("");
    setReason("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError(null);
    const res =
      form.kind === "credit"
        ? await adjustClientCreditAction(merchantId, customerProfileId, { direction: form.direction, amount, reason })
        : await adjustClientPointsAction(merchantId, customerProfileId, { direction: form.direction, points: amount, reason });
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    toast.success(
      form.kind === "credit"
        ? form.direction === "add"
          ? t("toastCreditAdded")
          : t("toastCreditRemoved")
        : form.direction === "add"
          ? t("toastPointsAdded")
          : t("toastPointsRemoved"),
    );
    setForm(null);
    await load();
    // The client's row shows the balance too.
    router.refresh();
  }

  if (loading && !account) {
    return (
      <p className="flex items-center gap-2 py-8 text-[12px] text-ink-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("loadingAccount")}
      </p>
    );
  }
  if (!account) return <p className="py-8 text-center text-[12px] text-danger">{error ?? t("couldntLoad")}</p>;

  const formTitle = form
    ? form.kind === "credit"
      ? form.direction === "add"
        ? t("addCredit")
        : t("removeCredit")
      : form.direction === "add"
        ? t("addPoints")
        : t("removePoints")
    : "";

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="rounded-[12px] border border-border bg-app px-4 py-3">
          <span className="block text-[11px] uppercase tracking-wide text-ink-faint">{t("credit")}</span>
          <span className="tabular block text-[22px] font-semibold">{formatMoney(account.creditCents, currency)}</span>
        </div>

        {canEdit && !form && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => openForm("credit", "add")}>
              {t("addCredit")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => openForm("credit", "remove")} disabled={account.creditCents <= 0}>
              {t("removeCredit")}
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="rounded-[12px] border border-border bg-app px-4 py-3">
          <span className="block text-[11px] uppercase tracking-wide text-ink-faint">{t("loyaltyPoints")}</span>
          <span className="tabular block text-[22px] font-semibold">{account.pointsBalance}</span>
        </div>

        {canAdjustPoints && !form && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => openForm("points", "add")}>
              {t("addPoints")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => openForm("points", "remove")} disabled={account.pointsBalance <= 0}>
              {t("removePoints")}
            </Button>
          </div>
        )}
      </section>

      {form && (
        <form onSubmit={submit} className="space-y-3 rounded-[12px] border border-border p-4">
          <p className="text-[13px] font-semibold">{formTitle}</p>
          <label className="block space-y-1">
            <span className="text-[12px] text-ink-muted">{form.kind === "credit" ? t("amountField") : t("pointsField")}</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode={form.kind === "credit" ? "decimal" : "numeric"}
              placeholder={form.kind === "credit" ? "25.00" : "100"}
              autoFocus
              className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] text-ink-muted">{t("reason")}</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          {/* Said plainly, because the client is told it word for word. */}
          <p className="text-[11px] text-ink-faint">{t("clientSeesReason")}</p>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {form.direction === "add" ? t("addAction") : t("removeAction")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)} disabled={busy}>
              {tc("cancel")}
            </Button>
          </div>
        </form>
      )}

      <Ledger title={t("creditHistory")} rows={account.credit} currency={currency} locale={locale} t={t} />
      <Ledger title={t("pointsHistory")} rows={account.points} currency={null} locale={locale} t={t} />
    </div>
  );
}

/** Money when there is a currency, points when there is not. */
function Ledger({
  title,
  rows,
  currency,
  locale,
  t,
}: {
  title: string;
  rows: LedgerRow[];
  currency: string | null;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const ledgerLabel = (type: string): string => {
    switch (type) {
      case "MANUAL_ADJUSTMENT":
        return t("ledgerManual");
      case "MEMBERSHIP_GRANT":
        return t("ledgerMembershipGrant");
      case "REFUND":
        return t("ledgerRefund");
      case "REFUNDED":
        return t("ledgerRefunded");
      case "REDEEMED":
        return t("ledgerRedeemed");
      case "EARNED":
        return t("ledgerEarned");
      case "EXPIRED":
        return t("ledgerExpired");
      default:
        return type;
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "nl" ? "nl-NL" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  const show = (value: number) => (currency ? formatMoney(value, currency) : String(value));
  if (rows.length === 0) return <p className="py-6 text-center text-[12px] text-ink-muted">{t("nothingHere")}</p>;

  return (
    <div>
      <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-faint">{title}</p>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">{ledgerLabel(row.type)}</span>
              {row.reason && <span className="block text-[12px] text-ink-muted">{row.reason}</span>}
              <span className="block text-[11px] text-ink-faint">
                {when(row.at)}
                {row.by ? ` · ${row.by}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={`tabular block text-[13px] font-semibold ${row.amount < 0 ? "text-ink" : "text-[var(--accent-green)]"}`}>
                {row.amount < 0 ? "−" : "+"}
                {show(Math.abs(row.amount))}
              </span>
              <span className="tabular block text-[11px] text-ink-faint">{show(row.balanceAfter)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
