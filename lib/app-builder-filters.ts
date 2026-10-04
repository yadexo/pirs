/**
 * Which filter a App Builder tab starts on.
 *
 * Offers starts on Visible. An offer that has been used is hidden rather than
 * deleted (see lib/promotion-usage.ts), so "everything" is a list that grows
 * with every offer the clinic has ever run — the ones they are working on get
 * buried in the ones they tried to delete. The hidden ones are a click away,
 * not gone.
 */
export const DEFAULT_FILTER: Record<string, string> = {
  offers: "visible",
};

export function defaultFilterFor(tab: string): string {
  return DEFAULT_FILTER[tab] ?? "all";
}
