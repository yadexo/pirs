"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Grid2x2, CalendarDays, Gift, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function CustomerBottomNav({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();
  const base = `/${tenantSlug}`;

  const items = [
    { href: base, label: "Home", icon: Home, match: (p: string) => p === base },
    { href: `${base}/services`, label: "Shop", icon: Grid2x2, match: (p: string) => p.startsWith(`${base}/services`) || p.startsWith(`${base}/products`) || p.startsWith(`${base}/packages`) },
    { href: `${base}/appointments`, label: "Visits", icon: CalendarDays, match: (p: string) => p.startsWith(`${base}/appointments`) },
    { href: `${base}/loyalty`, label: "Rewards", icon: Gift, match: (p: string) => p.startsWith(`${base}/loyalty`) },
    { href: `${base}/account`, label: "Profile", icon: User, match: (p: string) => p.startsWith(`${base}/account`) },
  ];

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-raised sm:hidden">
      <div className="grid grid-cols-5">
        {items.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-1 py-2 text-xs",
                active ? "text-brand-primary" : "text-ink-subtle",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
