"use client";

import * as React from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  Field,
  FormSection,
  ImageField,
  MoneyField,
  SelectField,
  TextAreaField,
  TextField,
  centsToInput,
  type FieldErrors,
} from "@/components/merchant/form";
import { PATHS } from "@/components/client-app/ui";
import { readPricingOptions, type PricingOptions } from "@/lib/pricing-options";
import type { ItemFormProps } from "./item-forms";

/**
 * Create or edit anything the clinic sells: one scrollable panel, every field
 * optional except the name and the price. What the clinic fills in here is
 * exactly what a client sees on the product page — there is no separate
 * publishing step.
 */

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const isNew = (item: Record<string, unknown>) => !item.id;

/** Icons a tag can use, from the client app's own set. */
const TAG_ICONS = ["sparkle", "clock", "shield", "star", "heart", "gift", "check", "tag", "users", "pin", "calendar", "globe"].filter((k) => k in PATHS);

interface TagInput {
  name: string;
  icon: string;
  description: string;
}
interface ResultInput {
  beforeImageUrl: string;
  afterImageUrl: string;
  testimonial: string;
}

function TagIcon({ name, size = 18 }: { name: string; size?: number }) {
  const d = PATHS[name] ?? PATHS.sparkle!;
  return (
    <span
      aria-hidden="true"
      className="inline-flex"
      dangerouslySetInnerHTML={{
        // Built from our own icon table, never from user input.
        __html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`,
      }}
    />
  );
}

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-card border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-semibold"
      >
        {title}
        <ChevronDown className={`h-4 w-4 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {/* Always rendered: a collapsed section still has to submit its fields. */}
      <div hidden={!open} className="space-y-4 border-t border-border px-4 py-4">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function TagPicker({ saved, initial }: { saved: { id: string; name: string; icon: string; description: string | null }[]; initial: TagInput[] }) {
  const [tags, setTags] = React.useState<TagInput[]>(initial);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState<TagInput>({ name: "", icon: "sparkle", description: "" });

  const chosen = new Set(tags.map((t) => t.name.toLowerCase()));
  const suggestions = saved.filter((t) => !chosen.has(t.name.toLowerCase()));

  function add(tag: TagInput) {
    if (!tag.name.trim() || chosen.has(tag.name.trim().toLowerCase())) return;
    setTags((prev) => [...prev, { ...tag, name: tag.name.trim() }].slice(0, 12));
    setDraft({ name: "", icon: "sparkle", description: "" });
    setAdding(false);
  }

  return (
    <Field label="Tags" name="tags" hint="Shown to clients as cards on the product page. Name, icon and a short line explaining it.">
      <input type="hidden" name="tags" value={JSON.stringify(tags)} />
      <div className="space-y-2">
        {tags.map((tag, i) => (
          <div key={`${tag.name}-${i}`} className="flex items-start gap-3 rounded-[10px] border border-border px-3 py-2">
            <span className="mt-0.5 text-primary">
              <TagIcon name={tag.icon} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{tag.name}</span>
              {tag.description && <span className="block text-[12px] text-ink-muted">{tag.description}</span>}
            </span>
            <button type="button" aria-label={`Remove ${tag.name}`} onClick={() => setTags((prev) => prev.filter((_, j) => j !== i))} className="text-ink-faint hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}

        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => add({ name: t.name, icon: t.icon, description: t.description ?? "" })}
                className="inline-flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-[12px] hover:bg-app"
              >
                <TagIcon name={t.icon} size={14} /> {t.name}
              </button>
            ))}
          </div>
        )}

        {adding ? (
          <div className="space-y-3 rounded-card border border-border p-3">
            <TextField label="Tag name" name="__tagName" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} autoFocus />
            <TextField
              label="What it means"
              name="__tagDescription"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              maxLength={160}
              hint="One line, shown under the tag name."
            />
            <Field label="Icon" name="__tagIcon">
              <div className="flex flex-wrap gap-1.5">
                {TAG_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    aria-label={icon}
                    aria-pressed={draft.icon === icon}
                    onClick={() => setDraft({ ...draft, icon })}
                    className={`flex h-9 w-9 items-center justify-center rounded-[10px] border ${draft.icon === icon ? "border-primary bg-primary-soft text-primary" : "border-border text-ink-muted hover:bg-app"}`}
                  >
                    <TagIcon name={icon} />
                  </button>
                ))}
              </div>
            </Field>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => add(draft)}>
                Add tag
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} disabled={tags.length >= 12}>
            <Plus className="h-3.5 w-3.5" /> New tag
          </Button>
        )}
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

