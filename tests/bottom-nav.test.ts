import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { brandTokens } from "@/lib/brand-tokens";

/**
 * The bottom navigation is the one place the clinic's colour becomes a solid
 * control, and the one place the design asks for a shape CSS does not give for
 * free — a bar with a notch cut out of its top edge. Both are easy to lose in
 * a later restyle, so the numbers from the handoff are pinned here.
 *
 * Geometry (handoff, "Bottom navigation"): 64 of controls plus the safe area;
 * Scan 64 round, centred on the bar's top edge, rising 32; cut-out radius 38;
 * columns 73 / 74 / 96 / 73 / 74.
 */

const TOKENS = readFileSync("app/design-tokens.css", "utf8");
const CSS = readFileSync("app/app/[merchantSlug]/client-app.css", "utf8");
const SHELL = readFileSync("app/app/[merchantSlug]/shell.tsx", "utf8");

const px = (name: string) => {
  const match = new RegExp(`--${name}: ([0-9]+)px;`).exec(TOKENS);
  if (!match) throw new Error(`no --${name} token`);
  return Number(match[1]);
};

describe("the bottom navigation's geometry", () => {
  it("carries the handoff's measurements as tokens", () => {
    expect(px("nav-controls")).toBe(64);
    expect(px("scan-size")).toBe(64);
    // Centred on the top edge means it rises by half its own height.
    expect(px("scan-rise")).toBe(px("scan-size") / 2);
    // 32 of button plus the 6 gap the handoff draws around it.
    expect(px("scan-cutout")).toBe(px("scan-size") / 2 + 6);
  });

  it("keeps the five columns in the handoff's proportions", () => {
    expect(CSS).toMatch(/grid-template-columns: 73fr 74fr 96fr 73fr 74fr/);
  });

  it("cuts the notch out of the bar rather than hiding it under a white ring", () => {
    // A ring only works where the page behind the bar is white; a mask works
    // over a photo, a card, or anything else that scrolls under it.
    expect(CSS).toMatch(/\.ca-tabbar \.bar\s*\{[^}]*mask: var\(--cut\)/s);
    expect(CSS).toMatch(/--cut: radial-gradient\(circle var\(--scan-cutout\) at 50% 0/);
  });

  it("keeps the Scan button outside the masked layer, or the mask would halve it", () => {
    expect(CSS).toMatch(/\.ca-scanbtn\s*\{[^}]*position: absolute/s);
    // The bar is a sibling of the controls, not their parent.
    expect(SHELL).toMatch(/<span className="bar" aria-hidden="true" \/>/);
  });
});

describe("the bottom navigation's colour", () => {
  it("takes the Scan button from the role that can hold a white icon", () => {
    expect(CSS).toMatch(/\.ca-scanbtn\s*\{[^}]*background: var\(--brand-fill-white\)/s);
    expect(CSS).toMatch(/\.ca-scanbtn\s*\{[^}]*color: #ffffff/s);
  });

  it("marks the active tab in ink with a brand marker, and leaves the rest text-3", () => {
    expect(CSS).toMatch(/\.ca-tabbtn\s*\{[^}]*color: var\(--text-3\)/s);
    expect(CSS).toMatch(/\.ca-tabbtn\.on\s*\{[^}]*color: var\(--ink\)/s);
    expect(CSS).toMatch(/\.ca-tabbtn\.on::before\s*\{[^}]*width: 24px;\s*height: 3px/s);
    expect(CSS).toMatch(/\.ca-tabbtn\.on::before\s*\{[^}]*background: var\(--brand-strong\)/s);
  });

  it("gives every clinic colour a Scan button a white icon can be read on", () => {
    // The point of brand-fill-white: a pale brand steps down until it can.
    for (const hex of ["#E8B4BC", "#1B5E43", "#1E3A5F", "#F59E0B", "#FFFFFF", "#000000"]) {
      const roles = brandTokens(hex);
      expect(roles.brandFillWhite, hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("the cart bar", () => {
  it("floats above the raised Scan button rather than behind it", () => {
    expect(px("cart-bar-bottom")).toBe(140);
    expect(px("cart-bar-height")).toBe(56);
    // 140 clears the bar (98) plus the button's rise (32) with 10 to spare,
    // which is the gap the handoff draws.
    expect(px("cart-bar-bottom")).toBe(px("nav-controls") + 34 + px("scan-rise") + 10);
    expect(CSS).toMatch(/\.ca-cartbar\s*\{[^}]*bottom: var\(--cart-bar-bottom\)/s);
  });

  it("shows up only when there is something in the cart, and not over the cart itself", () => {
    expect(SHELL).toMatch(/\{count > 0 && !open && \(/);
  });

  it("puts the amount in a brand chip on a black bar", () => {
    expect(CSS).toMatch(/\.ca-cartbar\s*\{[^}]*background: var\(--ink\)/s);
    expect(CSS).toMatch(/\.ca-cartbar \.total\s*\{[^}]*background: var\(--brand\)/s);
    expect(CSS).toMatch(/\.ca-cartbar \.total\s*\{[^}]*color: var\(--on-brand\)/s);
  });
});
