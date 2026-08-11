import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { LoginForm } from "./login-form";
import { Button } from "@/components/ui/button";
import { switchAccountAction } from "@/lib/actions/session";
import { safeNext, describeDestination, resolveDestination, canReach, SECTION_REQUIREMENT } from "@/lib/login-destination";

const ROLE_LABEL: Record<string, string> = {
  PLATFORM_ADMIN: "Platform admin",
  TENANT_ADMIN: "Clinic admin",
  STAFF: "Clinic staff",
  CUSTOMER: "Client",
};

/**
 * The one login screen, for all three surfaces. Where a user lands afterwards
 * is decided by their role — and, when they arrived from a specific portal on
 * the index page, by the destination carried in `next`.
 */

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);

  const session = await auth();
  const agency = await rawDb.agencySettings.findFirst();
  const portal = target ? await describeDestination(target) : null;

  if (session?.user) {
    const { role, tenantId, tenantSlug } = session.user;
    const actor = { role, tenantId, tenantSlug };

    // Their account can open what they picked (or they picked nothing): go.
    if (canReach(actor, target)) {
      redirect(resolveDestination(actor, target));
    }

    // It cannot. Say so, rather than bouncing them back to their own portal —
    // that silent reroute is what made all three cards look like one app.
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
            {portal && (
              <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: portal.accent }}>
                {portal.section}
              </p>
            )}
            <h1 className="mt-1 text-[18px] font-semibold">Wrong account for this portal</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              You are signed in as <span className="font-medium text-ink">{session.user.email}</span>
              {ROLE_LABEL[role] ? <span className="text-ink-faint"> — {ROLE_LABEL[role]}</span> : null}.{" "}
              {portal ? `${portal.section} needs ${SECTION_REQUIREMENT[portal.section] ?? "a different account"}.` : null}
            </p>

            <form action={switchAccountAction} className="mt-5">
              <input type="hidden" name="next" value={target ?? ""} />
              <Button type="submit" className="w-full">
                Sign out and switch account
              </Button>
            </form>

            <Link
              href={resolveDestination(actor, null)}
              className="mt-3 flex h-10 items-center justify-center rounded-[10px] border border-border text-[13px] font-medium transition-colors hover:bg-app"
            >
              Stay in my own portal
            </Link>
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
