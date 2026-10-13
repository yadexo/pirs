import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

/** Always a labelled badge; the colour repeats the word, it never replaces it. */
const toneClasses: Record<Tone, string> = {
  neutral: "bg-[var(--surface-3)] text-[var(--text-2)]",
  success: "bg-[var(--success-tint)] text-[var(--success)]",
  warning: "bg-[var(--warning-tint)] text-[var(--warning)]",
  danger: "bg-[var(--danger-tint)] text-[var(--danger)]",
  info: "bg-[var(--surface-2)] text-[var(--text-2)]",
  brand: "bg-[var(--brand-soft)] text-[var(--brand-strong)]",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1 rounded-[8px] px-2 text-[14px] font-bold",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