const PRICING_TABS = [
  ["individual", "Individual"],
  ["bundles", "In bundles"],
  ["variations", "In variations"],
] as const;

function Pricing({
  currency,
  item,
  errors,
  unitLabel,
}: {
  currency: string;
  item: Record<string, unknown>;
  errors: FieldErrors;
  unitLabel: string;
}) {
  const [tab, setTab] = React.useState<(typeof PRICING_TABS)[number][0]>("individual");
  const [options, setOptions] = React.useState<PricingOptions>(() => readPricingOptions(item.pricingOptions));

  const unit = unitLabel.trim() || "item";
  const money = (cents: number) => (cents / 100).toFixed(2);
  const toCents = (v: string) => Math.round(Number(v.replace(",", ".") || 0) * 100);

  return (
    <FormSection title="Pricing">
      <input type="hidden" name="pricingOptions" value={JSON.stringify(options)} />
      <div className="flex rounded-[10px] border border-border p-0.5 text-[12px]" role="tablist">
        {PRICING_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-[8px] py-1.5 ${tab === key ? "bg-primary-soft font-medium text-primary" : "text-ink-muted"}`}
          >
            {label}
            {key === "bundles" && options.bundles.length > 0 && ` (${options.bundles.length})`}
            {key === "variations" && options.variations.length > 0 && ` (${options.variations.length})`}
          </button>
        ))}
      </div>

      {tab === "individual" && (
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Price" name="price" currency={currency} defaultValue={centsToInput(item.priceCents as number)} errors={errors} required />
          <TextField
            label="Max quantity"
            name="maxQuantity"
            type="number"
            min={1}
            defaultValue={str(item.maxQuantity)}
            errors={errors}
            hint="Most a client can buy at once. Empty means no limit."
          />
        </div>
      )}

      {tab === "bundles" && (
        <div className="space-y-2">
          <p className="text-[12px] text-ink-muted">Sell several at a set price, e.g. 3 {unit}s for one total.</p>
          {options.bundles.map((b, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-[10px] border border-border p-3">
              <TextField
                label="Label"
                name={`__bundleLabel${i}`}
                className="min-w-[8rem] flex-1"
                value={b.label ?? ""}
                placeholder={`${b.quantity} × ${unit}`}
                onChange={(e) => setOptions((o) => ({ ...o, bundles: o.bundles.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))}
              />
              <TextField
                label="Quantity"
                name={`__bundleQty${i}`}
                type="number"
                min={2}
                className="w-24"
                value={String(b.quantity)}
                onChange={(e) => setOptions((o) => ({ ...o, bundles: o.bundles.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value || 2) } : x)) }))}
              />
              <MoneyField
                label="Total price"
                name={`__bundlePrice${i}`}
                currency={currency}
                className="w-32"
                value={money(b.priceCents)}
                onChange={(e) => setOptions((o) => ({ ...o, bundles: o.bundles.map((x, j) => (j === i ? { ...x, priceCents: toCents(e.target.value) } : x)) }))}
              />
              <Button type="button" variant="ghost" size="sm" aria-label="Remove bundle" onClick={() => setOptions((o) => ({ ...o, bundles: o.bundles.filter((_, j) => j !== i) }))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={options.bundles.length >= 12}
            onClick={() => setOptions((o) => ({ ...o, bundles: [...o.bundles, { label: "", quantity: 3, priceCents: 0 }] }))}
          >
            <Plus className="h-3.5 w-3.5" /> Add bundle
          </Button>
        </div>
      )}

      {tab === "variations" && (
        <div className="space-y-2">
          <p className="text-[12px] text-ink-muted">Versions with their own price, e.g. a small and a large area. The client picks one.</p>
          {options.variations.map((v, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-[10px] border border-border p-3">
              <TextField
                label="Name"
                name={`__variationName${i}`}
                className="min-w-[8rem] flex-1"
                value={v.name}
                onChange={(e) => setOptions((o) => ({ ...o, variations: o.variations.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))}
              />
              <MoneyField
                label="Price"
                name={`__variationPrice${i}`}
                currency={currency}
                className="w-32"
                value={money(v.priceCents)}
                onChange={(e) => setOptions((o) => ({ ...o, variations: o.variations.map((x, j) => (j === i ? { ...x, priceCents: toCents(e.target.value) } : x)) }))}
              />
              <Button type="button" variant="ghost" size="sm" aria-label="Remove variation" onClick={() => setOptions((o) => ({ ...o, variations: o.variations.filter((_, j) => j !== i) }))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={options.variations.length >= 12}
            onClick={() => setOptions((o) => ({ ...o, variations: [...o.variations, { name: "", priceCents: 0 }] }))}
          >
            <Plus className="h-3.5 w-3.5" /> Add variation
          </Button>
        </div>
      )}
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// Client results
// ---------------------------------------------------------------------------

function ClientResults({ merchantId, initial }: { merchantId: string; initial: ResultInput[] }) {
  const [results, setResults] = React.useState<ResultInput[]>(initial);
  const update = (i: number, patch: Partial<ResultInput>) => setResults((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <FormSection title="Client results (optional)">
      <input type="hidden" name="clientResults" value={JSON.stringify(results)} />
      <p className="text-[12px] text-ink-muted">Before and after photos with what the client said. Clients swipe between the two photos.</p>
      {results.map((r, i) => (
        <div key={i} className="space-y-3 rounded-card border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ink-muted">Result {i + 1}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setResults((prev) => prev.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ImageField
              label="Before"
              name={`__before${i}`}
              merchantId={merchantId}
              purpose="client-result"
              defaultValue={r.beforeImageUrl || null}
              hint="PNG or JPG, up to 1920×1080."
              onChange={(urls) => update(i, { beforeImageUrl: urls[0] ?? "" })}
            />
            <ImageField
              label="After"
              name={`__after${i}`}
              merchantId={merchantId}
              purpose="client-result"
              defaultValue={r.afterImageUrl || null}
              hint="PNG or JPG, up to 1920×1080."
              onChange={(urls) => update(i, { afterImageUrl: urls[0] ?? "" })}
            />
          </div>
          <TextAreaField
            label="Testimonial"
            name={`__testimonial${i}`}
            value={r.testimonial}
            onChange={(e) => update(i, { testimonial: e.target.value })}
            maxLength={1000}
            hint="Shown as a quote under the photos."
          />
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={results.length >= 20}
        onClick={() => setResults((prev) => [...prev, { beforeImageUrl: "", afterImageUrl: "", testimonial: "" }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add client result
      </Button>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export function ProductPanelForm({ merchantId, currency, item, options, errors, kind }: ItemFormProps & { kind: "product" | "service" }) {
  const [unitLabel, setUnitLabel] = React.useState(str(item.unitLabel));
  const [requiresConsultation, setRequiresConsultation] = React.useState(Boolean(item.requiresConsultation));

  const savedTags = ((item.itemTags as { tag: { id: string; name: string; icon: string; description: string | null } }[] | undefined) ?? []).map((t) => ({
    name: t.tag.name,
    icon: t.tag.icon,
    description: t.tag.description ?? "",
  }));
  const savedResults = ((item.clientResults as { beforeImageUrl: string | null; afterImageUrl: string | null; testimonial: string | null }[] | undefined) ?? []).map((r) => ({
    beforeImageUrl: r.beforeImageUrl ?? "",
    afterImageUrl: r.afterImageUrl ?? "",
    testimonial: r.testimonial ?? "",
  }));

  const categorySuggestions = kind === "service" ? options.serviceCategories : options.productCategories;
  const categoryListId = "category-suggestions";

  return (
    <div className="space-y-5">
      <FormSection title="Basic information">
        <TextField label="Product name" name="name" defaultValue={str(item.name)} errors={errors} required maxLength={120} />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Treatment duration"
            name="durationMinutes"
            type="number"
            min={1}
            step={5}
            defaultValue={str(item.durationMinutes)}
            errors={errors}
            hint="Minutes. Leave empty if it doesn't apply."
          />
          <TextField
            label="Service unit type"
            name="unitLabel"
            value={unitLabel}
            onChange={(e) => setUnitLabel(e.target.value)}
            list="unit-suggestions"
            maxLength={160}
            errors={errors}
            hint="What one of these is called: session, treatment, product…"
          />
          <datalist id="unit-suggestions">
            {["session", "treatment", "product", "consultation", "package", "unit", "syringe", "area"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <TextAreaField label="Product description" name="description" defaultValue={str(item.description)} errors={errors} rows={5} />
        <TextField
          label="Scheduling link"
          name="schedulingUrl"
          type="url"
          inputMode="url"
          placeholder="https://"
          defaultValue={str(item.schedulingUrl)}
          errors={errors}
          hint="Optional. Where clients book this, if you book outside the app."
        />
        <TagPicker saved={options.tags} initial={savedTags} />
        <>
          <TextField
            label="Category"
            name="categoryName"
            defaultValue={str((item.category as { name?: string } | undefined)?.name)}
            list={categoryListId}
            autoComplete="off"
            errors={errors}
            hint="Pick one or type a new category."
          />
          <datalist id={categoryListId}>
            {categorySuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </>
      </FormSection>

      <Pricing currency={currency} item={item} errors={errors} unitLabel={unitLabel} />

      <FormSection title="Product image">
        {kind === "service" ? (
          <ImageField label="Image" name="imageUrl" merchantId={merchantId} purpose="product-image" defaultValue={item.imageUrl as string} errors={errors} hint="PNG or JPG, up to 800×800." />
        ) : (
          <ImageField
            label="Images"
            name="images"
            merchantId={merchantId}
            purpose="product-image"
            multiple
            defaultValue={(item.images as string[]) ?? []}
            errors={errors}
            hint="PNG or JPG, up to 800×800. The first one is the hero image."
          />
        )}
      </FormSection>

      <FormSection title="Practitioner (optional)">
        <SelectField
          label="Who performs this treatment?"
          name="practitionerId"
          defaultValue={str(item.practitionerId)}
          errors={errors}
          hint="Their photo and bio appear on the product page."
          options={[{ value: "", label: "No one in particular" }, ...options.staff.map((s) => ({ value: s.id, label: s.title ? `${s.name} · ${s.title}` : s.name }))]}
        />
      </FormSection>

      <FormSection title="What to expect (optional)">
        <TextAreaField label="Pre-treatment instructions" name="prepInstructions" defaultValue={str(item.prepInstructions)} errors={errors} />
        <TextAreaField label="Post-treatment instructions" name="aftercareInstructions" defaultValue={str(item.aftercareInstructions)} errors={errors} />
      </FormSection>

      <ClientResults merchantId={merchantId} initial={savedResults} />

      <FormSection title="Consultation & payment options">
        <CheckboxField
          name="requiresConsultation"
          label="This treatment requires a warning pop-up for consultation"
          description="Clients see your message and have to acknowledge it before they can buy."
          defaultChecked={Boolean(item.requiresConsultation)}
          onChange={setRequiresConsultation}
        />
        {requiresConsultation && (
          <TextAreaField
            label="What the pop-up says"
            name="consultationNotice"
            defaultValue={str(item.consultationNotice)}
            errors={errors}
            hint="Leave empty to use a neutral default."
          />
        )}
        <CheckboxField
          name="cashBalanceBlocked"
          label="Cash balance cannot be used for this product"
          description="Clients pay for this with a card; their credit stays untouched."
          defaultChecked={Boolean(item.cashBalanceBlocked)}
        />
        <Collapsible title="Other options">
          <CheckboxField name="active" label="Visible" description="Clients can see and buy this." defaultChecked={isNew(item) ? true : Boolean(item.active)} />
          <CheckboxField name="taxable" label="Taxable" defaultChecked={isNew(item) ? true : Boolean(item.taxable)} />
          {kind === "product" && (
            <>
              <TextField label="In stock" name="inventoryQuantity" type="number" min={0} defaultValue={str(item.inventoryQuantity ?? 0)} errors={errors} />
              <TextField label="SKU" name="sku" defaultValue={str(item.sku)} errors={errors} hint="Leave empty to generate one." />
            </>
          )}
        </Collapsible>
      </FormSection>
    </div>
  );
}
