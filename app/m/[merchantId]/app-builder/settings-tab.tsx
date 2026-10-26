import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Panel } from "@/components/ui/primitives";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { SettingsData } from "./settings/load";
import {
  AuditLogSection,
  BookingSection,
  BrandingSection,
  GeneralSection,
  IntegrationsSection,
  LocationsSection,
  LoyaltySection,
  NotificationsSection,
  TeamSection,
} from "./settings/sections";

// lib/nav.ts's SETTINGS_SECTIONS key → messages/*.json portal.appBuilder.settingsTab key.
// Same reasoning as components/shell/app-shell.tsx's MERCHANT_NAV_KEYS.
const SETTINGS_SECTION_KEYS: Record<SettingsSection, string> = {
  general: "general",
  branding: "branding",
  team: "team",
  locations: "locations",
  "loyalty-rules": "loyaltyRules",
  booking: "booking",
  notifications: "notifications",
  integrations: "integrations",
  "audit-log": "auditLog",
};

/**
 * Every former merchant-level settings page lives here as a section. The
 * sub-nav is vertical and inside the page — it is never a sidebar entry.
 */
export async function SettingsTab({
  merchantId,
  section,
  data,
  canEdit,
  currency,
  isOwner,
  stripeNotice,
}: {
  merchantId: string;
  section: SettingsSection;
  data: SettingsData;
  /** Whether the viewer may save this section; the server checks again on save. */
  canEdit: boolean;
  currency: string;
  /** The clinic's own owner — not staff, not an agency admin viewing the clinic. */
  isOwner: boolean;
  /** Set when Stripe has just sent the browser back here. */
  stripeNotice: string | null;
}) {
  const t = await getTranslations("portal.appBuilder.settingsTab");
  return (
    // Second-level navigation on the left, as the handoff draws it; the
    // section's own header and its one Primary live inside the card.
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label={t("settingsSections")}>
        {SETTINGS_SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={`/m/${merchantId}/app-builder?tab=settings&section=${s.key}`}
            aria-current={section === s.key ? "page" : undefined}
            className={cn(
              "flex h-12 shrink-0 items-center rounded-[14px] px-4 text-[15px] transition-colors",
              section === s.key ? "bg-[var(--ink)] font-bold text-white" : "text-ink hover:bg-surface",
            )}
          >
            {t(SETTINGS_SECTION_KEYS[s.key])}
          </Link>
        ))}
      </nav>

      <Panel className="p-6">
        <h3 className="text-[22px] font-extrabold leading-7 text-ink">{t(SETTINGS_SECTION_KEYS[section])}</h3>
        <p className="mt-1 text-[15px] text-ink-muted">{t(`${SETTINGS_SECTION_KEYS[section]}Description`)}</p>
        <div className="mt-6">
          {data.section === "general" && <GeneralSection merchantId={merchantId} data={data} canEdit={canEdit} />}
          {data.section === "branding" && <BrandingSection merchantId={merchantId} data={data} canEdit={canEdit} />}
          {data.section === "team" && <TeamSection merchantId={merchantId} data={data} canEdit={canEdit} />}
          {data.section === "locations" && <LocationsSection merchantId={merchantId} data={data} canEdit={canEdit} />}
          {data.section === "loyalty-rules" && <LoyaltySection merchantId={merchantId} data={data} canEdit={canEdit} currency={currency} />}
          {data.section === "booking" && <BookingSection merchantId={merchantId} data={data} canEdit={canEdit} currency={currency} />}
          {data.section === "notifications" && <NotificationsSection merchantId={merchantId} data={data} canEdit={canEdit} />}
          {data.section === "integrations" && <IntegrationsSection merchantId={merchantId} data={data} isOwner={isOwner} notice={stripeNotice} />}
          {data.section === "audit-log" && <AuditLogSection data={data} />}
        </div>
      </Panel>
    </div>
  );
}
