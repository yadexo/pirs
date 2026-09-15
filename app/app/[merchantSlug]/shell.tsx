"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon, ToastProvider } from "@/components/client-app/ui";
import { CartProvider, useCart } from "./cart-context";
import { SearchSheet } from "./search-sheet";
import { CartSheet } from "./cart-sheet";

const TABS = [
  { key: "home", label: "Home", icon: "home" },
  { key: "shop", label: "Shop", icon: "bag" },
  { key: "scan", label: "Scan", icon: "scan" },
  { key: "rewards", label: "Rewards", icon: "gift" },
  { key: "profile", label: "Profile", icon: "user" },
] as const;

const TITLES: Record<string, string> = { home: "Home", shop: "Shop", scan: "", rewards: "Rewards", profile: "Account" };

export function ClientAppShell({
  merchantSlug,
  merchantName,
  logoUrl,
  currency,
  rewardsDot,
  children,
}: {
  merchantSlug: string;
  merchantName: string;
  logoUrl: string | null;
  currency: string;
  /** A reward just became affordable — surfaces a dot on the Rewards tab. */
  rewardsDot: boolean;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <CartProvider merchantSlug={merchantSlug}>
        <Frame
          merchantSlug={merchantSlug}
          merchantName={merchantName}
          logoUrl={logoUrl}
          currency={currency}
          rewardsDot={rewardsDot}
        >
          {children}
        </Frame>
      </CartProvider>
    </ToastProvider>
  );
}

function Frame({
  merchantSlug,
  merchantName,
  logoUrl,
  currency,
  rewardsDot,
  children,
}: {
  merchantSlug: string;
  merchantName: string;
  logoUrl: string | null;
  currency: string;
  rewardsDot: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/app/${merchantSlug}`;
  const { count, open, openCart, closeCart } = useCart();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const seg = pathname.slice(base.length).replace(/^\//, "").split("/")[0] ?? "";
  const routeTab = TABS.some((t) => t.key === seg) ? seg : "home";

  // The tapped tab lights up immediately; the page follows. Without this the
  // tab bar looked dead until the next page's data had arrived.
  const [tappedTab, setTappedTab] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();
  React.useEffect(() => setTappedTab(null), [pathname]);
  const active = tappedTab ?? routeTab;
  const showHeader = active !== "scan";

  const hrefFor = React.useCallback((key: string) => (key === "home" ? base : `${base}/${key}`), [base]);

  // Load every tab ahead of time so switching is instant in production.
  React.useEffect(() => {
    for (const t of TABS) router.prefetch(hrefFor(t.key));
  }, [router, hrefFor]);

  function selectTab(key: string) {
    if (key === routeTab && !tappedTab) {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setTappedTab(key);
    startTransition(() => router.push(hrefFor(key)));
  }

  return (
    <div className="ca-device">
      {showHeader && (
        <header className="ca-hdr">
          <div className="row">
            <div style={{ display: "flex", alignItems: "center", minHeight: 40 }}>
              {active === "home" && logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt={merchantName} className="ca-hlogo" />
              ) : active === "home" ? (
                <span className="ca-hlogo" style={{ background: "var(--black)", color: "var(--on-black)", display: "grid", placeItems: "center", fontWeight: 700 }}>
                  {merchantName.charAt(0)}
                </span>
              ) : (
                <h1 className="ca-htitle">{TITLES[active]}</h1>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" className="ca-iconbtn" aria-label="Search" onClick={() => setSearchOpen(true)}>
                <Icon name="search" size={26} />
              </button>
              <button type="button" className="ca-iconbtn" aria-label="Cart" onClick={openCart}>
                <Icon name="bag" size={26} />
                {count > 0 && <span className="ca-cartbadge tabular">{count}</span>}
              </button>
            </div>
          </div>
        </header>
      )}

      <div ref={scrollRef} style={{ paddingBottom: "calc(var(--tabh) + 40px)" }}>
        {children}
      </div>

      <nav className="ca-tabbar" role="tablist" aria-label="Main">
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={t.label}
              className={cn("ca-tabbtn", on && "on")}
              onClick={() => selectTab(t.key)}
            >
              <span className="tic">
                <Icon name={t.icon} size={26} />
                {t.key === "rewards" && rewardsDot && <span className="ca-rdot" />}
              </span>
              <span className="tlab">{t.label}</span>
            </button>
          );
        })}
      </nav>

      <SearchSheet merchantSlug={merchantSlug} currency={currency} open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CartSheet merchantSlug={merchantSlug} currency={currency} open={open} onClose={closeCart} />
    </div>
  );
}
