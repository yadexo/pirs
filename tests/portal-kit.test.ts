import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MERCHANT_NAV, SETTINGS_SECTIONS } from "@/lib/nav";

/**
 * The portal on the v2 system. Mostly about what the switch must not have
 * cost: the pages, the tabs and the actions are all still there, and the
 * tokens are shared with the client app rather than copied.
 */

const GLOBALS = readFileSync("app/globals.css", "utf8");
const SHELL = readFileSync("components/shell/app-shell.tsx", "utf8");
const SIDEBAR = readFileSync("components/shell/sidebar.tsx", "utf8");
const TOPBAR = readFileSync("components/shell/top-bar.tsx", "utf8");
const SETTINGS = readFileSync("app/m/[merchantId]/app-builder/settings-tab.tsx", "utf8");

describe("the portal's tokens", () => {
  it("are the client app's, not a second set of hexes", () => {
    // Every portal name points at a v2 role. A raw colour here would be a
    // palette that can drift from the one the clients see.
    for (const [name, role] of [
      ["--bg-app", "--surface-2"],
      ["--bg-surface", "--bg"],
      ["--border", "--line"],
      ["--text-primary", "--ink"],
      ["--text-muted", "--text-2"],
      ["--text-faint", "--text-3"],
      ["--font-sans", "--font-ui"],
    ] as const) {
      expect(GLOBALS, `${name} should map to ${role}`).toMatch(new RegExp(`${name}:\\s*var\\(${role}\\)`));
    }
  });

  it("leaves no v1 hex behind in the token block", () => {
    const block = GLOBALS.slice(GLOBALS.indexOf(":root {"), GLOBALS.indexOf("html,"));
    expect(block, "the portal's :root still names a colour directly").not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("takes the clinic's own colour for the brand roles", () => {
    // Not the platform's teal: the portal shows what the clinic's clients see.
    expect(GLOBALS).toMatch(/--primary:\s*var\(--brand-strong\)/);
    expect(SHELL).toMatch(/brandCssVars\(brandTokens\(accentColor\)\)/);
  });
});

describe("the portal's shell", () => {
  it("still has exactly the six approved sections", () => {
    // tests/nav.test.ts owns the list; this only checks the restyle did not
    // quietly drop one on the way through.
    expect(SHELL).toMatch(/MERCHANT_NAV\.map/);
    expect(MERCHANT_NAV).toHaveLength(6);
  });

  it("holds Redeem, Scan QR and View app, on every page", () => {
    expect(TOPBAR).toMatch(/RedeemButton/);
    expect(TOPBAR).toMatch(/ScanQrButton/);
    expect(TOPBAR).toMatch(/View app/);
    // In the shell, so they do not come and go with the page.
    expect(SHELL).toMatch(/<PortalTopBar/);
  });

  it("marks the active section with ink rather than a colour", () => {
    expect(GLOBALS).toMatch(/\.pk-navrow\.on\s*\{[^}]*background:\s*var\(--ink\)/s);
  });

  it("collapses to icons on a tablet by width, not by a remembered toggle", () => {
    expect(GLOBALS).toMatch(/@media \(max-width: 1199px\)[\s\S]*?\.pk-sidebar\s*\{[\s\S]*?width: 84px/);
    expect(SIDEBAR, "the collapse should not be stored").not.toMatch(/localStorage/);
    // Icon-only still has to say what each row is.
    expect(SIDEBAR).toMatch(/aria-label=\{entry\.label\}/);
  });
});

describe("the portal's pieces", () => {
  it("gives every table the kit's shape without touching each one", () => {
    expect(GLOBALS).toMatch(/\.pk-shell table thead th\s*\{[^}]*height: 44px/s);
    expect(GLOBALS).toMatch(/\.pk-shell table tbody td\s*\{[^}]*height: 64px/s);
  });

  it("puts cards on the grey page with no shadow to separate them", () => {
    expect(GLOBALS).toMatch(/--shadow-card:\s*none/);
    expect(readFileSync("components/ui/primitives.tsx", "utf8")).toMatch(/rounded-\[20px\] bg-surface/);
  });

  it("opens drawers from the right at the kit's width", () => {
    const prims = readFileSync("components/ui/primitives.tsx", "utf8");
    expect(prims).toMatch(/width = "max-w-\[520px\]"/);
    expect(prims).toMatch(/var\(--scrim-drawer\)/);
  });

  it("makes the one main action ink, leaving the brand colour free to mean something", () => {
    expect(readFileSync("components/ui/button.tsx", "utf8")).toMatch(/primary: "bg-\[var\(--ink\)\]/);
  });
});

describe("what the restyle had to keep", () => {
  it("still has all nine Settings sections, and all nine are real", () => {
    expect(SETTINGS_SECTIONS).toHaveLength(9);
    for (const section of SETTINGS_SECTIONS) {
      expect(SETTINGS, section.key).toContain(`data.section === "${section.key}"`);
    }
  });

  it("calls it Credit in the portal too", () => {
    for (const file of [
      "app/m/[merchantId]/clients/client-account.tsx",
      "app/m/[merchantId]/clients/clients-table.tsx",
      "app/m/[merchantId]/app-builder/product-form.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} still says the old name`).not.toMatch(/Account credit|Cash balance|App Cash/);
    }
  });

  it("labels what a clinic types as the price the client pays", () => {
    for (const file of ["app/m/[merchantId]/app-builder/item-forms.tsx", "app/m/[merchantId]/app-builder/product-form.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toContain('label="Price incl. VAT"');
    }
  });
});
