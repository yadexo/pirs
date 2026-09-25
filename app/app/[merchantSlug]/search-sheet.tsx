"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useBasePath } from "./base-path";
import { Sheet, Icon, money } from "@/components/client-app/ui";
import { searchCatalogAction, type CatalogSearchResult } from "@/lib/actions/client-catalog";

const RECENTS_KEY = "client-app:recent";

export function SearchSheet({
  merchantSlug,
  currency,
  open,
  onClose,
}: {
  merchantSlug: string;
  currency: string;
  open: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<CatalogSearchResult[]>([]);
  const [recents, setRecents] = React.useState<string[]>([]);
  const router = useRouter();
  const base = useBasePath();

  React.useEffect(() => {
    if (!open) return;
    setQ("");
    setResults([]);
    try {
      setRecents(JSON.parse(localStorage.getItem(`${RECENTS_KEY}:${merchantSlug}`) ?? "[]"));
    } catch {
      setRecents([]);
    }
  }, [open, merchantSlug]);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(() => {
      searchCatalogAction(q).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  function go(r: CatalogSearchResult) {
    try {
      const next = [r.name, ...recents.filter((x) => x !== r.name)].slice(0, 5);
      localStorage.setItem(`${RECENTS_KEY}:${merchantSlug}`, JSON.stringify(next));
    } catch {
      /* private mode — recents are a nicety, not required */
    }
    onClose();
    const tab = r.type === "Membership" ? "memberships" : r.type === "Treatment" ? "treatments" : "browse";
    router.push(`${base}/shop?tab=${tab}`);
  }

  const groups: [string, CatalogSearchResult[]][] = [
    ["Products", results.filter((r) => r.type === "Product")],
    ["Treatments", results.filter((r) => r.type === "Treatment")],
    ["Memberships", results.filter((r) => r.type === "Membership")],
  ];

  return (
    <Sheet open={open} onClose={onClose} full>
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0 14px" }}>
        <span
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--pill-bg)",
            borderRadius: 999,
            height: 50,
            padding: "0 18px",
          }}
        >
          <Icon name="search" size={20} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products, treatments…"
            aria-label="Search"
            style={{ flex: 1, border: 0, background: "transparent", fontSize: 16, outline: "none", color: "var(--ink)" }}
          />
        </span>
        <button onClick={onClose} style={{ color: "var(--muted)", fontSize: 15, fontWeight: 500 }}>
          Cancel
        </button>
      </div>

      {q.trim().length < 2 ? (
        recents.length > 0 ? (
          <>
            <div className="grouplab">Recent</div>
            {recents.map((r) => (
              <button key={r} className="optrow" onClick={() => setQ(r)}>
                <Icon name="clock" size={18} /> {r}
              </button>
            ))}
          </>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 15, padding: "10px 0" }}>Start typing to search the shop.</p>
        )
      ) : results.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 15, padding: "10px 0" }}>No matches. Try another word.</p>
      ) : (
        groups.map(([label, rows]) =>
          rows.length === 0 ? null : (
            <div key={label} style={{ padding: "8px 0" }}>
              <div className="grouplab">{label}</div>
              {rows.map((r) => (
                <button key={r.id} className="optrow" onClick={() => go(r)}>
                  <span style={{ flex: 1 }}>
                    <b style={{ fontSize: 15, display: "block" }}>{r.name}</b>
                    {r.priceCents != null && (
                      <span className="tabular" style={{ fontSize: 13, color: "var(--muted)" }}>
                        {money(r.priceCents, currency)}
                      </span>
                    )}
                  </span>
                  <Icon name="chevR" size={18} />
                </button>
              ))}
            </div>
          ),
        )
      )}
    </Sheet>
  );
}
