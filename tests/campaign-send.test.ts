import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ rawDb: {} }));
vi.mock("@/lib/marketing", () => ({ marketingAudience: async () => [], sendMarketingCampaign: async () => ({ devices: 0, clients: 0, skipped: {} }) }));

const { promotionStillWorthAnnouncing, campaignPath } = await import("@/lib/campaign-send");

/**
 * A notification about an offer is only worth sending while the offer is
 * worth having — a clinic that switches one off shouldn't have yesterday's
 * plan arrive on its clients' phones tomorrow morning.
 */
describe("whether an offer is still worth announcing", () => {
  const now = new Date("2026-07-01T10:00:00Z");
  const tomorrow = new Date("2026-07-02T10:00:00Z");
  const yesterday = new Date("2026-06-30T10:00:00Z");

  it("announces a live offer", () => {
    expect(promotionStillWorthAnnouncing({ active: true, endAt: tomorrow }, now)).toEqual({ ok: true });
  });

  it("refuses one the clinic switched off", () => {
    expect(promotionStillWorthAnnouncing({ active: false, endAt: tomorrow }, now)).toEqual({ ok: false, reason: "offer-inactive" });
  });

  it("refuses one that has already ended", () => {
    expect(promotionStillWorthAnnouncing({ active: true, endAt: yesterday }, now)).toEqual({ ok: false, reason: "offer-ended" });
  });

  it("treats an offer ending exactly now as over", () => {
    expect(promotionStillWorthAnnouncing({ active: true, endAt: now }, now)).toEqual({ ok: false, reason: "offer-ended" });
  });

  it("leaves a campaign that isn't about an offer alone", () => {
    expect(promotionStillWorthAnnouncing(null, now)).toEqual({ ok: true });
  });
});

describe("where a notification opens", () => {
  it("opens one product when the offer is about one product", () => {
    expect(campaignPath("prod_123")).toBe("/shop?product=prod_123");
  });

  it("opens the shop otherwise", () => {
    expect(campaignPath(null)).toBe("/shop");
  });

  it("is relative to the clinic's app, not to a host", () => {
    // Where the app sits differs per device — the root of the clinic's own
    // domain, "/riverside" on the shared host — so the path carries no
    // prefix at all. lib/push-base-path.ts adds the right one per
    // subscription, and tests/push-base-path.test.ts covers that.
    for (const path of [campaignPath(null), campaignPath("prod_1")]) {
      expect(path.startsWith("/")).toBe(true);
      expect(path).not.toContain("/app/");
    }
  });
});
