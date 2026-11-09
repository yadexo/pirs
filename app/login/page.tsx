import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { openedDoor } from "@/lib/portal-scope";
import { registrationEnabled } from "@/lib/registration-code";
import { rawDb } from "@/lib/db";
import { LoginForm } from "./login-form";
import { loadLiveAccount } from "@/lib/live-account";
import { Button } from "@/components/ui/button";
import { switchAccountAction } from "@/lib/actions/session";
import { safeNext, describeDestination, resolveDestination, canReach } from "@/lib/login-destination";
import { resolveLocale } from "@/lib/locale";
import { GuestLocaleSwitcher } from "@/components/auth/guest-locale-switcher";

/**
 * The one login screen, for all three surfaces. Where a user lands afterwards
 * is decided by their role — and, when they arrived from a specific portal on
 * the index page, by the destination carried in `next`.
 */

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  const target = safeNext(next);
  const t = await getTranslations("auth");
  const locale = await resolveLocale();
  const path = `/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const ROLE_LABEL: Record<string, string> = {
    PLATFORM_ADMIN: t("roleLabel.PLATFORM_ADMIN"),
    TENANT_ADMIN: t("roleLabel.TENANT_ADMIN"),
    STAFF: t("roleLabel.STAFF"),
    CUSTOMER: t("roleLabel.CUSTOMER"),
  };

  const session = await auth();
  const agency = await rawDb.agencySettings.findFirst();
  const portal = target ? await describeDestination(target) : null;

  // Which door this is: the host decides (admin.deza.ai is the admin login
  // whatever the link said), and only where the host identifies no surface does
  // the destination get a say. It scopes which accounts the sign-in considers,
  // so one address can be a platform admin, a clinic owner and a client at once.
  const requestHeaders = await headers();
  const door = openedDoor(requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"), target);

  // The register page this door leads to: the admin login offers the admin
  // one, the clinic login (and the staff fallback) the clinic one. A client
  // door offers neither — clients sign up inside their clinic's own app.
  // Only while registration is open at all (REGISTRATION_CODE set): with it
  // unset both pages are a 404, so a link would be a dead end.
  const tr = await getTranslations("register");
  const registerTo = door.portal === "admin" ? "admin" : door.portal === "clinic" || door.portal === "staff" ? "clinic" : null;
  const registerHref = registrationEnabled() && registerTo ? `/register/${registerTo}` : null;

  // A session whose account was deactivated since is treated as signed out;
  // otherwise the portals send it here and this page would send it back.
  const live = session?.user ? await loadLiveAccount(session.user.id, session.user.authTime) : null;
  if (session?.user && live) {
    const { tenantSlug } = session.user;
    const { role, tenantId } = live;
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
            <span className="text-[15px] font-semibold">{agency?.name ?? "Deza"}</span>
          </div>

          <div className="rounded-card border border-border bg-surface p-6 shadow-card">
            {portal && (
              <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: portal.accent }}>
                {portal.section}
              </p>
            )}
            <h1 className="mt-1 text-[18px] font-semibold">{t("wrongAccount")}</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              {t("signedInAs")} <span className="font-medium text-ink">{session.user.email}</span>
              {ROLE_LABEL[role] ? <span className="text-ink-faint"> — {ROLE_LABEL[role]}</span> : null}.{" "}
              {portal ? t(`destinations.${portal.kind}.wrongAccountRequirement`) : null}
            </p>

            <form action={switchAccountAction} className="mt-5">
              <input type="hidden" name="next" value={target ?? ""} />
              <Button type="submit" className="w-full">
                {t("signOutAndSwitch")}
              </Button>
            </form>

            <Link
              href={resolveDestination(actor, null)}
              className="mt-3 flex h-10 items-center justify-center rounded-[10px] border border-border text-[13px] font-medium transition-colors hover:bg-app"
            >
              {t("stayInMyPortal")}
            </Link>
          </div>

          <p className="mt-4 text-center text-[12.5px] text-ink-muted">
            <Link href="/" className="underline underline-offset-2">
              {t("allPortals")}
            </Link>
          </p>
          <GuestLocaleSwitcher locale={locale} path={path} />
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
          <span className="text-[15px] font-semibold">{agency?.name ?? "Deza"}</span>
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
              <h1 className="text-[18px] font-semibold">{t("signIn")}</h1>
              <p className="mt-1 text-[13px] text-ink-muted">{t("enterCredentials")}</p>
            </>
          )}
          {reason === "password-updated" && (
            <p role="status" className="mt-3 rounded-[10px] bg-primary-soft px-3 py-2 text-[12px] text-ink">
              {t("passwordSaved")}
            </p>
          )}
          {(reason === "access-changed" || (session?.user && !live)) && (
            <p role="status" className="mt-3 rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px] text-ink">
              {t("accessChanged")}
            </p>
          )}
          <div className="mt-5">
            <LoginForm next={target} portal={door.portal} clinic={door.tenantSlug} />
          </div>
          {registerHref && (
            <p className="mt-4 border-t border-border pt-4 text-center text-[12.5px] text-ink-muted">
              <Link href={registerHref} className="font-medium text-primary underline underline-offset-2">
                {tr(`${registerTo}.linkFromLogin`)}
              </Link>
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-[12.5px] text-ink-muted">
          <Link href="/" className="underline underline-offset-2">
            {t("allPortals")}
          </Link>
        </p>
        <GuestLocaleSwitcher locale={locale} path={path} />
      </div>
    </main>
  );
}
