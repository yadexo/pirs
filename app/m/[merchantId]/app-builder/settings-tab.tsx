import Link from "next/link";
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

const DESCRIPTIONS: Record<SettingsSection, string> = {
  general: "App listing, shop banner, tax and the policies clients see.",
  branding: "Name, logo, app icon, brand colour, contact details and region.",
  team: "Invite staff and decide what each role can do.",
  locations: "Addresses, phone numbers and opening hours.",
  "loyalty-rules": "How clients earn points.",
  booking: "Where clients book, cancellation notice and reminders.",
  notifications: "Automatic messages sent to clients.",
  integrations: "Payments, email and push notifications.",
  "audit-log": "Who changed what, most recent first.",
};

/**
 * Every former merchant-level settings page lives here as a section. The
 * sub-nav is vertical and inside the page — it is never a sidebar entry.
 */
export function SettingsTab({
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
  return (
    // Second-level navigation on the left, as the handoff draws it; the
    // section's own header and its one Primary live inside the card.
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Settings sections">
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
            {s.label}
          </Link>
        ))}
      </nav>

      <Panel className="p-6">
        <h3 className="text-[22px] font-extrabold leading-7 text-ink">{SETTINGS_SECTIONS.find((s) => s.key === section)?.label}</h3>
        <p className="mt-1 text-[15px] text-ink-muted">{DESCRIPTIONS[section]}</p>
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
