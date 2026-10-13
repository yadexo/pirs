import type { CatalogItemType } from "@prisma/client";

/**
 * The "was" price beside a reduced one.
 *
 * The EU's Omnibus rule is that when a trader announces a price reduction,
 * the reference price must be the lowest price that trader applied in the 30
 * days before — not the price that happened to be in force last week, and not
 * a list price nobody ever paid. A clinic that drops €120 to €96, then raises
 * it back to €150 and discounts to €120 again, may only strike through €96.
 *
 * So the rule here is deliberately narrow: a struck price is shown only when
 * it *is* that 30-day low and the client is actually paying less than it.
 * Everything else shows one price and no comparison. That is a worse-looking
 * shop and a correct one.
 */

/** The smallest window the rule talks about. */
export const OMNIBUS_WINDOW_DAYS = 30;

export interface PricePoint {
  priceCents: number;
  recordedAt: Date;
}

/**
 * The lowest price in force at any moment in the window.
 *
 * A row says "from this moment, this price", so the price applying at the
 * start of the window is the last row before it — which is why that row is
 * part of the answer even though it was recorded earlier. Without it a clinic
 * that has not touched a price in a year would look like it had no history.
 */
export function lowestInWindow(history: PricePoint[], now: Date = new Date(), windowDays = OMNIBUS_WINDOW_DAYS): number | null {
  if (history.length === 0) return null;
  const start = new Date(now.getTime() - windowDays * 86_400_000);
  const sorted = [...history].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  const inside = sorted.filter((p) => p.recordedAt >= start && p.recordedAt <= now);
  const before = sorted.filter((p) => p.recordedAt < start).at(-1);

  const applicable = before ? [before, ...inside] : inside;
  if (applicable.length === 0) return null;
  return Math.min(...applicable.map((p) => p.priceCents));
}

/**
 * The price to strike through, or null when there is nothing honest to show.
 *
 * Null is the normal answer. It comes back whenever the client is not paying
 * below the 30-day low — including the case a shop would most like to dress
 * up, where the list price was raised recently and the "discount" only
 * returns it to where it was.
 */
export function referencePrice(
  history: PricePoint[],
  payingCents: number,
  now: Date = new Date(),
  windowDays = OMNIBUS_WINDOW_DAYS,
): number | null {
  const lowest = lowestInWindow(history, now, windowDays);
  if (lowest === null || lowest <= payingCents) return null;
  return lowest;
}

/* ------------------------------------------------------------------ store */

type HistoryRow = { itemType: CatalogItemType; serviceId: string | null; productId: string | null; priceCents: number; recordedAt: Date };

/** Groups rows by the item they belong to, keyed "SERVICE:id" / "PRODUCT:id". */
export function groupHistory(rows: HistoryRow[]): Map<string, PricePoint[]> {
  const out = new Map<string, PricePoint[]>();
  for (const row of rows) {
    const id = row.serviceId ?? row.productId;
    if (!id) continue;
    const key = `${row.itemType}:${id}`;
    const list = out.get(key) ?? [];
    list.push({ priceCents: row.priceCents, recordedAt: row.recordedAt });
    out.set(key, list);
  }
  return out;
}

export const historyKey = (kind: "SERVICE" | "PRODUCT", id: string) => `${kind}:${id}`;

/* ------------------------------------------------------------------ write */

interface WritableDb {
  priceHistory: {
    findFirst(args: unknown): Promise<{ priceCents: number } | null>;
    create(args: unknown): Promise<unknown>;
  };
}

/**
 * Records a price, if it is new.
 *
 * Called on every catalogue save, so most calls are a save that changed a
 * name or a photo and left the price alone. Writing a row for those would
 * fill the window with repeats of the same number and make the oldest real
 * change fall out of it sooner, so an unchanged price writes nothing.
 */
export async function recordPrice(
  db: WritableDb,
  params: { tenantId: string; kind: "SERVICE" | "PRODUCT"; id: string; priceCents: number; at?: Date },
): Promise<void> {
  const where = params.kind === "SERVICE" ? { serviceId: params.id } : { productId: params.id };
  const last = await db.priceHistory.findFirst({ where: { tenantId: params.tenantId, ...where }, orderBy: { recordedAt: "desc" }, select: { priceCents: true } });
  if (last?.priceCents === params.priceCents) return;

  await db.priceHistory.create({
    data: {
      tenantId: params.tenantId,
      itemType: params.kind,
      ...where,
      priceCents: params.priceCents,
      ...(params.at ? { recordedAt: params.at } : {}),
    },
  });
}
