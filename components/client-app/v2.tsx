"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon, money } from "./ui";

/**
 * The Pirs v2 shared components, built to the sizes in the developer handoff
 * ("Client app components").
 *
 * They live beside the v1 set rather than replacing it: the screens convert one
 * stage at a time, and a half-converted screen mixing the two would look worse
 * than either. When a screen moves over it drops the v1 import; when the last
 * screen has moved, primitives.tsx goes.
 *
 * Every size here is a number from the handoff. Colours are roles from
 * app/design-tokens.css, including the clinic's brand roles, which the client
 * app's layout resolves per request — so nothing here knows a clinic's colour.
 */

/* --------------------------------------------------------------- buttons */

type ButtonVariant = "primary" | "brand" | "grey" | "outline" | "pill";

/**
 * One main action per screen, and that one is `primary`. `brand` exists only
 * for brand surfaces and must never sit next to a primary — the handoff is
 * explicit about it, because two filled buttons stop being a choice.
 */
export function Button({
  variant = "primary",
  amount,
  currency,
  loading,
  className,
  children,
  ...props
}: {
  variant?: ButtonVariant;
  /** Money actions put the amount right-aligned inside the button. */
  amount?: number;
  currency?: string;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cn("v2-btn", `v2-btn-${variant}`, amount !== undefined && "has-amount", className)}
    >
      {loading ? <span className="v2-spinner" aria-label="Working" /> : <span>{children}</span>}
      {!loading && amount !== undefined && <span className="amt tabular">{money(amount, currency)}</span>}
    </button>
  );
}

/**
 * The + on a product card. 36 of button inside a 44 hit area, because a thumb
 * is not 36 wide — the card's own padding absorbs the difference.
 */
export function AddButton({ label = "Add", ...props }: { label?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} {...props} className={cn("v2-add", props.className)}>
      <Icon name="plus" size={20} />
    </button>
  );
}

/* -------------------------------------------------------- inputs, controls */

export function TextField({
  label,
  error,
  id,
  ...props
}: { label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const generated = React.useId();
  const fieldId = id ?? generated;
  const errorId = `${fieldId}-error`;
  return (
    <div className="v2-field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(error && "bad", props.className)}
      />
      {error && (
        <p id={errorId} className="msg" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("v2-switch", checked && "on")}
    >
      <span className="knob" />
    </button>
  );
}

export function Radio({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} aria-label={label} onClick={onChange} className={cn("v2-radio", checked && "on")} />
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="v2-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(o.value === value && "on")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ tags, prices */

export type TagKind = "brand" | "soft" | "photo" | "success" | "warning" | "danger";

export function Tag({ kind = "brand", children }: { kind?: TagKind; children: React.ReactNode }) {
  return <span className={cn("v2-tag", `v2-tag-${kind}`)}>{children}</span>;
}

/**
 * The price a viewer actually pays, and — for a non-member — what they would
 * pay as a member. `wasCents` is struck through only when it is a real earlier
 * price; a member price is not an earlier price and belongs in `memberCents`.
 */
export function PriceBlock({
  cents,
  currency,
  wasCents,
  memberCents,
  isMember,
  onJoin,
}: {
  cents: number;
  currency?: string;
  wasCents?: number | null;
  memberCents?: number | null;
  isMember?: boolean;
  onJoin?: () => void;
}) {
  const showMemberLine = !isMember && memberCents != null && memberCents < cents;
  return (
    <div className="v2-price">
      <div className="row">
        <span className="now tabular">{money(cents, currency)}</span>
        {wasCents != null && wasCents > cents && <span className="was tabular">{money(wasCents, currency)}</span>}
        {isMember && <Tag kind="soft">MEMBER</Tag>}
      </div>
      {showMemberLine &&
        (onJoin ? (
          <button type="button" className="member" onClick={onJoin}>
            Members pay {money(memberCents!, currency)} →
          </button>
        ) : (
          <span className="member">Members pay {money(memberCents!, currency)}</span>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------ product card */

export function ProductCard({
  name,
  meta,
  imageUrl,
  tags,
  shape = "grid",
  onAdd,
  onOpen,
  children,
  ...price
}: {
  name: string;
  /** Duration for a treatment, size for a product. */
  meta?: string | null;
  imageUrl?: string | null;
  /** At most two; the handoff allows no more on one photo. */
  tags?: React.ReactNode;
  shape?: "grid" | "row";
  onAdd?: () => void;
  /** Opens the detail sheet. */
  onOpen?: () => void;
  children?: React.ReactNode;
} & React.ComponentProps<typeof PriceBlock>) {
  const photo = (
    <>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" loading="lazy" />
      ) : (
        // Never stock imagery: a clinic without a photo gets its own colour
        // and the first letter, which at least says which product this is.
        <span className="ph" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </>
  );

  /**
   * The photo and the name open the item; the + adds it. They are siblings
   * rather than nested, because a button inside a button is invalid markup and
   * browsers disagree about which one a tap belongs to.
   */
  return (
    <article className={cn("v2-card", shape === "row" && "row")}>
      <div className="photo">
        {onOpen ? (
          <button type="button" className="open" onClick={onOpen} aria-label={name}>
            {photo}
          </button>
        ) : (
          photo
        )}
        {tags && <div className="tags">{tags}</div>}
        {/* The + sits on the photo's corner, as the boards draw it — on a
            160-wide card there is no room for it beside the price. */}
        {onAdd && <AddButton label={`Add ${name}`} onClick={onAdd} />}
      </div>
      <div className="body">
        {onOpen ? (
          <button type="button" className="title" onClick={onOpen}>
            <h3>{name}</h3>
          </button>
        ) : (
          <h3>{name}</h3>
        )}
        {meta && <p className="meta">{meta}</p>}
        <div className="foot">
          <PriceBlock {...price} />
        </div>
        {children}
      </div>
    </article>
  );
}
