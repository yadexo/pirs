"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/primitives";
import { describeActionFailure } from "@/lib/action-failure";
import { clientItemsAction, redeemItemAction } from "@/lib/actions/redeem";
import { giftClientItemAction, reissueClientItemAction, voidClientItemAction } from "@/lib/actions/client-items";
import type { ItemView } from "@/lib/redeemable";

/**
 * A client's items inside the record staff already open to look them up — so
 * handing something over when the client has no phone on them is the same
 * search they were doing anyway, not a second place to learn.
 *
 * A manual redemption is marked as manual and can carry a reason, because a
 * clinic owner reading the history later should be able to see which items
 * left without a code being shown.
 *
 * The same panel is where staff take an item back, replace a lost code, and
 * give something away. Each asks for a reason first: the client is told in
 * those words, and sees the item change in their own app either way.
 */

const TONE = { AVAILABLE: "green", REDEEMED: "amber", VOIDED: "red", EXPIRED: "neutral" } as const;

export function ClientItems({ merchantId, customerProfileId }: { merchantId: string; customerProfileId: string }) {
  const router = useRouter();
  const [items, setItems] = React.useState<ItemView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<ItemView | null>(null);
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  /** Taking back, replacing a code, or giving something — each needs a reason. */
  const [acting, setActing] = React.useState<null | { kind: "void" | "reissue"; item: ItemView } | { kind: "gift" }>(null);
  const [reason, setReason] = React.useState("");
  const [giftName, setGiftName] = React.useState("");
  const [giftType, setGiftType] = React.useState<"PRODUCT" | "SERVICE" | "PACKAGE">("SERVICE");

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

  function startAction(next: NonNullable<typeof acting>) {
    setActing(next);
    setReason("");
    setGiftName("");
  }

  async function submitAction(e: React.FormEvent) {
    e.preventDefault();
    if (!acting || pending) return;
    setPending(true);
    const res =
      acting.kind === "gift"
        ? await giftClientItemAction(merchantId, customerProfileId, { name: giftName, itemType: giftType, reason })
        : acting.kind === "void"
          ? await voidClientItemAction(merchantId, acting.item.id, { reason })
          : await reissueClientItemAction(merchantId, acting.item.id, { reason });
    setPending(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(acting.kind === "gift" ? "Item given" : acting.kind === "void" ? "Item taken back" : "New code issued");
    setActing(null);
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

  if (acting) {
    const title =
      acting.kind === "gift" ? "Give an item" : acting.kind === "void" ? `Take back ${acting.item.name}` : `Replace the code for ${acting.item.name}`;
    return (
      <form onSubmit={submitAction} className="space-y-3">
        <p className="text-[13px] font-semibold">{title}</p>

        {acting.kind === "gift" && (
          <>
            <label className="block text-[12px] text-ink-muted">
              What are you giving them?
              <input
                value={giftName}
                onChange={(e) => setGiftName(e.target.value)}
                placeholder="Facial treatment"
                autoFocus
                className="mt-1 h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
            <label className="block text-[12px] text-ink-muted">
              Kind
              <select
                value={giftType}
                onChange={(e) => setGiftType(e.target.value as typeof giftType)}
                className="mt-1 h-10 w-full rounded-[10px] border border-border bg-surface px-2 text-[13px] text-ink outline-none"
              >
                <option value="SERVICE">Treatment</option>
                <option value="PRODUCT">Product</option>
                <option value="PACKAGE">Custom plan</option>
              </select>
            </label>
            {/* Said plainly: this is not a sale, and must never look like one. */}
            <p className="text-[11px] text-ink-faint">Given by the clinic, not paid for. It won&apos;t appear as a purchase.</p>
          </>
        )}

        <label className="block text-[12px] text-ink-muted">
          Reason
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={acting.kind === "void" ? "Issued by mistake" : acting.kind === "reissue" ? "Client lost their code" : "Compensation for a cancelled appointment"}
            maxLength={200}
            autoFocus={acting.kind !== "gift"}
            className="mt-1 h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <p className="text-[11px] text-ink-faint">The client is told, with this reason in your words.</p>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" type="button" onClick={() => setActing(null)} disabled={pending}>
            Cancel
          </Button>
          <Button className="flex-1" type="submit" variant={acting.kind === "void" ? "danger" : "primary"} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {acting.kind === "gift" ? "Give it" : acting.kind === "void" ? "Take it back" : "Issue a new code"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-ink-muted">Nothing bought in the app yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{item.name}</p>
                <p className="truncate text-[11px] text-ink-muted">
                  {item.status === "REDEEMED" && item.redeemedAt
                    ? `Redeemed ${new Date(item.redeemedAt).toLocaleDateString()}${item.redeemedByName ? ` by ${item.redeemedByName}` : ""}`
                    : `${item.source === "GIFT" ? "Given" : "Bought"} ${new Date(item.purchasedAt).toLocaleDateString()} · ${item.code}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {item.status === "AVAILABLE" && (
                  <Button size="sm" variant="outline" onClick={() => setConfirming(item)}>
                    Redeem
                  </Button>
                )}
                {item.status !== "AVAILABLE" && <Pill tone={TONE[item.status]}>{item.status.toLowerCase()}</Pill>}
                {item.status !== "REDEEMED" && (
                  <Button size="sm" variant="ghost" onClick={() => startAction({ kind: "reissue", item })}>
                    New code
                  </Button>
                )}
                {item.status === "AVAILABLE" && (
                  <Button size="sm" variant="ghost" onClick={() => startAction({ kind: "void", item })}>
                    Take back
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button size="sm" variant="outline" onClick={() => startAction({ kind: "gift" })}>
        Give an item
      </Button>
    </div>
  );
}
