import { describe, it, expect } from "vitest";
import {
  AGENCY_NAV,
  MERCHANT_NAV,
  APP_BUILDER_TABS,
  SETTINGS_SECTIONS,
  merchantHref,
  isMerchantNavActive,
  isAgencyNavActive,
  isAppBuilderTab,
  isSettingsSection,
} from "@/lib/nav";

/**
 * Navigation size is a product invariant, not a preference. The whole point
 * of this information architecture is that the sidebar cannot grow: new
 * concepts become tabs, filters, or drawers.
 *
 * If one of these fails, do NOT relax the assertion — move the new concept
 * into an existing page instead.
 */

describe("sidebar invariants", () => {
  it("merchant sidebar has exactly 6 items", () => {
    expect(MERCHANT_NAV).toHaveLength(6);
  });

  it("agency sidebar has exactly 3 items", () => {
    expect(AGENCY_NAV).toHaveLength(3);
  });

  it("merchant sidebar is exactly the approved set, in order", () => {
    expect(MERCHANT_NAV.map((i) => i.label)).toEqual([
      "Home",
      "Appointments",
      "Client Profiles",
      "Shop Summary",
      "Memberships",
      "App Builder",
    ]);
  });

  it("agency sidebar is exactly the approved set, in order", () => {
    expect(AGENCY_NAV.map((i) => i.label)).toEqual(["My Apps", "White Label", "Settings"]);
  });

  it("no nav item declares children, groups, or nesting", () => {
    for (const item of [...MERCHANT_NAV, ...AGENCY_NAV]) {
      expect(item).not.toHaveProperty("children");
      expect(item).not.toHaveProperty("items");
      expect(item).not.toHaveProperty("group");
    }
  });

  it("every merchant nav segment is unique", () => {
    const segments = MERCHANT_NAV.map((i) => i.segment);
    expect(new Set(segments).size).toBe(segments.length);
  });
});

describe("route surface", () => {
  it("produces exactly the 10 approved routes", () => {
    const merchantId = ":merchantId";
    const routes = [
      "/login",
      ...AGENCY_NAV.map((i) => i.href),
      ...MERCHANT_NAV.map((i) => merchantHref(merchantId, i.segment)),
    ];

    expect(routes).toEqual([
      "/login",
      "/agency",
      "/agency/white-label",
      "/agency/settings",
      "/m/:merchantId",
      "/m/:merchantId/appointments",
      "/m/:merchantId/clients",
      "/m/:merchantId/shop",
      "/m/:merchantId/memberships",
      "/m/:merchantId/app-builder",
    ]);
    expect(routes).toHaveLength(10);
  });
});

describe("merchantHref", () => {
  it("returns the bare merchant path for Home", () => {
    expect(merchantHref("m_1", "")).toBe("/m/m_1");
  });

  it("appends the segment for every other page", () => {
    expect(merchantHref("m_1", "clients")).toBe("/m/m_1/clients");
  });
});

describe("active-state matching", () => {
  it("marks Home active only on an exact match", () => {
    expect(isMerchantNavActive("/m/m_1", "m_1", "")).toBe(true);
    expect(isMerchantNavActive("/m/m_1/clients", "m_1", "")).toBe(false);
  });

  it("marks a section active on its subpaths", () => {
    expect(isMerchantNavActive("/m/m_1/app-builder", "m_1", "app-builder")).toBe(true);
    expect(isMerchantNavActive("/m/m_1/app-builder?tab=offers", "m_1", "app-builder")).toBe(true);
  });

  it("marks My Apps active only on an exact match", () => {
    expect(isAgencyNavActive("/agency", "/agency")).toBe(true);
    expect(isAgencyNavActive("/agency/settings", "/agency")).toBe(false);
    expect(isAgencyNavActive("/agency/settings", "/agency/settings")).toBe(true);
  });
});

describe("App Builder tabs", () => {
  it("has exactly the 6 approved tabs, in order", () => {
    expect(APP_BUILDER_TABS.map((t) => t.key)).toEqual([
      "custom-plans",
      "offers",
      "products",
      "membership",
      "rewards",
      "settings",
    ]);
  });

  it("validates tab keys from the query string", () => {
    expect(isAppBuilderTab("offers")).toBe(true);
    expect(isAppBuilderTab("nope")).toBe(false);
    expect(isAppBuilderTab(undefined)).toBe(false);
  });
});

describe("App Builder → Settings sections", () => {
  it("absorbs every former merchant settings page", () => {
    // Branding, Team (Staff), Locations, Loyalty rules, and Audit log were
    // all top-level sidebar items before the collapse.
    const keys = SETTINGS_SECTIONS.map((s) => s.key);
    expect(keys).toContain("branding");
    expect(keys).toContain("team");
    expect(keys).toContain("locations");
    expect(keys).toContain("loyalty-rules");
    expect(keys).toContain("audit-log");
  });

  it("validates section keys from the query string", () => {
    expect(isSettingsSection("team")).toBe(true);
    expect(isSettingsSection("nope")).toBe(false);
    expect(isSettingsSection(undefined)).toBe(false);
  });
});
