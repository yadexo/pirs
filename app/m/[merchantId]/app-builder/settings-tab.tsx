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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={`/m/${merchantId}/app-builder?tab=settings&section=${s.key}`}
            aria-current={section === s.key ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-[10px] px-3 py-2 text-[13px] transition-colors",
              section === s.key ? "bg-primary-soft font-medium text-primary" : "text-ink-muted hover:bg-app",
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <Panel className="p-5">
        <h3 className="text-[14px] font-medium">{SETTINGS_SECTIONS.find((s) => s.key === section)?.label}</h3>
        <p className="mt-1 text-[12px] text-ink-muted">{DESCRIPTIONS[section]}</p>
        <div className="mt-5">
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
