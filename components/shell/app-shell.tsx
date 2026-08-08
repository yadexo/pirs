import * as React from "react";
import { AGENCY_NAV, MERCHANT_NAV, isAgencyNavActive, isMerchantNavActive, merchantHref } from "@/lib/nav";
import { Sidebar, type SidebarEntry, type SupportLink } from "./sidebar";
import { ImpersonationBanner } from "./impersonation-banner";
import { MerchantSwitcher, type SwitchableMerchant } from "./merchant-switcher";

/**
 * The single shell used by both levels. Nav entries are derived from
 * lib/nav.ts — never hand-assembled — so the sidebar cannot drift from the
 * invariant enforced in tests/nav.test.ts.
 */

export function AgencyShell({
  agencyName,
  support,
  pathname,
  children,
}: {
  agencyName: string;
  support: SupportLink | null;
  pathname: string;
  children: React.ReactNode;
}) {
  const entries: SidebarEntry[] = AGENCY_NAV.map((item) => {
    const Icon = item.icon;
    return {
      href: item.href,
      label: item.label,
      icon: <Icon className="h-4 w-4" />,
      active: isAgencyNavActive(pathname, item.href),
    };
  });

  return (
    <div className="flex min-h-screen bg-app">
      <Sidebar contextName={agencyName} entries={entries} support={support} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

export function MerchantShell({
  merchantId,
  merchantName,
  support,
  pathname,
  impersonating,
  switchableMerchants,
  children,
}: {
  merchantId: string;
  merchantName: string;
  support: SupportLink | null;
  pathname: string;
  /** Set when an agency admin is viewing this merchant. */
  impersonating: boolean;
  /** Populated for agency admins so they can jump between merchants. */
  switchableMerchants: SwitchableMerchant[] | null;
  children: React.ReactNode;
}) {
  const entries: SidebarEntry[] = MERCHANT_NAV.map((item) => {
    const Icon = item.icon;
    return {
      href: merchantHref(merchantId, item.segment),
      label: item.label,
      icon: <Icon className="h-4 w-4" />,
      active: isMerchantNavActive(pathname, merchantId, item.segment),
    };
  });

  return (
    <div className="flex min-h-screen flex-col bg-app">
      {impersonating && <ImpersonationBanner merchantName={merchantName} />}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          contextName={merchantName}
          contextSwitcher={
            switchableMerchants ? (
              <MerchantSwitcher current={merchantName} merchants={switchableMerchants} />
            ) : undefined
          }
          entries={entries}
          support={support}
        />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
