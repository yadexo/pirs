"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Card / pills / buttons
// ---------------------------------------------------------------------------

export function ClientCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)]", className)}
      {...props}
    />
  );
}

export function StatusPill({ tone = "neutral", children }: { tone?: "neutral" | "active"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-pill)] px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.06em]",
        tone === "active" ? "bg-[var(--black)] text-[var(--on-black)]" : "bg-[var(--pill-bg)] text-[var(--muted)]",
      )}
    >
      {children}
    </span>
  );
}

export function ValuePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="tabular inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--pill-bg)] px-3 py-1.5 text-[15px] font-semibold text-[var(--ink)]">
      {children}
    </span>
  );
}

export function BlackButton({
  className,
  variant = "solid",
  loading,
  disabled,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "white" | "outline"; loading?: boolean }) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "press inline-flex h-[52px] items-center justify-center gap-2 rounded-[var(--radius-pill)] text-[16px] font-semibold transition-opacity disabled:opacity-40",
        variant === "solid" && "bg-[var(--black)] text-[var(--on-black)]",
        variant === "white" && "bg-white text-[var(--ink-strong)]",
        variant === "outline" && "border-2 border-[var(--black)] bg-transparent text-[var(--ink-strong)]",
        className,
      )}
      {...props}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function ClientHeader({
  title,
  logoUrl,
  onBack,
  onSearch,
  onCart,
  cartCount = 0,
}: {
  /** Ignored when logoUrl is set (Home only). */
  title: string;
  logoUrl?: string | null;
  onBack?: () => void;
  onSearch?: () => void;
  onCart?: () => void;
  cartCount?: number;
}) {
  return (
    <header className="safe-top flex h-16 items-center justify-between px-[var(--space-screen-x)]">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Back" className="press -ml-2 p-2 text-[var(--ink-strong)]">
          <ChevronLeftIcon />
        </button>
      ) : logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-10 max-h-10 w-auto object-contain" />
      ) : (
        <h1 className="text-[32px] font-bold leading-none text-[var(--ink-strong)]">{title}</h1>
      )}

      {onBack ? (
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold text-[var(--ink-strong)]">{title}</span>
      ) : null}

      {!onBack && (
        <div className="flex items-center gap-1">
          <button type="button" onClick={onSearch} aria-label="Search" className="press p-2 text-[var(--ink-strong)]">
            <SearchIcon />
          </button>
          <button type="button" onClick={onCart} aria-label="Cart" className="press relative p-2 text-[var(--ink-strong)]">
            <BagIcon />
            {cartCount > 0 && (
              <span className="tabular absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--black)] px-1 text-[10px] font-semibold text-white">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Bottom tab bar
// ---------------------------------------------------------------------------

export interface ClientTab {
  key: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
}

export function ClientTabBar({ tabs, active, onSelect, rewardsDot = false }: { tabs: ClientTab[]; active: string; onSelect: (key: string) => void; rewardsDot?: boolean }) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 rounded-t-[var(--radius-sheet)] bg-[var(--bg-surface)] shadow-[var(--shadow-float)]">
      <div className="grid grid-cols-5 pt-2">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onSelect(t.key)}
              className="press relative flex flex-col items-center gap-1 pb-2"
            >
              <span className={isActive ? "text-[var(--black)]" : "text-[var(--muted)]"}>{t.icon(isActive)}</span>
              {t.key === "rewards" && rewardsDot && (
                <span className="absolute right-[calc(50%-16px)] top-0 h-2 w-2 rounded-full bg-[var(--black)]" />
              )}
              <span className={cn("text-[13px]", isActive ? "font-semibold text-[var(--black)]" : "font-medium text-[var(--muted)]")}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Segmented tabs (in-page, query-param backed)
// ---------------------------------------------------------------------------

export function SegmentedTabs({
  segments,
  active,
  onSelect,
}: {
  segments: { key: string; label: string }[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="relative flex border-b border-[var(--hairline)] px-[var(--space-screen-x)]">
      {segments.map((s) => {
        const isActive = s.key === active;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key)}
            className={cn(
              "relative flex-1 pb-3 pt-2 text-[17px] transition-colors",
              isActive ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]",
            )}
          >
            {s.label}
            {isActive && <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-[var(--black)] transition-all" />}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const startY = React.useRef<number | null>(null);
  const [dragY, setDragY] = React.useState(0);
  const sheetRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  if (!open) return null;

  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0]?.clientY ?? null;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null) return;
    const delta = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (delta > 0) setDragY(delta);
  }
  function onTouchEnd() {
    if (dragY > 90) onClose();
    setDragY(0);
    startY.current = null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="safe-bottom relative flex max-h-[88dvh] w-full max-w-[480px] animate-[sheet-in_220ms_cubic-bezier(0.32,0.72,0,1)] flex-col rounded-t-[var(--radius-sheet)] bg-[var(--bg-surface)]"
        style={{ transform: `translateY(${dragY}px)`, transition: dragY === 0 ? "transform 180ms ease" : "none" }}
      >
        <div className="flex justify-center pt-2.5">
          <span className="h-1 w-9 rounded-full bg-[var(--faint)]" />
        </div>
        {title && <h2 className="px-6 pb-2 pt-3 text-[20px] font-bold text-[var(--ink-strong)]">{title}</h2>}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">{children}</div>
        {footer && <div className="safe-bottom border-t border-[var(--hairline)] px-6 py-4">{footer}</div>}
      </div>
      <style>{`@keyframes sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton / empty state
// ---------------------------------------------------------------------------

export function ClientSkeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[var(--radius-tile)] bg-[var(--pill-bg)]", className)} />;
}

export function ClientEmptyState({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-14 text-center">
      <ScribbleIllustration />
      <p className="mt-4 text-[16px] text-[var(--muted)]">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function ScribbleIllustration() {
  return (
    <svg width="120" height="72" viewBox="0 0 120 72" fill="none" aria-hidden="true">
      <ellipse cx="24" cy="36" rx="18" ry="18" fill="#EDEEF1" />
      <ellipse cx="60" cy="20" rx="10" ry="10" fill="#F1F2F5" />
      <ellipse cx="96" cy="40" rx="14" ry="14" fill="#EDEEF1" />
      <path d="M42 12c4 4 4 8 0 12" stroke="#D7DAE1" strokeWidth="2" strokeLinecap="round" />
      <path d="M78 58c4-4 8-4 12 0" stroke="#D7DAE1" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Quantity stepper
// ---------------------------------------------------------------------------

export function QuantityStepper({ value, onChange, min = 1, max = 99 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-[var(--radius-pill)] bg-[var(--pill-bg)] px-1 py-1">
      <button
        type="button"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Decrease quantity"
        className="press flex h-8 w-8 items-center justify-center rounded-full bg-white text-[18px] leading-none text-[var(--ink)] disabled:opacity-40"
      >
        –
      </button>
      <span className="tabular w-4 text-center text-[15px] font-semibold">{value}</span>
      <button
        type="button"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Increase quantity"
        className="press flex h-8 w-8 items-center justify-center rounded-full bg-white text-[18px] leading-none text-[var(--ink)] disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line icons (26px, thin stroke, matching the spec's descriptions)
// ---------------------------------------------------------------------------

const iconProps = { width: 26, height: 26, viewBox: "0 0 26 26", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function HomeIcon({ active }: { active?: boolean }) {
  return (
    <svg {...iconProps}>
      <path d="M4 12.5 13 5l9 7.5" />
      <path d="M6 11v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
      {active && <circle cx="13" cy="16.5" r="1.1" fill="currentColor" stroke="none" />}
    </svg>
  );
}
export function ShopIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 8h14l-1.2 12.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 8Z" />
      <path d="M9 8V6a4 4 0 0 1 8 0v2" />
    </svg>
  );
}
export function ScanIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 9V6a1 1 0 0 1 1-1h3" />
      <path d="M21 9V6a1 1 0 0 0-1-1h-3" />
      <path d="M5 17v3a1 1 0 0 0 1 1h3" />
      <path d="M21 17v3a1 1 0 0 1-1 1h-3" />
      <rect x="9" y="9" width="8" height="8" rx="1" />
    </svg>
  );
}
export function RewardsIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="10" width="18" height="11" rx="1.5" />
      <path d="M4 14h18" />
      <path d="M13 10v11" />
      <path d="M13 10c-2.2 0-4-1.1-4-3s1.5-3 2.6-2c1 .9 1.4 3 1.4 5Z" />
      <path d="M13 10c2.2 0 4-1.1 4-3s-1.5-3-2.6-2c-1 .9-1.4 3-1.4 5Z" />
    </svg>
  );
}
export function ProfileIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="13" cy="8.5" r="4" />
      <path d="M5 21c1-4 4.5-6 8-6s7 2 8 6" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <circle cx="12.5" cy="12.5" r="7.5" />
      <path d="m21 21-4-4" />
    </svg>
  );
}
function BagIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 9h14l-1.3 13a2 2 0 0 1-2 1.8H10.3a2 2 0 0 1-2-1.8L7 9Z" />
      <path d="M10 9V7a4 4 0 0 1 8 0v2" />
    </svg>
  );
}
function ChevronLeftIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 6-8 7 8 7" />
    </svg>
  );
}
