import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { signOutAction } from "@/lib/actions/session";
import { Building2, LayoutDashboard, LogOut } from "lucide-react";

export default async function PlatformDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "PLATFORM_ADMIN") {
    redirect("/platform/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface-raised sm:flex">
        <div className="border-b border-border p-4">
          <p className="text-sm font-semibold">Platform admin</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          <Link href="/platform" className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink">
            <LayoutDashboard className="h-4 w-4" /> Overview
          </Link>
          <Link href="/platform/tenants" className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink">
            <Building2 className="h-4 w-4" /> Tenants
          </Link>
        </nav>
        <div className="border-t border-border p-3">
          <p className="truncate px-1 text-xs text-ink-subtle">{session.user.email}</p>
          <form action={signOutAction}>
            <button className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:bg-surface-subtle">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
