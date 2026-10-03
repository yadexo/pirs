"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/primitives";
import { describeActionFailure } from "@/lib/action-failure";
import { refundOrderAction, refundableForOrderAction, type RefundableOrder } from "@/lib/actions/refund-order";
import { formatMoney } from "@/lib/utils";

/**
 * Giving money back, from the order it belongs to.
 *
 * Nothing happens on the first click: the drawer shows what is still
 * refundable and asks for a confirmation, because this is the one action in
 * the dashboard that moves money out and cannot be taken back.
 */
export function RefundButton({ merchantId, orderId, orderNumber }: { merchantId: string; orderId: string; orderNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [info, setInfo] = React.useState<RefundableOrder | null | "loading">("loading");
  const [mode, setMode] = React.useState<"full" | "partial">("full");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setInfo("loading");
    void refundableForOrderAction(merchantId, orderId)
      .then((res) => setInfo("error" in res ? null : res.order))
      .catch(() => setInfo(null));
  }, [open, merchantId, orderId]);

  async function refund() {
    setPending(true);
    const res = await refundOrderAction(merchantId, {
      orderId,
      amount: mode === "partial" ? amount : undefined,
      reason: reason || undefined,
    }).catch((err) => ({ error: describeActionFailure(err) }) as const);
    setPending(false);

    if ("error" in res) {
      toast.error(res.error);
      setConfirming(false);
      return;
    }
    toast.success(
      res.pending
        ? "Refund sent to Stripe — it will show as refunded once Stripe confirms."
        : `${res.fully ? "Fully refunded" : "Partly refunded"}: ${formatMoney(res.amountCents, info !== "loading" && info ? info.currency : undefined)}`,
    );
    setOpen(false);
    setConfirming(false);
    setReason("");
    setAmount("");
    router.refresh();
  }

  const remainder = info !== "loading" && info ? info.remainderCents : 0;
  const currency = info !== "loading" && info ? info.currency : undefined;

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Refund
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={`Refund ${orderNumber}`} subtitle="The money goes back to the client's card." width="max-w-md">
        {info === "loading" ? (
          <div className="flex h-32 items-center justify-center text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : !info ? (
          <p className="text-[13px] text-ink-muted">There&apos;s no completed payment on this order to refund.</p>
        ) : remainder === 0 ? (
          <p className="text-[13px] text-ink-muted">This order has already been refunded in full.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-card border border-border p-3 text-[12px]">
              <div className="flex justify-between">
                <span className="text-ink-muted">Order total</span>
                <span className="tabular font-medium">{formatMoney(info.totalCents, currency)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-ink-muted">Still refundable</span>
                <span className="tabular font-medium">{formatMoney(remainder, currency)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 text-[13px]">
              <label className="flex items-center gap-2">
                <input type="radio" checked={mode === "full"} onChange={() => setMode("full")} className="h-3.5 w-3.5" />
                Refund everything still refundable ({formatMoney(remainder, currency)})
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={mode === "partial"} onChange={() => setMode("partial")} className="h-3.5 w-3.5" />
                Refund part of it
              </label>
            </div>

            {mode === "partial" && (
              <label className="block text-[12px] text-ink-muted">
                Amount
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  placeholder="25.00"
                  className="mt-1 h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
            )}

            <label className="block text-[12px] text-ink-muted">
              Reason (optional)
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                placeholder="Client changed their mind"
                className="mt-1 h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>

            <p className="text-[11px] text-ink-muted">
              The platform&apos;s fee on this sale goes back with the refund, so you keep nothing on money the client no longer paid. Items the client
              hasn&apos;t collected yet stop working; anything already collected stays, flagged for you.
            </p>

            {confirming ? (
              <div className="space-y-2 rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2.5">
                <p className="text-[12px]">
                  Refund {mode === "partial" && amount ? formatMoney(Math.round(Number(amount.replace(",", ".")) * 100), currency) : formatMoney(remainder, currency)}{" "}
                  to the client? This can&apos;t be undone.
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" variant="danger" onClick={refund} disabled={pending}>
                    {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Yes, refund
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" className="w-full" onClick={() => setConfirming(true)} disabled={mode === "partial" && !amount}>
                Continue
              </Button>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
