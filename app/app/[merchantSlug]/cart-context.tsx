"use client";

import * as React from "react";
import { clientCartAction } from "@/lib/actions/client-app";

export interface CartLine {
  id: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
}

interface CartContextValue {
  count: number;
  items: CartLine[];
  open: boolean;
  openCart: () => void;
  closeCart: () => void;
  refresh: () => Promise<void>;
}

const CartContext = React.createContext<CartContextValue | null>(null);

export function CartProvider({ merchantSlug, children }: { merchantSlug: string; children: React.ReactNode }) {
  const [count, setCount] = React.useState(0);
  const [items, setItems] = React.useState<CartLine[]>([]);
  const [open, setOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const c = await clientCartAction();
      setCount(c.count);
      setItems(c.items);
    } catch {
      /* logged-out or offline — keep the last known cart */
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh, merchantSlug]);

  return (
    <CartContext.Provider value={{ count, items, open, openCart: () => setOpen(true), closeCart: () => setOpen(false), refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
