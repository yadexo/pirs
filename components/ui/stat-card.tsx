import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "purple" | "indigo" | "green" | "amber" | "neutral";

const toneClasses: Record<Tone, string> = {
  purple: "bg-[var(--accent-purple)]/10 text-[var(--accent-purple)]",
  indigo: "bg-[var(--accent-indigo)]/10 text-[var(--accent-indigo)]",
  green: "bg-[var(--accent-green)]/10 text-[var(--accent-green)]",
  amber: "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]",
  neutral: "bg-app text-ink-muted",
};

export function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-card">
      {icon && (
        <span className={cn("mb-3 inline-flex h-8 w-8 items-center justify-center rounded-[10px]", toneClasses[tone])}>
          {icon}
        </span>
      )}
      <p className="tabular text-[24px] font-semibold leading-7">{value}</p>
      <p className="mt-0.5 text-[12px] text-ink-muted">{label}</p>
    </div>
  );
}

/** Compact KPI used on Shop Summary and Memberships — icon sits top-right. */
export function KpiCard({
  label,
  value,
  icon,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div className="relative rounded-card border border-border bg-surface p-5 shadow-card">
      {icon && (
        <span className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-app text-ink-muted">
          {icon}
        </span>
      )}
      <p className="tabular text-[24px] font-semibold leading-7">{value}</p>
      <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-muted">
        {label}
        {tooltip && (
          <span title={tooltip} className="cursor-help text-ink-faint">
            ⓘ
          </span>
        )}
      </p>
    </div>
  );
}
