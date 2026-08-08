"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SwitchableMerchant {
  id: string;
  name: string;
}

export function MerchantSwitcher({ current, merchants }: { current: string; merchants: SwitchableMerchant[] }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const router = useRouter();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const filtered = merchants.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-[10px] border border-border px-3 py-2 text-left hover:bg-app"
      >
        <span className="truncate text-[13px] font-medium">{current}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search merchants..."
              className="w-full bg-transparent text-[12px] outline-none placeholder:text-ink-faint"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-[12px] text-ink-muted">No merchants found</li>}
            {filtered.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/m/${m.id}`);
                  }}
                  className={cn(
                    "w-full truncate px-3 py-1.5 text-left text-[12px] hover:bg-app",
                    m.name === current && "font-medium text-primary",
                  )}
                >
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
