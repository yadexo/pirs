"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/primitives";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Every former merchant-level settings page lives here as a section. The
 * sub-nav is vertical and inside the page — it is never a sidebar entry.
 */
export function SettingsTab({ merchantId, section }: { merchantId: string; section: SettingsSection }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {SETTINGS_SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={`/m/${merchantId}/app-builder?tab=settings&section=${s.key}`}
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
        <p className="mt-6 text-[12px] text-ink-faint">
          Fields for this section are not built out yet — the surface exists so nothing needs its own sidebar entry.
        </p>
      </Panel>
    </div>
  );
}

const DESCRIPTIONS: Record<SettingsSection, string> = {
  general: "App name, welcome message, terms, and other defaults.",
  branding: "The merchant's own app logo and theme colour. Agency white-label is configured separately at the agency level.",
  team: "Invite staff, assign roles, and configure permissions.",
  locations: "Clinic locations and opening hours.",
  "loyalty-rules": "Points per currency unit, visits per reward, and expiry.",
  booking: "Booking link, cancellation window, and reminder timing.",
  notifications: "Default channels and opt-out handling.",
  integrations: "Payments, email, SMS, and push provider configuration.",
  "audit-log": "A record of staff and agency actions taken on this account.",
};
