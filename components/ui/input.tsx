import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-[14px] bg-surface px-4 text-[16px] text-ink placeholder:text-ink-faint",
        "shadow-[inset_0_0_0_1px_var(--line-strong)]",
        "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-[14px] bg-surface px-4 py-3 text-[16px] text-ink placeholder:text-ink-faint",
        "shadow-[inset_0_0_0_1px_var(--line-strong)]",
        "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-12 w-full rounded-[14px] bg-surface px-4 text-[16px] text-ink",
        "shadow-[inset_0_0_0_1px_var(--line-strong)]",
        "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-ink", className)} {...props} />;
}

export function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="mt-1 text-sm text-danger">{children}</p>;
}

export function FieldHint({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-sm text-ink-subtle">{children}</p>;
}
