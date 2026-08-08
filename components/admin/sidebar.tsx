"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ADMIN_NAV_ITEMS } from "./nav-items";
import type { SessionUserShape } from "@/types/next-auth";
import { signOutAction } from "@/lib/actions/session";

function canSee(item: (typeof ADMIN_NAV_ITEMS)[number], user: SessionUserShape) {
  if (user.role === "TENANT_ADMIN") return true;
  if (item.tenantAdminOnly) return false;
  if (!item.permission) return true;
  return user.permissions !== "ALL" ? user.permissions.includes(item.permission) : true;
}

function NavLinks({ user, onNavigate }: { user: SessionUserShape; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
      {ADMIN_NAV_ITEMS.filter((item) => canSee(item, user)).map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-brand-primary/10 text-brand-primary" : "text-ink-muted hover:bg-surface-subtle hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminSidebar({ user, tenantName }: { user: SessionUserShape; tenantName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface-raised md:flex">
        <div className="border-b border-border p-4">
          <p className="text-sm font-semibold text-ink">{tenantName}</p>
          <p className="text-xs text-ink-subtle">Admin dashboard</p>
        </div>
        <NavLinks user={user} />
        <div className="border-t border-border p-3">
          <p className="truncate px-1 text-xs text-ink-subtle">{user.email}</p>
          <form action={signOutAction}>
            <button className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:bg-surface-subtle">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex items-center justify-between border-b border-border bg-surface-raised p-3 md:hidden">
        <p className="text-sm font-semibold">{tenantName}</p>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-2 hover:bg-surface-subtle">
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative flex w-72 flex-col bg-surface-raised">
            <div className="flex items-center justify-between border-b border-border p-4">
              <p className="text-sm font-semibold">{tenantName}</p>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-md p-1 hover:bg-surface-subtle">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks user={user} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
