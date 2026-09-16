import { z } from "zod";

/**
 * The prices a clinic can offer for one thing it sells, beyond the single
 * price: bundles ("3 sessions for €249") and variations ("Small area €120,
 * Large area €180"). Everything is optional — a clinic that only sells one
 * price per item never sees these.
 *
 * Kept as JSON on the item rather than its own table: a clinic edits the whole
 * list in one form, and nothing else in the system references a single row.
 */

export const bundleSchema = z.object({
  /** What the clinic calls it. Empty falls back to "N × <unit>". */
  label: z.string().max(80).optional(),
  quantity: z.number().int().min(2, "A bundle is two or more").max(999),
  priceCents: z.number().int().min(0).max(100_000_000),
});

export const variationSchema = z.object({
  name: z.string().min(1, "Name this option").max(80),
  priceCents: z.number().int().min(0).max(100_000_000),
});

export const pricingOptionsSchema = z.object({
  bundles: z.array(bundleSchema).max(12, "Up to 12 bundles"),
  variations: z.array(variationSchema).max(12, "Up to 12 variations"),
});

export type Bundle = z.infer<typeof bundleSchema>;
export type Variation = z.infer<typeof variationSchema>;
export type PricingOptions = z.infer<typeof pricingOptionsSchema>;

export const EMPTY_PRICING: PricingOptions = { bundles: [], variations: [] };

/** Reads what was stored, tolerating anything older or hand-edited. */
export function readPricingOptions(value: unknown): PricingOptions {
  const parsed = pricingOptionsSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_PRICING;
}

/** Null when there is nothing to store, so an untouched item stays empty. */
export function toStoredPricingOptions(options: PricingOptions): PricingOptions | null {
  return options.bundles.length === 0 && options.variations.length === 0 ? null : options;
}

/**
 * What one purchase costs. A variation replaces the base price; a bundle
 * replaces the price of that whole quantity. Otherwise it is price × quantity.
 */
export function priceFor(
  basePriceCents: number,
  quantity: number,
  options: PricingOptions,
  choice: { variationName?: string | null; bundleQuantity?: number | null } = {},
): number {
  const variation = choice.variationName ? options.variations.find((v) => v.name === choice.variationName) : undefined;
  const unit = variation?.priceCents ?? basePriceCents;
  const bundle = choice.bundleQuantity ? options.bundles.find((b) => b.quantity === choice.bundleQuantity) : undefined;
  if (bundle) return bundle.priceCents;
  return unit * Math.max(1, quantity);
}

/** "3 sessions" — the clinic's own label wins when it set one. */
export function bundleLabel(bundle: Bundle, unitLabel: string | null | undefined): string {
  if (bundle.label?.trim()) return bundle.label.trim();
  const unit = (unitLabel ?? "item").trim() || "item";
  return `${bundle.quantity} × ${unit}`;
}
