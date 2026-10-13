"use client";

import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The base container for every panel: a white card on the grey page, radius 20
 * and no shadow — the page's own colour is what separates them.
 */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[20px] bg-surface", className)} {...props} />;
}

export function PanelHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4 pt-6">
      <div>
        <h2 className="text-[22px] font-extrabold leading-7 text-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-[15px] text-ink-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

type PillTone = "neutral" | "primary" | "green" | "amber" | "red";

/** A status is always a labelled badge; the colour repeats the word. */
const pillTones: Record<PillTone, string> = {
  neutral: "bg-[var(--surface-3)] text-[var(--text-2)]",
  primary: "bg-[var(--brand-soft)] text-[var(--brand-strong)]",
  green: "bg-[var(--success-tint)] text-[var(--success)]",
  amber: "bg-[var(--warning-tint)] text-[var(--warning)]",
  red: "bg-[var(--danger-tint)] text-[var(--danger)]",
};

export function Pill({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: PillTone }) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1 rounded-[8px] px-2 text-[14px] font-bold",
        pillTones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Filter/status chip row item. */
export function Chip({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "shrink-0 rounded-pill border px-3 py-1.5 text-[12px] font-medium transition-colors",
        active ? "border-primary bg-primary-soft text-primary" : "border-border text-ink-muted hover:bg-app",
        className,
      )}
      {...props}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-pill transition-colors disabled:opacity-50",
          checked ? "bg-primary" : "bg-[#CBD5E1]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
      {label && <span className="text-[12px] text-ink-muted">{label}</span>}
    </label>
  );
}

/** Right-hand slide-over. Every detail and create/edit view uses this. */
export function Drawer({
  open,
  onClose,
  onBack,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-[520px]",
}: {
  open: boolean;
  onClose: () => void;
  /** Shows a back arrow beside the title; use it when leaving means going back. */
  onBack?: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    // From the right, so the list it was opened from stays in view.
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[var(--scrim-drawer)]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("relative flex h-full w-full flex-col bg-surface shadow-[var(--elev-drawer)]", width)}
      >
        <div className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
          <div className="flex min-w-0 items-start gap-2">
            {onBack && (
              <button type="button" onClick={onBack} aria-label="Back" className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink hover:bg-app">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-[22px] font-extrabold leading-7 text-ink">{title}</h2>
              {subtitle && <p className="mt-1 text-[15px] text-ink-muted">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-app text-ink hover:bg-[var(--surface-3)]"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-4">{children}</div>
        {/* Sticky footer: Cancel on the left of the one main action. */}
        {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).slice(
    Math.max(0, page - 3),
    Math.max(0, page - 3) + 5,
  );

  return (
    <div className="flex items-center justify-between border-t border-border px-5 py-3">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
        className="text-[12px] text-ink-muted disabled:opacity-40"
      >
        ← Previous
      </button>
      <div className="flex items-center gap-1">
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            className={cn(
              "h-7 w-7 rounded-full text-[12px]",
              p === page ? "bg-[var(--chart-line)] font-medium text-white" : "text-ink-muted hover:bg-app",
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={page === pageCount}
        onClick={() => onPage(page + 1)}
        className="text-[12px] text-ink-muted disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
}
