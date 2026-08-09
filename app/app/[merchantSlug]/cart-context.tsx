"use client";

import * as React from "react";
import { getBasketSummaryAction } from "@/lib/actions/client-basket";

interface CartContextValue {
  count: number;
  open: boolean;
  openCart: () => void;
  closeCart: () => void;
  refresh: () => void;
}

const CartContext = React.createContext<CartContextValue | null>(null);

export function CartProvider({ merchantSlug, children }: { merchantSlug: string; children: React.ReactNode }) {
  const [count, setCount] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  const refresh = React.useCallback(() => {
    getBasketSummaryAction().then((s) => setCount(s.count)).catch(() => {});
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh, merchantSlug]);

  return (
    <CartContext.Provider value={{ count, open, openCart: () => setOpen(true), closeCart: () => setOpen(false), refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
