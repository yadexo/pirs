import { requireMerchantContext } from "@/lib/merchant-context";
import { MerchantPageHeader } from "@/components/merchant/page-header";
import { Panel } from "@/components/ui/primitives";
import { LineChart } from "@/components/ui/line-chart";
import { formatMoney } from "@/lib/utils";
import { getHomeMetrics } from "@/lib/home-metrics";
import { ActivityFeed } from "./activity-feed";
import { StatsGrid } from "./stats-grid";

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default async function MerchantHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { merchantId } = await params;
  const { range = "7d" } = await searchParams;
  const ctx = await requireMerchantContext(merchantId);

  const metrics = await getHomeMetrics(ctx.db, range);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <MerchantPageHeader title={`${greeting()} ${ctx.merchantName} 👋`} merchantName={ctx.merchantName} />

      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel className="p-5 lg:col-span-2">
          <p className="flex items-center gap-1 text-[12px] text-ink-muted">
            Daily processing
            <span title="Payments processed today, against the same point yesterday." className="cursor-help text-ink-faint">
              ⓘ
            </span>
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="tabular text-[24px] font-semibold">{formatMoney(metrics.todayCents, metrics.currency)}</span>
            <span className="tabular text-[13px] text-ink-muted">
              {formatMoney(metrics.yesterdayCents, metrics.currency)}
            </span>
          </p>
          <LineChart
            className="mt-4"
            points={metrics.hourly}
            xLabels={["12:00 AM", "3:00 AM", "6:00 AM", "9:00 AM", "12:00 PM", "3:00 PM", "6:00 PM", "9:00 PM"]}
            banded
          />
        </Panel>

        <Panel className="flex min-h-[280px] flex-col">
          <div className="flex items-center gap-2 border-b border-border px-5 py-4">
            <span className="live-dot" />
            <h2 className="text-[14px] font-medium">Live Activity Feed</h2>
          </div>
          <ActivityFeed initial={metrics.activity} />
        </Panel>
      </div>

      <StatsGrid merchantId={merchantId} range={range} metrics={metrics} />
    </div>
  );
}

