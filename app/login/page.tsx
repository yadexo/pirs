import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { LoginForm } from "./login-form";
import { safeNext, describeDestination } from "@/lib/login-destination";

/**
 * The one login screen, for all three surfaces. Where a user lands afterwards
 * is decided by their role — and, when they arrived from a specific portal on
 * the index page, by the destination carried in `next`.
 */

/** Where a signed-in user belongs, decided by role rather than by URL. */
function landingFor(role: string, tenantId: string | null, tenantSlug: string | null): string {
  if (role === "PLATFORM_ADMIN") return "/agency";
  if (role === "CUSTOMER") return tenantSlug ? `/app/${tenantSlug}` : "/";
  if (tenantId) return `/m/${tenantId}`;
  return "/login";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);

  const session = await auth();
  if (session?.user) {
    redirect(target ?? landingFor(session.user.role, session.user.tenantId, session.user.tenantSlug));
  }

  const agency = await rawDb.agencySettings.findFirst();
  const portal = target ? await describeDestination(target) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white">
            {(agency?.name ?? "D").charAt(0)}
          </span>
          <span className="text-[15px] font-semibold">{agency?.name ?? "DezaAI"}</span>
        </div>

        <div className="rounded-card border border-border bg-surface p-6 shadow-card">
          {portal ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: portal.accent }}>
                {portal.section}
              </p>
              <h1 className="mt-1 text-[18px] font-semibold">{portal.title}</h1>
              <p className="mt-1 text-[13px] text-ink-muted">{portal.hint}</p>
            </>
          ) : (
            <>
              <h1 className="text-[18px] font-semibold">Sign in</h1>
              <p className="mt-1 text-[13px] text-ink-muted">Enter your credentials to continue.</p>
            </>
          )}
          <div className="mt-5">
            <LoginForm next={target} />
          </div>
        </div>

        <p className="mt-4 text-center text-[12.5px] text-ink-muted">
          <Link href="/" className="underline underline-offset-2">
            All portals
          </Link>
        </p>
      </div>
    </main>
  );
}
