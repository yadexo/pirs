"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatMoney } from "@/lib/utils";
import { adjustClientCreditAction, clientAccountAction, type ClientAccount, type LedgerRow } from "@/lib/actions/client-account";

/**
 * A client's account credit: what they have, where it came from, and the
 * controls to change it.
 *
 * The history is the point as much as the balance. Money a clinic gave or
 * took back is a conversation they may have to have with the client months
 * later, so every row names the reason and the staff member who decided it.
 */
export function ClientAccountPanel({
  merchantId,
  customerProfileId,
  currency,
  canEdit,
}: {
  merchantId: string;
  customerProfileId: string;
  currency: string;
  /** Whether this staff member may change balances, not merely read them. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [account, setAccount] = React.useState<ClientAccount | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState<null | "add" | "remove">(null);
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

  function openForm(next: "add" | "remove") {
    setForm(next);
    setAmount("");
    setReason("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError(null);
    const res = await adjustClientCreditAction(merchantId, customerProfileId, { direction: form, amount, reason });
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    toast.success(form === "add" ? "Credit added" : "Credit removed");
    setForm(null);
    await load();
    // The client's row shows the balance too.
    router.refresh();
  }

  if (loading && !account) {
    return (
      <p className="flex items-center gap-2 py-8 text-[12px] text-ink-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the account…
      </p>
    );
  }
  if (!account) return <p className="py-8 text-center text-[12px] text-danger">{error ?? "Couldn't load this account."}</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-[12px] border border-border bg-app px-4 py-3">
        <span className="block text-[11px] uppercase tracking-wide text-ink-faint">Account credit</span>
        <span className="tabular block text-[22px] font-semibold">{formatMoney(account.creditCents, currency)}</span>
      </div>

      {canEdit && !form && (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => openForm("add")}>
            Add credit
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => openForm("remove")} disabled={account.creditCents <= 0}>
            Remove credit
          </Button>
        </div>
      )}

      {canEdit && form && (
        <form onSubmit={submit} className="space-y-3 rounded-[12px] border border-border p-4">
          <p className="text-[13px] font-semibold">{form === "add" ? "Add credit" : "Remove credit"}</p>
          <label className="block space-y-1">
            <span className="text-[12px] text-ink-muted">Amount</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="25.00"
              autoFocus
              className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] text-ink-muted">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Goodwill after a late appointment"
              className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          {/* Said plainly, because the client is told it word for word. */}
          <p className="text-[11px] text-ink-faint">The client sees this reason in their app and gets a notification.</p>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {form === "add" ? "Add" : "Remove"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <Ledger rows={account.credit} currency={currency} />
    </div>
  );
}

const WHEN = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** What each kind of row is, in the clinic's words rather than the enum's. */
const LEDGER_LABEL: Record<string, string> = {
  MANUAL_ADJUSTMENT: "Adjusted by staff",
  MEMBERSHIP_GRANT: "Membership credit",
  REFUND: "Refunded",
  REDEEMED: "Spent",
  EXPIRED: "Expired",
};

function Ledger({ rows, currency }: { rows: LedgerRow[]; currency: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-[12px] text-ink-muted">Nothing on this account yet.</p>;

  return (
    <div>
      <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-faint">History</p>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">{LEDGER_LABEL[row.type] ?? row.type}</span>
              {row.reason && <span className="block text-[12px] text-ink-muted">{row.reason}</span>}
              <span className="block text-[11px] text-ink-faint">
                {WHEN(row.at)}
                {row.by ? ` · ${row.by}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={`tabular block text-[13px] font-semibold ${row.amountCents < 0 ? "text-ink" : "text-[var(--accent-green)]"}`}>
                {row.amountCents < 0 ? "−" : "+"}
                {formatMoney(Math.abs(row.amountCents), currency)}
              </span>
              <span className="tabular block text-[11px] text-ink-faint">{formatMoney(row.balanceAfterCents, currency)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
