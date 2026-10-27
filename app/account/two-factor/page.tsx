import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { loadLiveAccount } from "@/lib/live-account";
import { getTwoFactorStatus, remainingBackupCodeCount, twoFactorRequiredForRole } from "@/lib/two-factor";
import { safeNext, landingFor } from "@/lib/login-destination";
import { TwoFactorManager } from "./two-factor-manager";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

/**
 * Self-service 2FA — required for a clinic owner or a platform admin
 * (redirected here by requireMerchantContext/requireAgencyContext,
 * lib/merchant-context.ts, until it's confirmed), optional for staff,
 * never offered to a client account.
 *
 * `next` is the page the gate actually sent them here from (set by
 * lib/merchant-context.ts's redirectToTwoFactorSetup) — the "Continue"
 * button below goes there, falling back to the role's own landing page
 * when there is none (a voluntary visit from account settings, say).
 */
export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ required?: string; next?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const live = await loadLiveAccount(session.user.id, session.user.authTime);
  if (!live) redirect("/login?reason=access-changed");
  if (live.role === "CUSTOMER") redirect("/login");

  const { required, next } = await searchParams;
  const continueUrl = safeNext(next) ?? landingFor({ role: live.role, tenantId: live.tenantId, tenantSlug: session.user.tenantSlug ?? null });
  const status = await getTwoFactorStatus(session.user.id);
  const enabled = !!status?.confirmedAt;
  // Already on — nothing left to set up, the gate just needs to see this.
  // Covers both "setup already finished" (a slow second tab, say) and
  // anyone who lands here with ?required=1 despite already being enrolled.
  if (required === "1" && enabled) redirect(continueUrl);

  const remainingBackupCodes = enabled ? await remainingBackupCodeCount(session.user.id) : 0;
  const requiredForRole = twoFactorRequiredForRole(live.role);
  const t = await getTranslations("twoFactor");

  return (
    <div className="mx-auto w-full max-w-md px-5 py-12">
      <h1 className="text-[20px] font-semibold text-ink">{t("title")}</h1>
      <p className="mt-1 text-[13px] text-ink-muted">{requiredForRole ? t("requiredForRole") : t("optional")}</p>
      {required === "1" && !enabled && (
        <p className="mt-3 rounded-[10px] bg-[var(--warning-tint,#fff7e6)] px-3 py-2 text-[13px] text-ink">{t("setupToContinue")}</p>
      )}
      <div className="mt-6">
        <TwoFactorManager enabled={enabled} remainingBackupCodes={remainingBackupCodes} requiredForRole={requiredForRole} continueUrl={continueUrl} />
      </div>
      <div className="mt-6 flex items-center justify-between text-[12px] text-ink-muted">
        {required !== "1" ? (
          <Link href={continueUrl} className="underline underline-offset-2 hover:text-ink">
            {t("back")}
          </Link>
        ) : (
          <span />
        )}
        <form action={signOutAction}>
          <button type="submit" className="underline underline-offset-2 hover:text-ink">
            {t("signOut")}
          </button>
        </form>
      </div>
    </div>
  );
}
