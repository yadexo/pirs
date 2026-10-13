import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/**
 * The portal's buttons, Pirs v2.
 *
 * "Primary" is ink, not the clinic's colour: there is one main action per page
 * and it is black, which leaves the brand colour free to mean something — an
 * offer tag, a member price — rather than every button at once. "White" is the
 * secondary on a grey page; "outline" and "ghost" keep their old names so the
 * hundred or so call sites do not have to change.
 */
const variantClasses: Record<Variant, string> = {
  primary: "bg-[var(--ink)] text-white hover:opacity-90",
  outline: "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-app",
  ghost: "text-ink-muted hover:bg-app",
  danger: "bg-surface text-[var(--danger)] shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-[var(--danger-tint)]",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-3 text-[14px]",
  md: "h-11 px-4 text-[15px]",
  lg: "h-12 px-5 text-[15px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[14px] font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
