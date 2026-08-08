"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateBasketItemQuantityAction, removeBasketItemAction } from "@/lib/actions/basket";
import { formatMoney } from "@/lib/utils";

export interface BasketLine {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export function BasketItemRow({ tenantSlug, item }: { tenantSlug: string; item: BasketLine }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div>
        <p className="text-sm font-medium">{item.name}</p>
        <p className="text-xs text-ink-subtle">{formatMoney(item.unitPriceCents)} each</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-md border border-border">
          <button
            type="button"
            disabled={pending}
            className="p-1.5 text-ink-muted hover:bg-surface-subtle"
            onClick={() =>
              startTransition(() => updateBasketItemQuantityAction(tenantSlug, item.id, item.quantity - 1))
            }
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-6 text-center text-sm">{item.quantity}</span>
          <button
            type="button"
            disabled={pending}
            className="p-1.5 text-ink-muted hover:bg-surface-subtle"
            onClick={() =>
              startTransition(() => updateBasketItemQuantityAction(tenantSlug, item.id, item.quantity + 1))
            }
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="w-16 text-right text-sm font-medium">{formatMoney(item.unitPriceCents * item.quantity)}</p>
        <button
          type="button"
          disabled={pending}
          aria-label="Remove"
          className="p-1.5 text-ink-subtle hover:text-danger"
          onClick={() => startTransition(() => removeBasketItemAction(tenantSlug, item.id))}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function CheckoutCta({ tenantSlug }: { tenantSlug: string }) {
  return (
    <Link href={`/${tenantSlug}/checkout`}>
      <Button className="w-full">Proceed to checkout</Button>
    </Link>
  );
}
