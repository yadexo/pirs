import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary, getRewardsData } from "@/lib/client-app-data";
import { GlossSurface } from "@/components/client-app/gloss-surface";
import { ClientCard, ClientEmptyState } from "@/components/client-app/primitives";
import { formatMoney } from "@/lib/utils";
import { RewardsStrip } from "./rewards-strip";
import { EarnRows } from "./earn-rows";

export default async function RewardsPage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);
  const [summary, data] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId!),
    getRewardsData(ctx.db),
  ]);
  if (!summary) return null;

  return (
    <div className="space-y-7 px-[var(--space-screen-x)] pt-2">
      {/* 1. Loyalty card — the signature element */}
      <div className="pt-2">
        <GlossSurface tilt className="p-6">
          <p className="text-[48px] font-bold leading-none text-[var(--on-black)]">{summary.loyaltyPoints}</p>
          <p className="mt-1 text-[16px] text-[var(--on-black-muted)]">Loyalty Points</p>

          <div className="mt-10 flex items-end justify-between gap-4">
            <div>
              <p className="text-[16px] font-semibold text-[var(--on-black)]">{summary.firstName}</p>
              <p className="text-[16px] text-[var(--on-black-muted)]">Joined {summary.joinedDaysAgo} days ago</p>
            </div>
            <div className="text-right">
              <span className="tabular inline-flex items-center rounded-[var(--radius-pill)] bg-white/90 px-3 py-1.5 text-[15px] font-semibold text-[var(--ink-strong)]">
                {formatMoney(summary.cashBalanceCents, ctx.merchant.currency)}
              </span>
              <p className="mt-1 text-[14px] text-[var(--on-black-muted)]">Patient App Cash</p>
            </div>
          </div>
        </GlossSurface>
      </div>

      {/* 2. Rewards */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[27px] font-bold text-[var(--ink-strong)]">Rewards</h2>
        </div>
        {data.rewards.length === 0 ? (
          <ClientCard className="mt-3">
            <ClientEmptyState text="No rewards available yet" />
          </ClientCard>
        ) : (
          <RewardsStrip rewards={data.rewards} balance={summary.loyaltyPoints} />
        )}
      </section>

      {/* 3. Need more points? */}
      {data.earnRules.length > 0 && (
        <section>
          <h2 className="text-[27px] font-bold text-[var(--ink-strong)]">Need more points?</h2>
          <EarnRows rules={data.earnRules} />
        </section>
      )}
    </div>
  );
}
