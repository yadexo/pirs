"use client";

import * as React from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ClientImageError, prepareForUpload } from "@/lib/client-image";
import { specFor } from "@/lib/image-spec";
import { ImageCrop, type CropChoice } from "@/components/merchant/image-crop";
import type { UploadErrorCode } from "@/lib/upload-error";

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

interface PendingUpload {
  id: string;
  name: string;
  previewUrl: string;
  phase: "preparing" | "uploading";
  pct: number;
}

/**
 * `fetch` reports no progress for the body it is sending, so a clinic
 * uploading a photo over a slow connection had a spinner and no way to tell
 * a stalled upload from a slow one. XHR is the only API that does.
 */
function xhrUpload(body: FormData, onProgress: (pct: number) => void): Promise<{ url: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ClientImageError("network"));
    xhr.ontimeout = () => reject(new ClientImageError("network"));
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as { url?: string; width?: number; height?: number; code?: UploadErrorCode; params?: Record<string, string | number> };
      if (xhr.status >= 200 && xhr.status < 300 && body.url) {
        resolve({ url: body.url, width: body.width ?? 0, height: body.height ?? 0 });
        return;
      }
      // A body the platform rejected before our route ran has no JSON in it,
      // which is how an oversized upload used to read as "Upload failed."
      reject(new ClientImageError(body.code ?? (xhr.status === 413 ? "imageTooLarge" : "unknown"), body.params));
    };
    xhr.send(body);
  });
}

function asClientFailure(err: unknown): { code: UploadErrorCode; params?: Record<string, string | number> } {
  if (err instanceof ClientImageError) return { code: err.code, params: err.params };
  return { code: "unknown" };
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
  onChange,
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
  /** Called with the current URLs, for forms that keep images in their own state. */
  onChange?: (urls: string[]) => void;
}) {
  const t = useTranslations("merchant.form");
  const initial = Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : [];
  const [urls, setUrls] = React.useState<string[]>(initial);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = React.useState<File | null>(null);
  const cropResolver = React.useRef<((choice: CropChoice | null) => void) | null>(null);
  const error = uploadError ?? errors?.[name];
  const limit = multiple ? max : 1;
  const uploading = pending.length > 0;
  const spec = specFor(purpose);

  /**
   * The server answers with a code rather than a sentence, because an API
   * route has no reliable request locale. Every arm names its key literally
   * so tests/i18n-key-coverage.test.ts can see them.
   */
  function messageFor(code: UploadErrorCode, params?: Record<string, string | number>): string {
    switch (code) {
      case "imageTooLarge":
        return t("errUploadTooLarge");
      case "heicUnsupported":
        return t("errUploadHeic");
      case "unsupportedType":
        return t("errUploadUnsupported");
      case "corrupt":
        return t("errUploadCorrupt");
      case "tooSmall":
        return t("errUploadTooSmall", {
          width: Number(params?.width ?? 0),
          height: Number(params?.height ?? 0),
          minWidth: Number(params?.minWidth ?? 0),
          minHeight: Number(params?.minHeight ?? 0),
        });
      case "tooComplex":
        return t("errUploadTooComplex");
      case "rateLimited":
        return t("errUploadRateLimited");
      case "notAllowed":
        return t("errUploadNotAllowed");
      case "storageMisconfigured":
        return t("errUploadStorage");
      case "network":
        return t("errUploadNetwork");
      default:
        return t("errUploadUnknown");
    }
  }

  // Previews are object URLs of the processed blob; let them go when the
  // field does, or the tab holds every image the clinic ever picked.
  React.useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.previewUrl)), [pending]);

  /** Opens the cropper and waits for the clinic to choose, one file at a time. */
  function requestCrop(file: File): Promise<CropChoice | null> {
    return new Promise((resolve) => {
      cropResolver.current = resolve;
      setCropFile(file);
    });
  }

  function finishCrop(choice: CropChoice | null) {
    cropResolver.current?.(choice);
    cropResolver.current = null;
    setCropFile(null);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);

    const room = limit - (multiple ? urls.length : 0);
    const picked = Array.from(files).slice(0, Math.max(0, room));
    const failures: string[] = [];

    for (const file of picked) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      let previewUrl = "";
      try {
        // Photographs are cropped by the clinic; an icon or a logo is fitted
        // whole, so there is nothing to choose.
        const choice = spec.crop ? await requestCrop(file) : null;
        if (spec.crop && !choice) continue; // backed out of this one
        const prepared = await prepareForUpload(file, purpose, choice ? { crop: choice.crop, aspect: choice.aspect } : {});
        previewUrl = URL.createObjectURL(prepared.blob);
        setPending((prev) => [...prev, { id, name: file.name, previewUrl, phase: "uploading", pct: 0 }]);

        const body = new FormData();
        body.set("merchantId", merchantId);
        if (purpose) body.set("purpose", purpose);
        body.set("file", new File([prepared.blob], prepared.filename, { type: prepared.blob.type }));

        const result = await xhrUpload(body, (pct) => setPending((prev) => prev.map((p) => (p.id === id ? { ...p, pct } : p))));

        // Each success is kept. The old loop threw on the first failure and
        // dropped everything already uploaded in that batch with it.
        setUrls((prev) => {
          const next = multiple ? [...prev, result.url].slice(0, limit) : [result.url];
          onChange?.(next);
          return next;
        });
      } catch (e) {
        const { code, params } = asClientFailure(e);
        failures.push(`${file.name} — ${messageFor(code, params)}`);
      } finally {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPending((prev) => prev.filter((p) => p.id !== id));
      }
    }

    if (failures.length) {
      setUploadError(picked.length === 1 ? failures[0]! : t("uploadPartial", { count: failures.length, names: failures.join("; ") }));
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Field label={label} name={name} error={error} hint={hint ?? (purpose === "logo" || purpose === "app-icon" ? t("uploadHintTransparent") : t("uploadHint"))}>
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
              onClick={() =>
              setUrls((prev) => {
                const next = prev.filter((x) => x !== u);
                onChange?.(next);
                return next;
              })
            }
              aria-label={t("removeImage")}
              className="absolute right-1 top-1 rounded-full bg-surface/90 p-0.5 text-ink shadow"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.id} className="relative h-20 w-20 overflow-hidden rounded-[10px] border border-border bg-app">
            {/* The preview is the processed image, so it appears before the
                upload finishes rather than after it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.previewUrl} alt="" className="h-full w-full object-cover opacity-60" />
            <div className="absolute inset-x-0 bottom-0 bg-surface/90 px-1 pb-1 pt-0.5 text-center text-[10px] font-medium tabular-nums">
              {p.phase === "preparing" ? t("preparing") : t("uploadProgress", { percent: p.pct })}
            </div>
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-border">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${p.pct}%` }} />
            </div>
          </div>
        ))}
        {urls.length + pending.length < limit && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border text-[11px] text-ink-muted hover:bg-app disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {uploading ? t("uploading") : t("add")}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        id={name}
        type="file"
        // .heic/.heif are listed so an iPhone photo picked from Files isn't
        // greyed out. Safari decodes it and lib/client-image.ts converts it;
        // other browsers get a message saying what to do instead.
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.heic,.heif"
        multiple={multiple}
        className="sr-only"
        onChange={(e) => upload(e.target.files)}
      />
      {cropFile && <ImageCrop file={cropFile} aspects={spec.aspects} onDone={finishCrop} />}
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
