"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Search } from "lucide-react";
import { Panel, Pill, Drawer } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";

export interface CatalogItem {
  id: string;
  name: string;
  meta: string;
  priceCents: number | null;
  active: boolean;
}

/** Per-tab copy. Empty-state strings are verbatim from the spec. */
const TAB_CONFIG: Record<string, { heading: string; create: string; empty: string; filters: [string, string][] }> = {
  "custom-plans": {
    heading: "Custom Plans",
    create: "Create custom plan",
    empty: "No custom plans available",
    filters: [["all", "All"]],
  },
  offers: {
    heading: "Offers",
    create: "Create offer",
    empty: "No offers available",
    filters: [
      ["all", "All"],
      ["offers", "Offers"],
      ["campaigns", "Campaigns"],
    ],
  },
  products: {
    heading: "Products",
    create: "Create product",
    empty: "No products available",
    filters: [
      ["all", "All"],
      ["service", "Services"],
      ["product", "Products"],
    ],
  },
  membership: {
    heading: "Membership",
    create: "Create membership",
    empty: "No memberships available",
    filters: [["all", "All"]],
  },
  rewards: {
    heading: "Rewards",
    create: "Create reward",
    empty: "No rewards available",
    filters: [["all", "All"]],
  },
};

export function CatalogTab({
  merchantId,
  tab,
  q,
  typeFilter,
  currency,
  items,
}: {
  merchantId: string;
  tab: string;
  q: string;
  typeFilter: string;
  currency: string;
  items: CatalogItem[];
}) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<CatalogItem | null>(null);
  const config = TAB_CONFIG[tab] ?? TAB_CONFIG["custom-plans"]!;

  function navigate(next: Partial<{ q: string; type: string }>) {
    const merged = { q, type: typeFilter, ...next };
    const sp = new URLSearchParams({ tab });
    if (merged.q) sp.set("q", merged.q);
    if (merged.type !== "all") sp.set("type", merged.type);
    router.push(`/m/${merchantId}/app-builder?${sp}`);
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{config.heading}</h2>
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ q: new FormData(e.currentTarget).get("q") as string });
            }}
            className="relative"
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search..."
              className="h-8 w-44 rounded-[10px] border border-border bg-surface pl-8 pr-3 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </form>
          <select
            value={typeFilter}
            onChange={(e) => navigate({ type: e.target.value })}
            className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none"
          >
            {config.filters.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => setCreating(true)}>
            <CirclePlus className="h-3.5 w-3.5" /> {config.create}
          </Button>
        </div>
      </div>

      <Panel>
        {items.length === 0 ? (
          <EmptyState title={config.empty} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setEditing(item)}
                  className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-app"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">{item.name}</span>
                    <span className="block text-[11px] text-ink-muted">{item.meta}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {item.priceCents !== null && (
                      <span className="tabular text-[13px] font-medium">{formatMoney(item.priceCents, currency)}</span>
                    )}
                    <Pill tone={item.active ? "green" : "neutral"}>{item.active ? "Active" : "Inactive"}</Pill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Drawer
        open={creating || !!editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? editing.name : config.create}
      >
        <p className="text-[13px] text-ink-muted">
          {editing
            ? "Editing is wired to the existing catalogue actions; the form fields for this tab are not built out yet."
            : "The create form for this tab is not built out yet."}
        </p>
      </Drawer>
    </>
  );
}
