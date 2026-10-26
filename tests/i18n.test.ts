import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import nl from "@/messages/nl.json";
import en from "@/messages/en.json";

/**
 * Two kinds of drift a translation catches too late: a key only one file
 * has (the other language silently falls back to the raw key string, which
 * next-intl shows literally — "clientApp.nav.home" on screen, not a blank),
 * and a new piece of UI text someone typed straight into JSX instead of
 * adding it to both message files.
 */

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) => flattenKeys(value, prefix ? `${prefix}.${key}` : key));
}

describe("translation key parity", () => {
  it("has exactly the same keys in nl.json and en.json", () => {
    const nlKeys = new Set(flattenKeys(nl));
    const enKeys = new Set(flattenKeys(en));
    const missingInEn = [...nlKeys].filter((k) => !enKeys.has(k)).sort();
    const missingInNl = [...enKeys].filter((k) => !nlKeys.has(k)).sort();
    expect(missingInEn, "keys present in nl.json but missing from en.json").toEqual([]);
    expect(missingInNl, "keys present in en.json but missing from nl.json").toEqual([]);
  });

  it("has no empty string values in either file", () => {
    const empties = (obj: unknown, prefix = ""): string[] =>
      typeof obj !== "object" || obj === null
        ? obj === "" ? [prefix] : []
        : Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) => empties(value, prefix ? `${prefix}.${key}` : key));
    expect(empties(nl)).toEqual([]);
    expect(empties(en)).toEqual([]);
  });
});

/**
 * A heuristic, not a parser: flags a JSX text node or a string-typed prop
 * (label, title, placeholder, aria-label, alt) that looks like real English
 * prose — multiple words, starts with a capital or is a full sentence —
 * sitting directly in a translated component's source rather than coming
 * from a t() call. Deliberately scoped to the handful of directories this
 * project's Dutch rollout has actually touched (see each tracked directory
 * below); the rest of the app, not yet translated, is excluded on purpose
 * rather than producing hundreds of expected failures this test can't
 * distinguish from real regressions.
 */
const TRACKED_FILES = [
  "app/login/login-form.tsx",
  "app/login/page.tsx",
  "app/account/two-factor/page.tsx",
  "app/account/two-factor/two-factor-manager.tsx",
  "app/agency/settings/two-factor-reset.tsx",
  "app/app/[merchantSlug]/shell.tsx",
  "app/app/[merchantSlug]/card-payment.tsx",
  "app/app/[merchantSlug]/home-view.tsx",
  "app/app/[merchantSlug]/rewards/rewards-view.tsx",
  "app/app/[merchantSlug]/scan/scan-view.tsx",
  "app/app/[merchantSlug]/shop/shop-view.tsx",
  "app/app/[merchantSlug]/cart-sheet.tsx",
  "app/app/[merchantSlug]/profile/my-items.tsx",
  "app/app/[merchantSlug]/search-sheet.tsx",
  "app/app/[merchantSlug]/shop/booking-sheet.tsx",
  "app/app/[merchantSlug]/payment-result.tsx",
  "app/app/[merchantSlug]/onboarding.tsx",
  "app/app/clinic-finder.tsx",
  "app/app/[merchantSlug]/profile/profile-view.tsx",
  "components/shell/sidebar.tsx",
  "components/shell/app-shell.tsx",
  "components/shell/top-bar.tsx",
  "components/shell/impersonation-banner.tsx",
  "components/shell/merchant-switcher.tsx",
  "app/m/[merchantId]/page.tsx",
  "app/m/[merchantId]/stats-grid.tsx",
  "app/m/[merchantId]/activity-feed.tsx",
  "app/m/[merchantId]/appointments/page.tsx",
  "app/m/[merchantId]/appointments/appointments-view.tsx",
  "components/client-app/pwa.tsx",
  "components/merchant/text-check.tsx",
  "app/forgot-password/page.tsx",
  "app/forgot-password/forgot-password-form.tsx",
  "app/set-password/page.tsx",
  "app/set-password/set-password-form.tsx",
  "components/auth/guest-locale-switcher.tsx",
  "app/m/[merchantId]/clients/client-account.tsx",
  "app/m/[merchantId]/clients/client-items.tsx",
  "app/m/[merchantId]/clients/client-membership.tsx",
  "app/m/[merchantId]/clients/client-orders.tsx",
  "app/m/[merchantId]/clients/clients-table.tsx",
  "app/m/[merchantId]/clients/page.tsx",
  "app/m/[merchantId]/clients/personal-discount.tsx",
  "app/m/[merchantId]/shop/page.tsx",
  "app/m/[merchantId]/shop/refund-button.tsx",
  "app/m/[merchantId]/shop/type-filter.tsx",
  "components/merchant/client-packages.tsx",
  "components/merchant/form.tsx",
  "components/merchant/redeem.tsx",
  "components/merchant/scan-qr.tsx",
  "app/m/[merchantId]/app-builder/catalog-tab.tsx",
  "app/m/[merchantId]/app-builder/item-forms.tsx",
  "app/m/[merchantId]/app-builder/product-form.tsx",
  "app/m/[merchantId]/app-builder/notify-offer.tsx",
  "app/m/[merchantId]/app-builder/page.tsx",
  "app/m/[merchantId]/app-builder/settings-tab.tsx",
  "app/m/[merchantId]/app-builder/settings/broadcast.tsx",
  "app/m/[merchantId]/app-builder/settings/daily-limit.tsx",
  "app/m/[merchantId]/app-builder/settings/sending-window.tsx",
  "app/m/[merchantId]/app-builder/settings/sections.tsx",
];

// A loose net: a run of 2+ capitalised English words, or a sentence ending in
// a full stop — the shape of prose, not a CSS class, a variable, or a single
// proper noun like a brand name.
const PROSE_LIKE = /\b([A-Z][a-z]+(?:[\s][A-Za-z][a-z]*){1,}[.?!]?)\b/;
// Known non-prose false positives this heuristic would otherwise flag.
const ALLOWLIST = [
  "DezaAI",
  "Google Authenticator",
  "1Password",
  "Authy",
  "Apple Pay",
  "Google Pay",
  "Stripe",
];

describe("no hardcoded English left behind in translated screens", () => {
  for (const file of TRACKED_FILES) {
    it(`${file} has no obvious hardcoded prose`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const jsxTextNodes = [...source.matchAll(/>([^<>{}\n]{3,})</g)].map((m) => (m[1] ?? "").trim());
      const suspects = jsxTextNodes.filter((text) => {
        if (!PROSE_LIKE.test(text)) return false;
        return !ALLOWLIST.some((allowed) => text.includes(allowed));
      });
      expect(suspects, `looks like untranslated text in ${file}`).toEqual([]);
    });
  }

  it("every directory this suite tracks still exists (catches a silently-stale list)", () => {
    for (const file of TRACKED_FILES) {
      expect(() => readFileSync(join(process.cwd(), file), "utf8"), file).not.toThrow();
    }
  });
});

describe("messages directory", () => {
  it("has exactly nl.json and en.json, no stray files", () => {
    const files = readdirSync(join(process.cwd(), "messages")).sort();
    expect(files).toEqual(["en.json", "nl.json"]);
  });
});
