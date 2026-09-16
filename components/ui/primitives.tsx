"use client";

import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Rounded surface card — the base container for every panel. */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-border bg-surface shadow-card", className)} {...props} />;
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-[14px] font-medium">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-ink-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

type PillTone = "neutral" | "primary" | "green" | "amber" | "red";

const pillTones: Record<PillTone, string> = {
  neutral: "border-border text-ink-muted",
  primary: "border-primary text-primary",
  green: "border-transparent bg-[var(--accent-green)]/10 text-[var(--accent-green)]",
  amber: "border-transparent bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]",
  red: "border-transparent bg-[var(--accent-red)]/10 text-[var(--accent-red)]",
};

export function Pill({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: PillTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-medium",
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
  width = "max-w-lg",
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
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[rgba(15,23,42,0.35)]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("relative flex h-full w-full flex-col border-l border-border bg-surface", width)}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div className="flex items-start gap-2">
            {onBack && (
              <button type="button" onClick={onBack} aria-label="Back" className="-ml-1 rounded-md p-1 text-ink-muted hover:bg-app">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-ink-muted">{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-faint hover:bg-app">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>}
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
