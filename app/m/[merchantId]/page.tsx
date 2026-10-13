import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { requireMerchantContext } from "@/lib/merchant-context";
import { Button } from "@/components/ui/button";
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

  const [metrics, unbookable] = await Promise.all([
    getHomeMetrics(ctx.db, range),
    // Treatments clients can buy but cannot book. Worth the top of the page:
    // every one of them is a client left holding something unusable.
    ctx.db.service.findMany({
      where: { archivedAt: null, active: true, OR: [{ schedulingUrl: null }, { schedulingUrl: "" }] },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-[1180px]">
      <MerchantPageHeader
        title={`${greeting()}, ${ctx.merchantName}`}
        description={`Here's how ${ctx.merchantName} is doing. All amounts include VAT.`}
      />

      {unbookable.length > 0 && (
        <div className="pk-notice pk-notice-warn mb-6">
          <AlertTriangle className="ic h-5 w-5" aria-hidden="true" />
          <div className="txt">
            <b>
              Setup: {unbookable.length} treatment{unbookable.length === 1 ? " has" : "s have"} no booking link
            </b>
            <span>
              Clients can buy {unbookable.slice(0, 2).map((s) => s.name).join(" and ")}
              {unbookable.length > 2 ? ` and ${unbookable.length - 2} more` : ""}, but can&apos;t book {unbookable.length === 1 ? "it" : "them"} from
              the app.
            </span>
          </div>
          <Link href={`/m/${merchantId}/app-builder?tab=products&type=service`} className="shrink-0">
            <Button variant="outline">Add booking links</Button>
          </Link>
        </div>
      )}

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
          <ActivityFeed merchantId={merchantId} initial={metrics.activity} />
        </Panel>
      </div>

      <StatsGrid merchantId={merchantId} range={range} metrics={metrics} />
    </div>
  );
}

