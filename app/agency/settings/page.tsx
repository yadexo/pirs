import { getTranslations } from "next-intl/server";
import { rawDb } from "@/lib/db";
import { requireAgencyContext } from "@/lib/merchant-context";
import { Panel } from "@/components/ui/primitives";
import { TwoFactorReset } from "./two-factor-reset";
import { AdminsSection } from "./admins-section";

/**
 * Every platform-wide setting that used to be scattered across the old admin
 * area now consolidates here.
 */
export default async function AgencySettingsPage() {
  const { user } = await requireAgencyContext();
  const t = await getTranslations("twoFactor.resetByEmail");

  const [admins, merchantCount] = await Promise.all([
    rawDb.user.findMany({
      where: { role: "PLATFORM_ADMIN" },
      select: { id: true, email: true, firstName: true, lastName: true, status: true, lastLoginAt: true, twoFactor: { select: { confirmedAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
    rawDb.tenant.count(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
      <div>
        <h1 className="text-[26px] font-semibold leading-8">Settings</h1>
        <p className="mt-1 text-[13px] text-ink-muted">Agency profile, team, and platform configuration.</p>
      </div>

      <Panel className="p-5">
        <h2 className="text-[14px] font-medium">Agency profile</h2>
        <dl className="mt-3 space-y-2 text-[13px]">
          <Row label="Signed in as" value={user.email} />
          <Row label="Merchants" value={String(merchantCount)} />
        </dl>
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[14px] font-medium">Admins</h2>
        <p className="mt-1 text-[12px] text-ink-muted">Platform administrators with full access to every merchant.</p>
        <div className="mt-3">
          <AdminsSection
            admins={admins.map((a) => ({
              id: a.id,
              email: a.email,
              firstName: a.firstName,
              lastName: a.lastName,
              status: a.status,
              lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null,
              twoFactorConfirmed: !!a.twoFactor?.confirmedAt,
            }))}
            currentUserId={user.id}
          />
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[14px] font-medium">{t("title")}</h2>
        <p className="mt-1 text-[12px] text-ink-muted">{t("description")}</p>
        <TwoFactorReset />
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[14px] font-medium">Billing &amp; plan</h2>
        <p className="mt-1 text-[12px] text-ink-muted">Not configured for this deployment.</p>
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[14px] font-medium">API keys</h2>
        <p className="mt-1 text-[12px] text-ink-muted">
          Provider credentials are supplied through environment variables — see the README.
        </p>
      </Panel>

      <Panel className="border-[var(--accent-red)]/30 p-5">
        <h2 className="text-[14px] font-medium text-[var(--accent-red)]">Danger zone</h2>
        <p className="mt-1 text-[12px] text-ink-muted">
          Merchants are deleted individually from My Apps, where the action requires typing the merchant name.
        </p>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
