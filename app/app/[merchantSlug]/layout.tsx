import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary, getRewardsData } from "@/lib/client-app-data";
import { Onboarding } from "./onboarding";
import { ClientAppShell } from "./shell";
import "./client-app.css";

export default async function ClientAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);

  // The merchant's own brand colour is the only colour the client app takes
  // from configuration; everything else is the fixed monochrome palette.
  const style = ctx.merchant.accentColor
    ? ({ "--merchant-accent": ctx.merchant.accentColor } as React.CSSProperties)
    : undefined;

  if (!ctx.customerProfileId) {
    return (
      <div className="client-app" style={style}>
        <Onboarding merchantSlug={merchantSlug} merchantName={ctx.merchant.name} logoUrl={ctx.merchant.logoUrl} />
      </div>
    );
  }

  const [summary, rewards] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId),
    getRewardsData(ctx.db, ctx.merchant.currency),
  ]);

  // Dot on the Rewards tab when something just became affordable.
  const rewardsDot = !!summary && rewards.rewards.some((r) => r.pointsCost <= summary.loyaltyPoints);

  return (
    <div className="client-app" style={style}>
      <ClientAppShell
        merchantSlug={merchantSlug}
        merchantName={ctx.merchant.name}
        logoUrl={ctx.merchant.logoUrl}
        currency={ctx.merchant.currency}
        rewardsDot={rewardsDot}
      >
        {children}
      </ClientAppShell>
    </div>
  );
}
