"use client";

import * as React from "react";
import type { ActivityItem } from "@/lib/home-metrics";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ActivityFeed({ initial }: { initial: ActivityItem[] }) {
  const [items] = React.useState(initial);

  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-[12px] text-ink-muted">No activity yet</p>;
  }

  return (
    <ul className="no-scrollbar max-h-[300px] flex-1 overflow-y-auto">
      {items.map((item) => (
        <li key={item.id} className="flex items-start justify-between gap-3 border-b border-border px-5 py-2.5 last:border-b-0">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium capitalize">{item.actor}</p>
            <p className="truncate text-[11px] text-ink-muted">{item.event}</p>
          </div>
          <span className="shrink-0 text-[11px] text-ink-faint">{formatWhen(item.at)}</span>
        </li>
      ))}
    </ul>
  );
}
