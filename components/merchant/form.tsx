"use client";

import * as React from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Form building blocks for clinic-portal drawers. Styled on the portal's
 * tokens, and each field shows the message the server returned for it — the
 * server is the only validator that counts.
 */

export type FieldErrors = Record<string, string> | undefined;

const inputBase =
  "w-full rounded-[10px] border bg-surface px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60";

const borderFor = (error?: string) => (error ? "border-[var(--accent-red)]" : "border-border");

export function Field({
  label,
  name,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="mb-1.5 block text-[12px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="mt-1 text-[12px] text-[var(--accent-red)]">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; errors?: FieldErrors; hint?: React.ReactNode };

export function TextField({ label, name, errors, hint, className, ...props }: InputProps) {
  const error = errors?.[name];
  return (
    <Field label={label} name={name} error={error} hint={hint} className={className}>
      <input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        className={cn(inputBase, "h-10", borderFor(error))}
        {...props}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  name,
  errors,
  hint,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; name: string; errors?: FieldErrors; hint?: React.ReactNode }) {
  const error = errors?.[name];
  return (
    <Field label={label} name={name} error={error} hint={hint} className={className}>
      <textarea
        id={name}
        name={name}
        rows={3}
        aria-invalid={Boolean(error)}
        className={cn(inputBase, "py-2 leading-relaxed", borderFor(error))}
        {...props}
      />
    </Field>
  );
}

/** Amount in currency units with the clinic's currency shown in front. */
export function MoneyField({ label, name, errors, hint, currency, className, ...props }: InputProps & { currency: string }) {
  const error = errors?.[name];
  const symbol = React.useMemo(
    () =>
      new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? currency,
    [currency],
  );
  return (
    <Field label={label} name={name} error={error} hint={hint} className={className}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-muted">{symbol}</span>
        <input
          id={name}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={Boolean(error)}
          className={cn(inputBase, "h-10 pl-8 tabular", borderFor(error))}
          {...props}
        />
      </div>
    </Field>
  );
}

export function SelectField({
  label,
  name,
  errors,
  hint,
  options,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  errors?: FieldErrors;
  hint?: React.ReactNode;
  options: { value: string; label: string }[];
}) {
  const error = errors?.[name];
  return (
    <Field label={label} name={name} error={error} hint={hint} className={className}>
      <select id={name} name={name} aria-invalid={Boolean(error)} className={cn(inputBase, "h-10", borderFor(error))} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField({
  label,
  name,
  description,
  defaultChecked,
  checked,
  onChange,
}: {
  label: string;
  name: string;
  description?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-border px-3 py-2.5 hover:bg-app">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        checked={checked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
      />
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        {description && <span className="block text-[12px] text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Uploads to /api/uploads and keeps the resulting URL in a hidden input. */
export function ImageField({
  label,
  name,
  merchantId,
  errors,
  defaultValue,
  multiple = false,
  max = 6,
  hint,
  purpose,
}: {
  label: string;
  name: string;
  merchantId: string;
  errors?: FieldErrors;
  defaultValue?: string | string[] | null;
  multiple?: boolean;
  max?: number;
  hint?: React.ReactNode;
  /** Tells the upload endpoint which extra checks apply, e.g. "app-icon". */
  purpose?: string;
}) {
  const initial = Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : [];
  const [urls, setUrls] = React.useState<string[]>(initial);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const error = uploadError ?? errors?.[name];
  const limit = multiple ? max : 1;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, limit - (multiple ? urls.length : 0))) {
        const body = new FormData();
        body.set("merchantId", merchantId);
        if (purpose) body.set("purpose", purpose);
        body.set("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body });
        const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !json.url) throw new Error(json.error ?? "Upload failed.");
        added.push(json.url);
      }
      setUrls((prev) => (multiple ? [...prev, ...added].slice(0, limit) : added.slice(0, 1)));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Field label={label} name={name} error={error} hint={hint ?? "PNG, JPEG, WebP or GIF, up to 5MB."}>
      {urls.map((u) => (
        <input key={u} type="hidden" name={name} value={u} />
      ))}
      <div className="flex flex-wrap gap-2">
        {urls.map((u) => (
          <div key={u} className="group relative h-20 w-20 overflow-hidden rounded-[10px] border border-border bg-app">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => setUrls((prev) => prev.filter((x) => x !== u))}
              aria-label="Remove image"
              className="absolute right-1 top-1 rounded-full bg-surface/90 p-0.5 text-ink shadow"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {urls.length < limit && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border text-[11px] text-ink-muted hover:bg-app disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {uploading ? "Uploading" : "Add"}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        id={name}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple={multiple}
        className="sr-only"
        onChange={(e) => upload(e.target.files)}
      />
    </Field>
  );
}

/** "2026-10-01T09:00" in the browser's local time, for datetime-local inputs. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Cents to the "49.50" a person types; whole amounts without decimals. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}
