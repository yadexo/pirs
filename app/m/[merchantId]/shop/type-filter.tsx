"use client";

import { useRouter } from "next/navigation";

/** The old Orders / Payments split, now a single filter over one table. */
export function TypeFilter({ merchantId, value }: { merchantId: string; value: string }) {
  const router = useRouter();
  return (
    <select
      value={value}
      onChange={(e) =>
        router.push(`/m/${merchantId}/shop${e.target.value === "all" ? "" : `?type=${e.target.value}`}`)
      }
      className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none"
    >
      <option value="all">All</option>
      <option value="orders">Orders</option>
      <option value="payments">Payments</option>
      <option value="refunds">Refunds</option>
    </select>
  );
}
