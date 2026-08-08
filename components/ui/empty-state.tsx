import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The single empty state used across the whole product. Copy is passed in
 * verbatim from the spec — do not paraphrase per-screen strings.
 */
export function EmptyState({
  title,
  action,
  className,
  icon,
  description,
}: {
  title: string;
  /** Only a few screens specify an action; most are illustration + text. */
  action?: React.ReactNode;
  className?: string;
  /** Replaces the default illustration. Used by the client-facing app. */
  icon?: React.ReactNode;
  /** Supporting line under the title. Admin screens use title only. */
  description?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {icon ? <div className="text-ink-faint">{icon}</div> : <EmptyIllustration />}
      <p className="mt-4 text-[14px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[12px] text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Neutral grey "ID card + terminal + books" placeholder graphic. */
function EmptyIllustration() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <circle cx="48" cy="48" r="48" fill="var(--bg-app)" />
      <rect x="22" y="34" width="34" height="24" rx="4" fill="#E2E8F0" />
      <rect x="27" y="40" width="10" height="10" rx="2" fill="#CBD5E1" />
      <rect x="40" y="41" width="12" height="2.5" rx="1.25" fill="#CBD5E1" />
      <rect x="40" y="46" width="9" height="2.5" rx="1.25" fill="#CBD5E1" />
      <rect x="48" y="46" width="28" height="20" rx="4" fill="#CBD5E1" />
      <path d="M54 53l4 3-4 3" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="62" y="58" width="8" height="2" rx="1" fill="#94A3B8" />
      <rect x="26" y="62" width="6" height="14" rx="1.5" fill="#CBD5E1" />
      <rect x="34" y="59" width="6" height="17" rx="1.5" fill="#E2E8F0" />
      <rect x="42" y="64" width="6" height="12" rx="1.5" fill="#CBD5E1" />
    </svg>
  );
}

/** Inset "No data available" panel used inside stat widgets. */
export function InsetEmpty({ text = "No data available" }: { text?: string }) {
  return (
    <div className="mt-3 flex items-center justify-center rounded-[10px] bg-app py-8 text-[12px] text-ink-muted">
      {text}
    </div>
  );
}
