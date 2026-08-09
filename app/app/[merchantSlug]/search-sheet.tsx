"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/client-app/primitives";
import { searchCatalogAction, type CatalogSearchResult } from "@/lib/actions/client-catalog";

const RECENTS_KEY = "client-app:recent-searches";

export function SearchSheet({ merchantSlug, open, onClose }: { merchantSlug: string; open: boolean; onClose: () => void }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<CatalogSearchResult[]>([]);
  const [recents, setRecents] = React.useState<string[]>([]);
  const router = useRouter();

  React.useEffect(() => {
    if (open) {
      try {
        setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]"));
      } catch {
        setRecents([]);
      }
    }
  }, [open]);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      searchCatalogAction(q).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [q]);

  function go(result: CatalogSearchResult) {
    const next = [q, ...recents.filter((r) => r !== q)].slice(0, 6);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    onClose();
    router.push(`/app/${merchantSlug}/shop?item=${result.id}`);
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Search">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search products, treatments, memberships…"
        className="h-12 w-full rounded-[var(--radius-pill)] bg-[var(--pill-bg)] px-4 text-[16px] outline-none placeholder:text-[var(--faint)]"
      />

      {q.trim().length < 2 && recents.length > 0 && (
        <div className="mt-5">
          <p className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]">Recent</p>
          <ul className="mt-2 space-y-1">
            {recents.map((r) => (
              <li key={r}>
                <button type="button" onClick={() => setQ(r)} className="press w-full py-2 text-left text-[16px] text-[var(--ink)]">
                  {r}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-5 space-y-1">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => go(r)} className="press flex w-full items-center justify-between py-2.5 text-left">
                <span className="text-[16px] text-[var(--ink)]">{r.name}</span>
                <span className="text-[13px] text-[var(--muted)]">{r.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
