"use client";

import * as React from "react";
import Link from "next/link";
import { LifeBuoy, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/lib/actions/session";

/**
 * The portal's sidebar, Pirs v2.
 *
 * 256 wide on a desktop and 84 icon-only below 1200, which is the tablet the
 * desk actually uses — the collapse is a media query rather than a toggle,
 * because the width that fits is a property of the screen, not a preference
 * worth storing. The active page is a black pill; nothing else is coloured.
 */

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
  user,
}: {
  contextName: string;
  /** Merchant picker for agency admins; omitted for merchant users. */
  contextSwitcher?: React.ReactNode;
  entries: SidebarEntry[];
  support: SupportLink | null;
  /** Who is signed in, shown at the foot of the bar. */
  user?: { name: string; role: string };
}) {
  const initials = (value: string) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";

  return (
    <aside className="pk-sidebar">
      <div className="pk-clinic">
        <span className="mark" aria-hidden="true">
          {contextName.charAt(0).toUpperCase()}
        </span>
        <span className="who">
          <b>{contextName}</b>
          {contextSwitcher ? <span className="switch">{contextSwitcher}</span> : null}
        </span>
      </div>

      <nav className="pk-nav" aria-label="Sections">
        {entries.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            title={entry.label}
            aria-label={entry.label}
            aria-current={entry.active ? "page" : undefined}
            className={cn("pk-navrow", entry.active && "on")}
          >
            <span className="ic" aria-hidden="true">
              {entry.icon}
            </span>
            <span className="lab">{entry.label}</span>
          </Link>
        ))}
      </nav>

      <div className="pk-foot">
        {support ? (
          <a href={support.url} target="_blank" rel="noreferrer" className="pk-navrow" title="Help and support">
            <span className="ic" aria-hidden="true">
              <LifeBuoy className="h-5 w-5" />
            </span>
            <span className="lab">Help and support</span>
          </a>
        ) : (
          <Link href="/agency/white-label" className="pk-navrow" title="Help and support">
            <span className="ic" aria-hidden="true">
              <LifeBuoy className="h-5 w-5" />
            </span>
            <span className="lab">Help and support</span>
          </Link>
        )}

        <div className="pk-user">
          <span className="avatar" aria-hidden="true">
            {initials(user?.name ?? contextName)}
          </span>
          <span className="txt">
            <b>{user?.name ?? contextName}</b>
            {user?.role && <span>{user.role}</span>}
          </span>
          <form action={signOutAction}>
            <button type="submit" className="out" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
