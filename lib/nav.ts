import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  CreditCard,
  Home,
  LayoutGrid,
  Palette,
  Settings,
  ShoppingBag,
  Users,
  Wrench,
} from "lucide-react";

/**
 * The complete navigation surface of the product.
 *
 * These two arrays are a hard invariant — the agency sidebar is exactly 3
 * items and the merchant sidebar is exactly 6, enforced by tests/nav.test.ts
 * which fails the build if either count changes.
 *
 * If a new concept needs a home, it becomes a TAB, a FILTER, or a DRAWER
 * inside one of these pages. It does not become a nav item.
 */

export interface NavItem {
  label: string;
  icon: LucideIcon;
}

export interface AgencyNavItem extends NavItem {
  href: string;
}

export interface MerchantNavItem extends NavItem {
  /** Path segment appended to /m/:merchantId — empty string is Home. */
  segment: string;
}

export const AGENCY_NAV: readonly AgencyNavItem[] = [
  { href: "/agency", label: "My Apps", icon: LayoutGrid },
  { href: "/agency/white-label", label: "White Label", icon: Palette },
  { href: "/agency/settings", label: "Settings", icon: Settings },
] as const;

export const MERCHANT_NAV: readonly MerchantNavItem[] = [
  { segment: "", label: "Home", icon: Home },
  { segment: "appointments", label: "Appointments", icon: CalendarDays },
  { segment: "clients", label: "Client Profiles", icon: Users },
  { segment: "shop", label: "Shop Summary", icon: ShoppingBag },
  { segment: "memberships", label: "Memberships", icon: CreditCard },
  { segment: "app-builder", label: "App Builder", icon: Wrench },
] as const;

export function merchantHref(merchantId: string, segment: string): string {
  return segment ? `/m/${merchantId}/${segment}` : `/m/${merchantId}`;
}

/** True when `pathname` is within the given merchant nav entry. */
export function isMerchantNavActive(pathname: string, merchantId: string, segment: string): boolean {
  const href = merchantHref(merchantId, segment);
  return segment === "" ? pathname === href : pathname.startsWith(href);
}

export function isAgencyNavActive(pathname: string, href: string): boolean {
  return href === "/agency" ? pathname === href : pathname.startsWith(href);
}

// ---------------------------------------------------------------------------
// App Builder tabs — inside one page, driven by ?tab=. Never sidebar entries.
// ---------------------------------------------------------------------------

export const APP_BUILDER_TABS = [
  { key: "custom-plans", label: "Custom plans" },
  { key: "offers", label: "Offers" },
  { key: "products", label: "Products" },
  { key: "membership", label: "Membership" },
  { key: "rewards", label: "Rewards" },
  { key: "settings", label: "Settings" },
] as const;

export type AppBuilderTab = (typeof APP_BUILDER_TABS)[number]["key"];

export const DEFAULT_APP_BUILDER_TAB: AppBuilderTab = "custom-plans";

export function isAppBuilderTab(value: string | undefined): value is AppBuilderTab {
  return APP_BUILDER_TABS.some((t) => t.key === value);
}

// ---------------------------------------------------------------------------
// App Builder → Settings sub-nav. Vertical, inside the Settings tab panel.
// This is where every former merchant-level settings page now lives.
// ---------------------------------------------------------------------------

export const SETTINGS_SECTIONS = [
  { key: "general", label: "General" },
  { key: "branding", label: "Branding" },
  { key: "team", label: "Team" },
  { key: "locations", label: "Locations" },
  { key: "loyalty-rules", label: "Loyalty rules" },
  { key: "booking", label: "Booking" },
  { key: "notifications", label: "Notifications" },
  { key: "integrations", label: "Integrations" },
  { key: "audit-log", label: "Audit log" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["key"];

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "general";

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return SETTINGS_SECTIONS.some((s) => s.key === value);
}
