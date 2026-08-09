"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ClientHeader,
  ClientTabBar,
  HomeIcon,
  ShopIcon,
  ScanIcon,
  RewardsIcon,
  ProfileIcon,
  type ClientTab,
} from "@/components/client-app/primitives";
import { SearchSheet } from "./search-sheet";
import { useCart } from "./cart-context";

const TABS: ClientTab[] = [
  { key: "home", label: "Home", icon: (a) => <HomeIcon active={a} /> },
  { key: "shop", label: "Shop", icon: () => <ShopIcon /> },
  { key: "scan", label: "Scan", icon: () => <ScanIcon /> },
  { key: "rewards", label: "Rewards", icon: () => <RewardsIcon /> },
  { key: "profile", label: "Profile", icon: () => <ProfileIcon /> },
];

const TITLES: Record<string, string> = { home: "Home", shop: "Shop", scan: "", rewards: "Rewards", profile: "Account" };

function activeTabFromPath(pathname: string, base: string): string {
  const rest = pathname.slice(base.length).replace(/^\//, "");
  const seg = rest.split("/")[0];
  return seg && TABS.some((t) => t.key === seg) ? seg : "home";
}

export function ClientAppShell({
  merchantSlug,
  logoUrl,
  children,
}: {
  merchantSlug: string;
  logoUrl: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/app/${merchantSlug}`;
  const active = activeTabFromPath(pathname, base);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const { count, openCart } = useCart();

  function selectTab(key: string) {
    if (key === active) {
      // Re-tapping the active tab scrolls it to top rather than navigating.
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    router.push(key === "home" ? base : `${base}/${key}`);
  }

  const showHeader = active !== "scan";

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      {showHeader && (
        <ClientHeader
          title={TITLES[active] ?? "Home"}
          logoUrl={active === "home" ? logoUrl : undefined}
          onSearch={() => setSearchOpen(true)}
          onCart={openCart}
          cartCount={count}
        />
      )}
      <main className="min-h-0 flex-1 pb-28">{children}</main>
      <ClientTabBar tabs={TABS} active={active} onSelect={selectTab} />
      <SearchSheet merchantSlug={merchantSlug} open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
