import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { loadLiveAccount } from "@/lib/live-account";
import { getTwoFactorStatus, remainingBackupCodeCount, twoFactorRequiredForRole } from "@/lib/two-factor";
import { TwoFactorManager } from "./two-factor-manager";

/**
 * Self-service 2FA — required for a clinic owner or a platform admin
 * (redirected here by requireMerchantContext/requireAgencyContext,
 * lib/merchant-context.ts, until it's confirmed), optional for staff,
 * never offered to a client account.
 */
export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const live = await loadLiveAccount(session.user.id, session.user.authTime);
  if (!live) redirect("/login?reason=access-changed");
  if (live.role === "CUSTOMER") redirect("/login");

  const { required } = await searchParams;
  const status = await getTwoFactorStatus(session.user.id);
  const enabled = !!status?.confirmedAt;
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
        <TwoFactorManager enabled={enabled} remainingBackupCodes={remainingBackupCodes} />
      </div>
    </div>
  );
}
