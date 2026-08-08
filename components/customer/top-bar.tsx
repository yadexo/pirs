import Link from "next/link";
import Image from "next/image";
import { ShoppingBag, Bell, MessageCircle } from "lucide-react";
import type { TenantWithBranding } from "@/lib/tenant";

const DESKTOP_LINKS = [
  { href: "", label: "Home" },
  { href: "/services", label: "Services" },
  { href: "/products", label: "Products" },
  { href: "/packages", label: "Packages" },
  { href: "/memberships", label: "Memberships" },
  { href: "/promotions", label: "Promotions" },
];

export function CustomerTopBar({
  tenant,
  isAuthenticated,
  basketCount,
  unreadNotifications,
}: {
  tenant: TenantWithBranding;
  isAuthenticated: boolean;
  basketCount: number;
  unreadNotifications: number;
}) {
  const base = `/${tenant.slug}`;
  const businessName = tenant.branding?.businessName ?? tenant.name;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface-raised">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href={base} className="flex items-center gap-2 font-semibold text-ink">
          {tenant.branding?.logoUrl ? (
            <Image src={tenant.branding.logoUrl} alt={businessName} width={28} height={28} className="rounded-md" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-primary text-sm text-brand-primary-foreground">
              {businessName.charAt(0)}
            </span>
          )}
          <span className="hidden sm:inline">{businessName}</span>
        </Link>

        <nav className="hidden items-center gap-5 text-sm text-ink-muted sm:flex">
          {DESKTOP_LINKS.map((link) => (
            <Link key={link.href} href={`${base}${link.href}`} className="hover:text-ink">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          {isAuthenticated && (
            <Link
              href={`${base}/messages`}
              className="relative rounded-md p-2 text-ink-muted hover:bg-surface-subtle"
              aria-label="Messages"
            >
              <MessageCircle className="h-5 w-5" />
            </Link>
          )}
          {isAuthenticated && (
            <Link
              href={`${base}/notifications`}
              className="relative rounded-md p-2 text-ink-muted hover:bg-surface-subtle"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadNotifications > 0 && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />
              )}
            </Link>
          )}
          <Link
            href={`${base}/basket`}
            className="relative rounded-md p-2 text-ink-muted hover:bg-surface-subtle"
            aria-label="Basket"
          >
            <ShoppingBag className="h-5 w-5" />
            {basketCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-primary px-1 text-[10px] font-semibold text-brand-primary-foreground">
                {basketCount}
              </span>
            )}
          </Link>
          {!isAuthenticated ? (
            <Link
              href={`${base}/login`}
              className="ml-1 rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-primary-foreground"
            >
              Sign in
            </Link>
          ) : (
            <Link
              href={`${base}/account`}
              className="ml-1 hidden rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink sm:inline-block"
            >
              Account
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
