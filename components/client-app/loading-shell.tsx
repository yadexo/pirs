/**
 * What each client-app tab shows for the instant between a tap and the real
 * screen — not a spinner, but a dimmed-out version of that screen's own
 * shape, so switching tabs never reads as the app going blank. Built from
 * `ClientSkeleton` (the shimmering tile), reused per route from loading.tsx.
 *
 * Deliberately approximate, not pixel-matched to each view: the goal is "this
 * is roughly what's coming", not a frame-accurate stand-in.
 */
import type { ReactNode } from "react";
import { ClientSkeleton } from "./primitives";

function Row({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`flex gap-3 px-[var(--app-gutter)] ${className ?? ""}`}>{children}</div>;
}

/** The clinic header every tab but Scan opens with: logo, greeting, name. */
function HeaderSkeleton() {
  return (
    <div className="px-[var(--app-gutter)] pt-[var(--space-2)]">
      <ClientSkeleton className="aspect-video w-full rounded-[var(--radius-lg)]" />
      <ClientSkeleton className="mt-[var(--space-3)] h-3 w-28" />
      <ClientSkeleton className="mt-2 h-6 w-44" />
    </div>
  );
}

/** A horizontal shelf of card-shaped tiles, the shape most sections use. */
function ShelfSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="mt-[var(--space-5)]">
      <ClientSkeleton className="ml-[var(--app-gutter)] h-4 w-32" />
      <Row className="mt-3 overflow-hidden">
        {Array.from({ length: cards }).map((_, i) => (
          <ClientSkeleton key={i} className="h-40 w-32 shrink-0" />
        ))}
      </Row>
    </div>
  );
}

/** A plain vertical list, for screens that are rows rather than shelves. */
function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mt-[var(--space-4)] px-[var(--app-gutter)]">
      {Array.from({ length: rows }).map((_, i) => (
        <ClientSkeleton key={i} className="mb-3 h-16 w-full" />
      ))}
    </div>
  );
}

export function HomeLoading() {
  return (
    <div className="v2-home" aria-hidden="true">
      <HeaderSkeleton />
      <ShelfSkeleton />
      <ShelfSkeleton cards={2} />
    </div>
  );
}

export function ShopLoading() {
  return (
    <div className="v2-shop" aria-hidden="true">
      <div className="px-[var(--app-gutter)] pt-[var(--space-2)]">
        <ClientSkeleton className="h-6 w-20" />
        <Row className="mt-3">
          <ClientSkeleton className="h-8 w-16 rounded-full" />
          <ClientSkeleton className="h-8 w-24 rounded-full" />
          <ClientSkeleton className="h-8 w-20 rounded-full" />
        </Row>
      </div>
      <ShelfSkeleton />
      <ShelfSkeleton cards={2} />
    </div>
  );
}

export function RewardsLoading() {
  return (
    <div className="v2-rewards" aria-hidden="true">
      <div className="px-[var(--app-gutter)] pt-[var(--space-2)]">
        <ClientSkeleton className="h-28 w-full rounded-[var(--radius-lg)]" />
      </div>
      <ListSkeleton rows={4} />
    </div>
  );
}

export function ProfileLoading() {
  return (
    <div className="v2-profile" aria-hidden="true">
      <div className="flex items-center gap-3 px-[var(--app-gutter)] pt-[var(--space-2)]">
        <ClientSkeleton className="h-16 w-16 shrink-0 rounded-full" />
        <div className="flex-1">
          <ClientSkeleton className="h-4 w-32" />
          <ClientSkeleton className="mt-2 h-3 w-20" />
        </div>
      </div>
      <Row className="mt-[var(--space-4)]">
        <ClientSkeleton className="h-9 flex-1" />
        <ClientSkeleton className="h-9 flex-1" />
        <ClientSkeleton className="h-9 flex-1" />
      </Row>
      <ListSkeleton rows={3} />
    </div>
  );
}

export function ScanLoading() {
  return (
    <div className="v2-scan" aria-hidden="true">
      <div className="px-[var(--app-gutter)] pt-[var(--space-2)]">
        <ClientSkeleton className="h-5 w-24" />
        <ClientSkeleton className="mx-auto mt-6 aspect-square w-[70%] rounded-[var(--radius-lg)]" />
      </div>
      <ListSkeleton rows={2} />
    </div>
  );
}
