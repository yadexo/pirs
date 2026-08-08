"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock, Globe, LayoutGrid, List, LogIn, Search, Trash2 } from "lucide-react";
import { Panel, PanelHeader, Pill, Toggle } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { startImpersonationAction } from "@/lib/actions/impersonation";
import { setMerchantActiveAction, deleteMerchantAction } from "@/lib/actions/merchants";
import { toast } from "@/components/ui/toaster";
import { AddMerchantButton } from "./add-merchant";

export interface MerchantRow {
  id: string;
  name: string;
  logoUrl: string | null;
  clientCount: number;
  isActive: boolean;
  verified: boolean;
  createdAt: string;
}

type Sort = "name-asc" | "name-desc" | "newest" | "clients";

export function MerchantList({ merchants }: { merchants: MerchantRow[] }) {
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<Sort>("name-asc");
  const [view, setView] = React.useState<"list" | "grid">("list");
  const searchRef = React.useRef<HTMLInputElement>(null);

  // Ctrl+K / ⌘K focuses merchant search.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? merchants.filter((m) => m.name.toLowerCase().includes(q)) : merchants;
    const sorted = [...filtered];
    switch (sort) {
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "newest":
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case "clients":
        sorted.sort((a, b) => b.clientCount - a.clientCount);
        break;
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [merchants, query, sort]);

  return (
    <Panel>
      <PanelHeader
        title="Your Merchants"
        subtitle="Manage your merchant portfolio"
        right={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search merchants..."
                className="h-8 w-56 rounded-[10px] border border-border bg-surface pl-8 pr-14 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-faint">
                Ctrl+K
              </kbd>
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none"
            >
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
              <option value="newest">Newest</option>
              <option value="clients">Most clients</option>
            </select>
            <div className="flex overflow-hidden rounded-[10px] border border-border">
              <button
                type="button"
                aria-label="List view"
                onClick={() => setView("list")}
                className={cn("px-2 py-1.5", view === "list" ? "bg-primary-soft text-primary" : "text-ink-faint")}
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Grid view"
                onClick={() => setView("grid")}
                className={cn("px-2 py-1.5", view === "grid" ? "bg-primary-soft text-primary" : "text-ink-faint")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        }
      />

      {visible.length === 0 ? (
        <EmptyState title="No merchants yet" action={<AddMerchantButton />} />
      ) : view === "list" ? (
        <ul>
          {visible.map((m) => (
            <MerchantRowItem key={m.id} merchant={m} />
          ))}
        </ul>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((m) => (
            <MerchantCard key={m.id} merchant={m} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function useMerchantActions(merchant: MerchantRow) {
  const [pending, startTransition] = React.useTransition();
  const [active, setActive] = React.useState(merchant.isActive);

  function impersonate() {
    startTransition(() => startImpersonationAction(merchant.id));
  }

  function toggleActive(next: boolean) {
    const verb = next ? "reactivate" : "suspend";
    if (!window.confirm(`Are you sure you want to ${verb} ${merchant.name}?`)) return;
    setActive(next);
    startTransition(async () => {
      await setMerchantActiveAction(merchant.id, next);
      toast.success(next ? "Merchant reactivated" : "Merchant suspended");
    });
  }

  function remove() {
    const typed = window.prompt(`Type "${merchant.name}" to permanently delete this merchant and all of its data.`);
    if (typed !== merchant.name) return;
    startTransition(async () => {
      await deleteMerchantAction(merchant.id);
      toast.success("Merchant deleted");
    });
  }

  return { pending, active, impersonate, toggleActive, remove };
}

function MerchantRowItem({ merchant }: { merchant: MerchantRow }) {
  const { pending, active, impersonate, toggleActive, remove } = useMerchantActions(merchant);
  const router = useRouter();

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0 hover:bg-app">
      <button
        type="button"
        onClick={() => router.push(`/m/${merchant.id}`)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <MerchantAvatar merchant={merchant} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold">{merchant.name}</span>
          <span className="block text-[11px] text-ink-muted">
            {merchant.clientCount} {merchant.clientCount === 1 ? "client" : "clients"}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-2">
        {merchant.verified ? (
          <Pill tone="green">Verified</Pill>
        ) : (
          <Pill tone="neutral">
            <Clock className="h-3 w-3" /> To Verify
          </Pill>
        )}
        <Toggle checked={active} onChange={toggleActive} label={active ? "Active" : "Inactive"} disabled={pending} />
        <button
          type="button"
          onClick={impersonate}
          disabled={pending}
          aria-label={`Open ${merchant.name}`}
          className="rounded-[8px] p-1.5 text-ink-faint hover:bg-app hover:text-primary disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label={`Delete ${merchant.name}`}
          className="rounded-[8px] p-1.5 text-ink-faint hover:bg-app hover:text-[var(--accent-red)] disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function MerchantCard({ merchant }: { merchant: MerchantRow }) {
  const { pending, active, impersonate, toggleActive } = useMerchantActions(merchant);

  return (
    <div className="rounded-card border border-border p-4">
      <div className="flex items-center gap-3">
        <MerchantAvatar merchant={merchant} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{merchant.name}</p>
          <p className="text-[11px] text-ink-muted">
            {merchant.clientCount} {merchant.clientCount === 1 ? "client" : "clients"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        {merchant.verified ? (
          <Pill tone="green">Verified</Pill>
        ) : (
          <Pill tone="neutral">
            <Clock className="h-3 w-3" /> To Verify
          </Pill>
        )}
        <Toggle checked={active} onChange={toggleActive} disabled={pending} />
      </div>
      <Button size="sm" variant="outline" className="mt-3 w-full" onClick={impersonate} loading={pending}>
        Open
      </Button>
    </div>
  );
}

function MerchantAvatar({ merchant }: { merchant: MerchantRow }) {
  return merchant.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={merchant.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-[10px] object-cover" />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-app text-ink-faint">
      <Globe className="h-4 w-4" />
    </span>
  );
}
