"use client";

import { ClientCard } from "@/components/client-app/primitives";

export interface EarnRule {
  key: string;
  title: string;
  subtitle: string | null;
  badge: string;
}

const ICONS: Record<string, React.ReactNode> = {
  referral: <ShareGlyph />,
  purchase: <BagGlyph />,
  visit: <PinGlyph />,
  birthday: <GiftGlyph />,
};

export function EarnRows({ rules }: { rules: EarnRule[] }) {
  function onRowTap(rule: EarnRule) {
    // Only referral is actionable without extra configuration; the rest are
    // informational until the merchant supplies a review URL etc.
    if (rule.key === "referral" && typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ title: "Join me", url: window.location.origin + window.location.pathname }).catch(() => {});
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {rules.map((r) => (
        <ClientCard key={r.key} className="press">
          <button type="button" onClick={() => onRowTap(r)} className="flex w-full items-center gap-3 p-4 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--pill-bg)] text-[var(--muted)]">
              {ICONS[r.key] ?? <GiftGlyph />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-medium text-[var(--ink)]">{r.title}</span>
              {r.subtitle && <span className="block text-[16px] text-[var(--muted)]">{r.subtitle}</span>}
            </span>
            <span className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--black)] px-3 py-1.5 text-[15px] font-semibold text-[var(--on-black)]">
              {r.badge}
            </span>
          </button>
        </ClientCard>
      ))}
    </div>
  );
}

const glyph = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function ShareGlyph() {
  return (
    <svg {...glyph}>
      <circle cx="15" cy="5" r="2.2" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="15" cy="15" r="2.2" />
      <path d="m7 9 6-3M7 11l6 3" />
    </svg>
  );
}
function BagGlyph() {
  return (
    <svg {...glyph}>
      <path d="M5 6h10l-.9 9.2a1.5 1.5 0 0 1-1.5 1.3H7.4a1.5 1.5 0 0 1-1.5-1.3L5 6Z" />
      <path d="M7.5 6V4.5a2.5 2.5 0 0 1 5 0V6" />
    </svg>
  );
}
function PinGlyph() {
  return (
    <svg {...glyph}>
      <path d="M10 17s4.5-3.8 4.5-7.5a4.5 4.5 0 0 0-9 0C5.5 13.2 10 17 10 17Z" />
      <circle cx="10" cy="9.5" r="1.6" />
    </svg>
  );
}
function GiftGlyph() {
  return (
    <svg {...glyph}>
      <rect x="3.5" y="8" width="13" height="8" rx="1.2" />
      <path d="M3.5 11h13M10 8v8" />
    </svg>
  );
}
