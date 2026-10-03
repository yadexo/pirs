"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Pill } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/utils";
import { describeActionFailure } from "@/lib/action-failure";
import { clientOrdersAction, type ClientOrderRow } from "@/lib/actions/refund-order";
import { RefundButton } from "../shop/refund-button";

/**
 * A client's orders, inside the record staff already have open — so refunding
 * the order someone is standing in front of you about doesn't mean going to
 * another screen and finding it among everyone else's.
 */

const TONE: Record<string, "green" | "amber" | "neutral" | "red"> = {
  PAID: "green",
  PARTIALLY_REFUNDED: "amber",
  REFUNDED: "neutral",
  PENDING: "neutral",
  FAILED: "red",
};

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });

export function ClientOrders({ merchantId, customerProfileId, canRefund }: { merchantId: string; customerProfileId: string; canRefund: boolean }) {
  const [orders, setOrders] = React.useState<ClientOrderRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    void clientOrdersAction(merchantId, customerProfileId)
      .then((res) => {
        if (!live) return;
        if ("error" in res) {
          setError(res.error);
          setOrders([]);
        } else setOrders(res.orders);
      })
      .catch((err) => live && setError(describeActionFailure(err)));
    return () => {
      live = false;
    };
  }, [merchantId, customerProfileId]);

  if (orders === null) {
    return (
      <div className="flex h-24 items-center justify-center text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (error) return <p className="rounded-[10px] bg-[var(--accent-red)]/10 px-3 py-2 text-[12px] text-ink">{error}</p>;
  if (orders.length === 0) return <p className="py-8 text-center text-[12px] text-ink-muted">No orders yet.</p>;

  return (
    <ul className="divide-y divide-border rounded-card border border-border">
      {orders.map((o) => (
        <li key={o.id} className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">
              {o.orderNumber} · {formatMoney(o.totalCents, o.currency)}
            </p>
            <p className="truncate text-[11px] text-ink-muted">
              {when(o.placedAt)}
              {o.refundedCents > 0 ? ` · refunded ${formatMoney(o.refundedCents, o.currency)}` : ""}
            </p>
          </div>
          <Pill tone={TONE[o.status] ?? "neutral"}>{o.status.toLowerCase().replace(/_/g, " ")}</Pill>
          {canRefund && o.refundableCents > 0 && <RefundButton merchantId={merchantId} orderId={o.id} orderNumber={o.orderNumber} />}
        </li>
      ))}
    </ul>
  );
}
