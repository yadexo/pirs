import { describe, it, expect } from "vitest";
import { brandTokens, contrast, parseHex, FALLBACK_BRAND } from "@/lib/brand-tokens";

/**
 * One clinic colour, resolved into roles that have to be legible.
 *
 * These are the rules the design system promises, so they are tested as
 * rules rather than as a list of expected hexes: a clinic can enter any
 * colour, and "it matched the three examples" would say nothing about the
 * fourth. The handoff's worked examples are checked for their *shape* — a
 * pale brand steps down, a dark brand stays put.
 */
describe("resolving a clinic's brand colour", () => {
  const rgb = (hex: string) => parseHex(hex)!;
  const WHITE = rgb("#FFFFFF");

  const SOFT_PINK = "#E9A6B8";
  const DEEP_GREEN = "#1E4D3B";
  const NAVY = "#1C2B4F";

  it("keeps the clinic's own colour for the brand slot itself", () => {
    // Tags and progress fills use exactly what the clinic chose.
    expect(brandTokens(SOFT_PINK).brand.toLowerCase()).toBe(SOFT_PINK.toLowerCase());
    expect(brandTokens(DEEP_GREEN).brand.toLowerCase()).toBe(DEEP_GREEN.toLowerCase());
  });

  it("makes brand text readable on its own tint and on white", () => {
    for (const hex of [SOFT_PINK, DEEP_GREEN, NAVY, "#FFD400", "#00C2FF", "#7C3AED"]) {
      const roles = brandTokens(hex);
      expect(contrast(rgb(roles.brandStrong), rgb(roles.brandSoft)), `${hex} on its tint`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(roles.brandStrong), WHITE), `${hex} on white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives the Scan button a fill a white icon can sit on", () => {
    for (const hex of [SOFT_PINK, DEEP_GREEN, NAVY, "#FFD400", "#F5F5F4"]) {
      const roles = brandTokens(hex);
      expect(contrast(WHITE, rgb(roles.brandFillWhite)), hex).toBeGreaterThanOrEqual(3);
    }
  });

  it("picks white or ink for text on a brand fill, whichever can be read", () => {
    // A pale pink tag needs dark text; a navy one needs white.
    expect(brandTokens(SOFT_PINK).onBrand).toBe("#0D0D0D");
    expect(brandTokens(NAVY).onBrand).toBe("#FFFFFF");
    expect(brandTokens(DEEP_GREEN).onBrand).toBe("#FFFFFF");
  });

  it("steps a pale brand down to a deeper shade where it must carry white", () => {
    const roles = brandTokens(SOFT_PINK);
    // The pink itself cannot hold a white icon, so the Scan button is darker.
    expect(roles.brandFillWhite.toLowerCase()).not.toBe(SOFT_PINK.toLowerCase());
    expect(contrast(WHITE, rgb(SOFT_PINK))).toBeLessThan(3);
    expect(contrast(WHITE, rgb(roles.brandFillWhite))).toBeGreaterThanOrEqual(3);
  });

  it("leaves a dark brand exactly as the clinic entered it", () => {
    // Deep green and navy already pass every bar, so stepping down would just
    // make a clinic's colour not look like their colour.
    for (const hex of [DEEP_GREEN, NAVY]) {
      const roles = brandTokens(hex);
      expect(roles.brandStrong.toLowerCase(), hex).toBe(hex.toLowerCase());
      expect(roles.brandFillWhite.toLowerCase(), hex).toBe(hex.toLowerCase());
      expect(roles.brandDeep.toLowerCase(), hex).toBe(hex.toLowerCase());
    }
  });

  it("makes the banner shade dark enough for white text", () => {
    for (const hex of [SOFT_PINK, DEEP_GREEN, NAVY, "#FFD400"]) {
      // The handoff's rule is OKLCH L ≤ 0.46; in practice that is comfortably
      // past the 4.5:1 a banner's white text needs.
      expect(contrast(WHITE, rgb(brandTokens(hex).brandDeep)), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the tints pale enough to sit behind content", () => {
    for (const hex of [SOFT_PINK, DEEP_GREEN, NAVY]) {
      const roles = brandTokens(hex);
      // A placeholder or soft badge is a background, so ink has to read on it.
      expect(contrast(rgb(roles.brandSoft), rgb("#0D0D0D")), hex).toBeGreaterThanOrEqual(4.5);
      // And the line shade is a shade stronger than the soft one.
      expect(contrast(rgb(roles.brandLine), WHITE)).toBeGreaterThan(contrast(rgb(roles.brandSoft), WHITE));
    }
  });

  it("falls back rather than breaking on a colour it cannot read", () => {
    const fallback = brandTokens(FALLBACK_BRAND);
    for (const bad of [null, undefined, "", "not a colour", "#12", "rgb(1,2,3)"]) {
      expect(brandTokens(bad as string | null), String(bad)).toEqual(fallback);
    }
  });

  it("accepts the shorthand and the missing hash a clinic might type", () => {
    expect(brandTokens("#1E4D3B").brand).toBe(brandTokens("1E4D3B").brand);
    expect(brandTokens("#fff").brand.toLowerCase()).toBe("#ffffff");
  });

  it("survives the extremes without producing an unreadable role", () => {
    for (const hex of ["#FFFFFF", "#000000", "#F5F5F4"]) {
      const roles = brandTokens(hex);
      expect(contrast(WHITE, rgb(roles.brandFillWhite)), hex).toBeGreaterThanOrEqual(3);
      expect(contrast(rgb(roles.brandStrong), WHITE), hex).toBeGreaterThanOrEqual(4.5);
    }
  });
});
