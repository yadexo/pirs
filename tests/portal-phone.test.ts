/**
 * The portal at phone width: the desk's actions are reachable, and staff can
 * sign out.
 *
 * The top bar right-aligned three labelled buttons that need about 600px, so
 * on a 390px phone "Verzilveren" (redeem) slid off the left edge under the
 * sidebar. And the collapsed sidebar (below 1200px) hid the sign-out button,
 * with nothing in its place — a shared front-desk phone or tablet could not be
 * signed out. Checked in the browser at 390px too; these pin the rules.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const CSS = readFileSync("app/globals.css", "utf8");

/** The bodies of every @media (max-width: N px) block for the given N. */
function mediaBlocks(maxWidth: number): string {
  const out: string[] = [];
  const re = new RegExp(`@media \\(max-width: ${maxWidth}px\\)\\s*\\{`, "g");
  for (const m of CSS.matchAll(re)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    for (; i < CSS.length && depth > 0; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}") depth--;
    }
    out.push(CSS.slice(m.index! + m[0].length, i - 1));
  }
  return out.join("\n");
}

describe("the portal on a phone", () => {
  it("keeps the sign-out button when the sidebar collapses", () => {
    const tablet = mediaBlocks(1199);
    expect(tablet).not.toMatch(/\.pk-user \.out[^{]*\{[^}]*display:\s*none/);
    expect(tablet).toMatch(/\.pk-user\s*\{[^}]*flex-direction:\s*column/);
  });

  it("starts the top bar from the left on a phone, so the first action cannot slide off", () => {
    const phone = mediaBlocks(640);
    expect(phone).toMatch(/\.pk-topbar\s*\{[^}]*justify-content:\s*flex-start/);
  });

  it("hides the top-bar labels only visually on a phone, so they still name the buttons", () => {
    const phone = mediaBlocks(640);
    const rule = /\.pk-toplab\s*\{([^}]*)\}/.exec(phone)?.[1] ?? "";
    expect(rule, "a .pk-toplab rule in the phone block").not.toBe("");
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).toMatch(/clip/);
    for (const file of ["components/merchant/redeem.tsx", "components/merchant/scan-qr.tsx", "components/shell/top-bar.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toMatch(/className="pk-toplab"/);
    }
  });
});
