"use client";

import * as React from "react";
import { AlertTriangle, Check, Info } from "lucide-react";
import { checkFields, blockingCount, type TextCheckInput, type TextIssue } from "@/lib/text-check";

/**
 * The Text check panel, and the hook the editors drive it with.
 *
 * It reads what the clinic is typing and says what they may not promise. It
 * never edits the words — it names the phrase and suggests a replacement, and
 * the clinic decides. Publishing is blocked while a blocking issue is open;
 * saving a draft never is, because a draft nobody sees harms nobody.
 */

export function useTextCheck(fields: Record<string, TextCheckInput | undefined>) {
  // Recomputed per keystroke: the rules are string matches over a few hundred
  // characters, which is cheaper than the render that follows them.
  const byField = checkFields(fields);
  const all = Object.values(byField).flat();
  return { byField, issues: all, blocking: blockingCount(all) };
}

/** The issues for one field, shown under it. */
export function FieldIssues({ issues }: { issues: TextIssue[] | undefined }) {
  if (!issues || issues.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2">
      {issues.map((issue, i) => (
        <li key={`${issue.rule}-${i}`} className="flex gap-2 text-[14px] leading-5">
          <AlertTriangle
            className={`mt-0.5 h-4 w-4 shrink-0 ${issue.level === "block" ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}
            aria-hidden="true"
          />
          <span>
            <span className={issue.level === "block" ? "text-[var(--danger)]" : "text-[var(--warning)]"}>{issue.message}</span>{" "}
            <span className="text-ink-muted">{issue.fix}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The summary panel: what was checked, what is wrong, and whether this can be
 * published. A clean list is worth showing — it is the only way a clinic
 * learns the check exists before it ever fires.
 */
export function TextCheckPanel({ issues, blocking }: { issues: TextIssue[]; blocking: number }) {
  const checks = [
    { label: "No result promises", failed: issues.some((i) => i.rule === "result-promise") },
    { label: "No prescription medicine names", failed: issues.some((i) => i.rule === "prescription-name") },
    { label: "“Free” only for things that cost nothing", failed: issues.some((i) => i.rule === "free") },
    { label: "Urgency only with a real end date", failed: issues.some((i) => i.rule === "urgency-without-date") },
  ];

  return (
    <div className="rounded-[14px] bg-app p-4">
      <p className="text-[15px] font-bold text-ink">Text check</p>
      <ul className="mt-3 space-y-2">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2 text-[14px] leading-5">
            {check.failed ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" aria-hidden="true" />
            ) : (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
            )}
            <span className={check.failed ? "text-[var(--danger)]" : "text-ink-muted"}>{check.label}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 flex items-start gap-2 text-[14px] leading-5 text-ink-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Runs on everything clients read. It is not legal advice — have your final copy reviewed.
      </p>

      {blocking > 0 && (
        <p className="pk-notice pk-notice-warn mt-3">
          <AlertTriangle className="ic h-4 w-4" aria-hidden="true" />
          <span className="txt">
            Fix {blocking} issue{blocking === 1 ? "" : "s"} to publish.
          </span>
        </p>
      )}
    </div>
  );
}
