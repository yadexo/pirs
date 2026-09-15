"use client";

import * as React from "react";
import type { ActivityItem } from "@/lib/home-metrics";
import { getActivityFeedAction } from "@/lib/actions/activity";

const POLL_MS = 20_000;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Client activity as it happens: refreshes every 20 seconds while the tab is
 * visible, and immediately when the tab comes back into view. New rows are
 * briefly highlighted.
 */
export function ActivityFeed({ merchantId, initial }: { merchantId: string; initial: ActivityItem[] }) {
  const [items, setItems] = React.useState(initial);
  const [fresh, setFresh] = React.useState<Set<string>>(new Set());
  const known = React.useRef(new Set(initial.map((i) => i.id)));

  // A server refresh (e.g. right after a check-in on this page) brings new rows.
  React.useEffect(() => {
    setItems(initial);
    initial.forEach((i) => known.current.add(i.id));
  }, [initial]);

  React.useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (document.visibilityState !== "visible") return;
      // Offline, or a tab left open across an app update: skip this round quietly.
      const res = await getActivityFeedAction(merchantId).catch(() => null);
      if (cancelled || !res || "error" in res) return;
      const added = res.items.filter((i) => !known.current.has(i.id)).map((i) => i.id);
      res.items.forEach((i) => known.current.add(i.id));
      setItems(res.items);
      if (added.length) {
        setFresh(new Set(added));
        setTimeout(() => !cancelled && setFresh(new Set()), 4000);
      }
    }
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [merchantId]);

  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-[12px] text-ink-muted">No client activity yet. Bookings, purchases and check-ins appear here.</p>;
  }

  return (
    <ul className="no-scrollbar max-h-[300px] flex-1 overflow-y-auto" aria-live="polite">
      {items.map((item) => (
        <li
          key={item.id}
          className={`flex items-start justify-between gap-3 border-b border-border px-5 py-2.5 transition-colors duration-700 last:border-b-0 ${fresh.has(item.id) ? "bg-primary-soft" : ""}`}
        >
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{item.actor}</p>
            <p className="truncate text-[11px] text-ink-muted">{item.event}</p>
          </div>
          <span className="shrink-0 text-[11px] text-ink-faint">{formatWhen(item.at)}</span>
        </li>
      ))}
    </ul>
  );
}
