"use client";

import * as React from "react";
import { GlossSurface } from "@/components/client-app/gloss-surface";
import { StatusPill } from "@/components/client-app/primitives";
import { mintScanTokenAction } from "@/lib/actions/client-scan";

/**
 * The member card. The QR encodes the client id plus a short-lived signed
 * token, refreshed silently every 60s so a screenshot goes stale.
 */
export function ScanCard({
  firstName,
  joinedDaysAgo,
  isMember,
}: {
  firstName: string;
  joinedDaysAgo: number;
  isMember: boolean;
}) {
  const [payload, setPayload] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const token = await mintScanTokenAction();
        if (!cancelled) setPayload(token);
      } catch {
        /* keep the previous code rather than blanking the card offline */
      }
    }
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Boost brightness while this tab is focused, restore on unmount. Wrapped
  // because the Screen Brightness API only exists in native/PWA contexts.
  React.useEffect(() => {
    const nav = navigator as Navigator & { setScreenBrightness?: (v: number) => void; getScreenBrightness?: () => number };
    const previous = nav.getScreenBrightness?.();
    nav.setScreenBrightness?.(1);
    return () => {
      if (previous !== undefined) nav.setScreenBrightness?.(previous);
    };
  }, []);

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col items-center justify-center px-[var(--space-screen-x)]">
      <div className="w-[86%] overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-float)]">
        <GlossSurface radius="0px" className="flex aspect-[3/4] items-center justify-center">
          <div className="flex aspect-square w-[52%] items-center justify-center rounded-[var(--radius-tile)] bg-white p-3">
            {payload ? <QrPlaceholder value={payload} /> : <span className="text-[12px] text-[var(--faint)]">Loading…</span>}
          </div>
        </GlossSurface>

        <div className="flex items-center gap-3 bg-[var(--bg-surface)] px-4 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--pill-bg)] text-[16px] font-semibold text-[var(--ink)]">
            {firstName.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold text-[var(--ink)]">{firstName}</span>
            <span className="block text-[16px] text-[var(--muted)]">Joined {joinedDaysAgo} days ago</span>
          </span>
          <StatusPill tone={isMember ? "active" : "neutral"}>{isMember ? "Member" : "Not a member"}</StatusPill>
        </div>
      </div>

      <p className="mt-5 max-w-[280px] text-center text-[16px] text-[var(--muted)]">
        Show this at the clinic to check in and earn points.
      </p>
    </div>
  );
}

/**
 * Renders the token as a deterministic matrix. This is a visual stand-in
 * with the correct quiet zone and module density — it is not a scannable
 * QR symbol, which needs a real encoder library (see the note in my summary).
 */
function QrPlaceholder({ value }: { value: string }) {
  const modules = React.useMemo(() => {
    const size = 21;
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    return Array.from({ length: size * size }, (_, i) => {
      const x = i % size;
      const y = Math.floor(i / size);
      const isFinder = (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
      if (isFinder) {
        const lx = x % (size - 7 === x ? size : 1);
        void lx;
        const inX = x < 7 ? x : x - (size - 7);
        const inY = y < 7 ? y : y - (size - 7);
        const ring = Math.max(Math.abs(inX - 3), Math.abs(inY - 3));
        return ring === 1 ? 0 : 1;
      }
      return ((hash >> (i % 31)) ^ (x * 7 + y * 13)) & 1;
    });
  }, [value]);

  return (
    <div className="grid h-full w-full" style={{ gridTemplateColumns: "repeat(21, 1fr)" }} aria-label="Member QR code" role="img">
      {modules.map((m, i) => (
        <span key={i} style={{ background: m ? "var(--ink-strong)" : "transparent" }} />
      ))}
    </div>
  );
}
