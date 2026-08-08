"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, ChevronsUpDown, LifeBuoy, LogOut, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/lib/actions/session";

const COLLAPSE_KEY = "shell:sidebar-collapsed";

export interface SidebarEntry {
  href: string;
  label: string;
  /** Rendered by the parent so this stays a pure client component. */
  icon: React.ReactNode;
  active: boolean;
}

export interface SupportLink {
  label: string;
  url: string;
}

export function Sidebar({
  contextName,
  contextSwitcher,
  entries,
  support,
}: {
  contextName: string;
  /** Merchant picker for agency admins; omitted for merchant users. */
  contextSwitcher?: React.ReactNode;
  entries: SidebarEntry[];
  support: SupportLink | null;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  // Read persisted state after mount so server and client markup agree.
  React.useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    setHydrated(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150",
        collapsed ? "w-[68px]" : "w-[230px]",
        !hydrated && "invisible",
      )}
    >
      <div className={cn("flex h-14 items-center px-4", collapsed && "justify-center px-0")}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white">
          {contextName.charAt(0).toUpperCase()}
        </span>
        {!collapsed && <span className="ml-2 truncate text-sm font-semibold">{contextName}</span>}
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "mx-2 mb-1 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] text-ink-muted hover:bg-app",
          collapsed && "justify-center px-0",
        )}
      >
        <Menu className="h-4 w-4 shrink-0" />
        {!collapsed && <span>Collapse</span>}
      </button>

      {!collapsed && contextSwitcher && <div className="px-2 pb-2">{contextSwitcher}</div>}
      {!collapsed && !contextSwitcher && (
        <div className="px-2 pb-2">
          <div className="flex items-center justify-between rounded-[10px] border border-border px-3 py-2">
            <span className="truncate text-[13px] font-medium">{contextName}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {entries.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            title={collapsed ? entry.label : undefined}
            aria-current={entry.active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] transition-colors",
              collapsed && "justify-center px-0",
              entry.active
                ? "border border-primary bg-primary-soft font-medium text-primary"
                : "border border-transparent text-ink hover:bg-app",
            )}
          >
            <span className={cn("shrink-0", entry.active ? "text-primary" : "text-ink-faint")}>{entry.icon}</span>
            {!collapsed && (
              <>
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.active && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              </>
            )}
          </Link>
        ))}
      </nav>

      {!collapsed && (
        <div className="p-3">
          <div className="rounded-card border border-border p-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft">
              <LifeBuoy className="h-3.5 w-3.5 text-primary" />
            </span>
            <p className="mt-2 text-[13px] font-semibold">Need Support?</p>
            <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">
              {support ? support.label : "Configure your support link in White Label settings."}
            </p>
            {support ? (
              <a
                href={support.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-block text-[11px] font-medium text-primary underline"
              >
                Get help →
              </a>
            ) : (
              <Link href="/agency/white-label" className="mt-1.5 inline-block text-[11px] font-medium text-primary underline">
                Set up support →
              </Link>
            )}
          </div>
        </div>
      )}

      <form action={signOutAction} className="px-2 pb-3">
        <button
          type="submit"
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] text-ink-muted hover:bg-app",
            collapsed && "justify-center px-0",
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </form>
    </aside>
  );
}
