"use client";

import * as React from "react";
import { BlackButton, BottomSheet, ClientEmptyState, QuantityStepper } from "@/components/client-app/primitives";
import { formatMoney } from "@/lib/utils";
import { getBasketDetailAction, updateClientBasketItemAction } from "@/lib/actions/client-basket";
import { placeOrderAction } from "@/lib/actions/checkout";
import { useCart } from "../cart-context";

interface Line {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

/**
 * Cart and checkout in one sheet — the spec's "no multi-step page flow".
 * Stage 1 is the line items, stage 2 is payment confirm, stage 3 success.
 */
export function CartSheet({ merchantSlug, currency }: { merchantSlug: string; currency: string }) {
  const { open, closeCart, refresh } = useCart();
  const [lines, setLines] = React.useState<Line[]>([]);
  const [stage, setStage] = React.useState<"cart" | "pay" | "done">("cart");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    getBasketDetailAction().then((b) => setLines(b.items)).catch(() => setLines([]));
  }, []);

  React.useEffect(() => {
    if (open) {
      setStage("cart");
      setError(null);
      load();
    }
  }, [open, load]);

  const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const points = Math.floor(subtotal / 100);

  async function setQty(id: string, qty: number) {
    await updateClientBasketItemAction(id, qty);
    load();
    refresh();
  }

  async function checkout() {
    setPending(true);
    setError(null);
    try {
      const result = await placeOrderAction(merchantSlug, undefined, new FormData());
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      setStage("done");
      refresh();
    } catch {
      // placeOrderAction redirects on success, which surfaces here as a throw.
      setStage("done");
      refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={closeCart}
      title={stage === "done" ? "Order confirmed" : stage === "pay" ? "Checkout" : "Your cart"}
      footer={
        lines.length === 0 && stage === "cart" ? undefined : stage === "done" ? (
          <BlackButton className="w-full" onClick={closeCart}>
            Done
          </BlackButton>
        ) : stage === "pay" ? (
          <BlackButton className="w-full" loading={pending} onClick={checkout}>
            Pay {formatMoney(subtotal, currency)}
          </BlackButton>
        ) : (
          <BlackButton className="w-full" onClick={() => setStage("pay")}>
            Checkout
          </BlackButton>
        )
      }
    >
      {stage === "done" ? (
        <div className="py-6 text-center">
          <p className="text-[16px] text-[var(--ink)]">Thanks — your order is confirmed.</p>
          <p className="mt-2 text-[16px] text-[var(--muted)]">You earned {points} points.</p>
        </div>
      ) : lines.length === 0 ? (
        <ClientEmptyState text="Your cart is empty" />
      ) : (
        <>
          <ul className="divide-y divide-[var(--hairline)]">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] text-[var(--ink)]">{l.name}</span>
                  <span className="tabular block text-[16px] text-[var(--muted)]">{formatMoney(l.unitPriceCents, currency)}</span>
                </span>
                {stage === "cart" ? (
                  <QuantityStepper value={l.quantity} onChange={(q) => setQty(l.id, q)} min={0} />
                ) : (
                  <span className="tabular text-[16px] text-[var(--muted)]">×{l.quantity}</span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-1.5 border-t border-[var(--hairline)] pt-4">
            <div className="flex justify-between text-[16px]">
              <span className="text-[var(--muted)]">Subtotal</span>
              <span className="tabular font-semibold">{formatMoney(subtotal, currency)}</span>
            </div>
            <div className="flex justify-between text-[16px]">
              <span className="text-[var(--muted)]">Points earned</span>
              <span className="tabular">{points}</span>
            </div>
          </div>

          {stage === "pay" && (
            <div className="mt-4 rounded-[var(--radius-tile)] bg-[var(--pill-bg)] p-4 text-[16px] text-[var(--muted)]">
              Payment is processed through the clinic&apos;s configured provider.
            </div>
          )}
          {error && <p className="mt-3 text-[15px] text-[var(--danger)]">{error}</p>}
        </>
      )}
    </BottomSheet>
  );
}
