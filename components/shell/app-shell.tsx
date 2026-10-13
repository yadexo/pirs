import * as React from "react";
import { AGENCY_NAV, MERCHANT_NAV, isAgencyNavActive, isMerchantNavActive, merchantHref } from "@/lib/nav";
import { Sidebar, type SidebarEntry, type SupportLink } from "./sidebar";
import { ImpersonationBanner } from "./impersonation-banner";
import { MerchantSwitcher, type SwitchableMerchant } from "./merchant-switcher";
import { PortalTopBar } from "./top-bar";
import { brandCssVars, brandTokens } from "@/lib/brand-tokens";

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
      icon: <Icon className="h-5 w-5" />,
      active: isAgencyNavActive(pathname, item.href),
    };
  });

  return (
    <div className="pk-shell">
      <Sidebar contextName={agencyName} entries={entries} support={support} />
      <main className="pk-main">{children}</main>
    </div>
  );
}

export function MerchantShell({
  merchantId,
  merchantName,
  merchantSlug,
  accentColor,
  support,
  pathname,
  impersonating,
  switchableMerchants,
  viewerName,
  viewerRole,
  children,
}: {
  merchantId: string;
  merchantName: string;
  /** For the top bar's "View app". */
  merchantSlug: string;
  /** The clinic's own colour; the portal's brand roles derive from it. */
  accentColor: string | null;
  support: SupportLink | null;
  pathname: string;
  /** Set when an agency admin is viewing this merchant. */
  impersonating: boolean;
  /** Populated for agency admins so they can jump between merchants. */
  switchableMerchants: SwitchableMerchant[] | null;
  viewerName: string;
  viewerRole: string;
  children: React.ReactNode;
}) {
  const entries: SidebarEntry[] = MERCHANT_NAV.map((item) => {
    const Icon = item.icon;
    return {
      href: merchantHref(merchantId, item.segment),
      label: item.label,
      icon: <Icon className="h-5 w-5" />,
      active: isMerchantNavActive(pathname, merchantId, item.segment),
    };
  });

  // The same derivation the client app uses, so a clinic's colour means the
  // same thing in both places — see lib/brand-tokens.ts.
  const style = brandCssVars(brandTokens(accentColor)) as React.CSSProperties;

  return (
    <div className="pk-shell" style={style}>
      {impersonating && <ImpersonationBanner merchantName={merchantName} />}
      <Sidebar
        contextName={merchantName}
        contextSwitcher={switchableMerchants ? <MerchantSwitcher current={merchantName} merchants={switchableMerchants} /> : undefined}
        entries={entries}
        support={support}
        user={{ name: viewerName, role: viewerRole }}
      />
      <main className="pk-main">
        <PortalTopBar merchantSlug={merchantSlug} />
        <div className="pk-page">{children}</div>
      </main>
    </div>
  );
}
