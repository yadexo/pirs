"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/primitives";
import { describeActionFailure } from "@/lib/action-failure";
import { clientItemsAction, redeemItemAction } from "@/lib/actions/redeem";
import type { ItemView } from "@/lib/redeemable";

/**
 * A client's items inside the record staff already open to look them up — so
 * handing something over when the client has no phone on them is the same
 * search they were doing anyway, not a second place to learn.
 *
 * A manual redemption is marked as manual and can carry a reason, because a
 * clinic owner reading the history later should be able to see which items
 * left without a code being shown.
 */

const TONE = { AVAILABLE: "green", REDEEMED: "amber", VOIDED: "red", EXPIRED: "neutral" } as const;

export function ClientItems({ merchantId, customerProfileId }: { merchantId: string; customerProfileId: string }) {
  const router = useRouter();
  const [items, setItems] = React.useState<ItemView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<ItemView | null>(null);
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(null);
    const res = await clientItemsAction(merchantId, customerProfileId).catch((err) => ({ error: describeActionFailure(err) }));
    if ("error" in res) {
      setError(res.error);
      setItems([]);
      return;
    }
    setItems(res.items);
  }, [merchantId, customerProfileId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function redeem() {
    if (!confirming) return;
    setPending(true);
    const res = await redeemItemAction(merchantId, { itemId: confirming.id, method: "MANUAL", note: note || undefined }).catch((err) => ({
      error: describeActionFailure(err),
    }));
    setPending(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`${res.item.name} redeemed`);
    setConfirming(null);
    setNote("");
    await load();
    router.refresh();
  }

  if (items === null) {
    return (
      <div className="flex h-24 items-center justify-center text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (error) return <p className="rounded-[10px] bg-[var(--accent-red)]/10 px-3 py-2 text-[12px] text-ink">{error}</p>;
  if (items.length === 0) return <p className="py-8 text-center text-[12px] text-ink-muted">Nothing bought in the app yet.</p>;

  if (confirming) {
    return (
      <div className="space-y-3">
        <div className="rounded-card border border-border p-4">
          <p className="text-[15px] font-semibold">{confirming.name}</p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Bought {new Date(confirming.purchasedAt).toLocaleDateString()} · code {confirming.code}
          </p>
        </div>
        <label className="block text-[12px] text-ink-muted">
          Why without a code? (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Client's phone was dead"
            maxLength={200}
            className="mt-1 h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirming(null)} disabled={pending}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={redeem} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Redeem
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-card border border-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{item.name}</p>
            <p className="truncate text-[11px] text-ink-muted">
              {item.status === "REDEEMED" && item.redeemedAt
                ? `Redeemed ${new Date(item.redeemedAt).toLocaleDateString()}${item.redeemedByName ? ` by ${item.redeemedByName}` : ""}`
                : `Bought ${new Date(item.purchasedAt).toLocaleDateString()} · ${item.code}`}
            </p>
          </div>
          {item.status === "AVAILABLE" ? (
            <Button size="sm" variant="outline" onClick={() => setConfirming(item)}>
              Redeem
            </Button>
          ) : (
            <Pill tone={TONE[item.status]}>{item.status.toLowerCase()}</Pill>
          )}
        </li>
      ))}
    </ul>
  );
}
