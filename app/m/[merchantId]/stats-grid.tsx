"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Eye } from "lucide-react";
import { Panel, Chip } from "@/components/ui/primitives";
import { InsetEmpty } from "@/components/ui/empty-state";
import { LineChart } from "@/components/ui/line-chart";
import { formatMoney } from "@/lib/utils";
import type { HomeMetrics } from "@/lib/home-metrics";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
];

function Widget({
  title,
  tooltip,
  children,
  right,
}: {
  title: string;
  tooltip?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1 text-[12px] text-ink-muted">
          {title}
          {tooltip && (
            <span title={tooltip} className="cursor-help text-ink-faint">
              ⓘ
            </span>
          )}
        </p>
        {right ?? <Download className="h-3.5 w-3.5 shrink-0 cursor-pointer text-ink-faint hover:text-ink-muted" />}
      </div>
      <div className="mt-2">{children}</div>
    </Panel>
  );
}

export function StatsGrid({
  merchantId,
  range,
  metrics,
}: {
  merchantId: string;
  range: string;
  metrics: HomeMetrics;
}) {
  const router = useRouter();
  const money = (c: number) => formatMoney(c, metrics.currency);
  const sourcesTotal = metrics.revenueSources.reduce((s, r) => s + r.cents, 0);

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-[15px] font-semibold">Stats</h2>
        {RANGES.map((r) => (
          <Chip
            key={r.key}
            active={range === r.key}
            onClick={() => router.push(`/m/${merchantId}?range=${r.key}`)}
          >
            {r.label}
          </Chip>
        ))}
        <span className="ml-2 text-[12px] text-ink-muted">Compared to</span>
        <select className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none">
          <option>No comparison</option>
          <option>Previous period</option>
          <option>Same period last year</option>
        </select>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Widget title="Net Revenue">
          <p className="tabular text-[22px] font-semibold">{money(metrics.netRevenueCents)}</p>
          {metrics.netRevenueCents === 0 ? <InsetEmpty /> : <LineChart points={metrics.netRevenueSeries} height={90} />}
        </Widget>

        <Widget title="MRR" tooltip="Monthly recurring revenue from active memberships.">
          <p className="tabular text-[22px] font-semibold">{money(metrics.mrrCents)}</p>
          {metrics.mrrCents === 0 ? <InsetEmpty /> : <LineChart points={metrics.mrrSeries} height={90} />}
        </Widget>

        <Widget title="Revenue Sources Breakdown">
          <div className="mt-1 flex h-2 overflow-hidden rounded-pill bg-app">
            {sourcesTotal > 0 &&
              metrics.revenueSources.map((s) => (
                <span key={s.label} style={{ width: `${(s.cents / sourcesTotal) * 100}%`, background: s.color }} />
              ))}
          </div>
          <ul className="mt-3 space-y-1.5">
            {metrics.revenueSources.map((s) => (
              <li key={s.label} className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="tabular">
                  {money(s.cents)} ({sourcesTotal > 0 ? Math.round((s.cents / sourcesTotal) * 100) : 0}%)
                </span>
              </li>
            ))}
          </ul>
        </Widget>

        <Widget title="App User LTV" tooltip="Average lifetime spend per app user.">
          <p className="tabular text-[22px] font-semibold">{money(metrics.appUserLtvCents)}</p>
          {metrics.appUserLtvCents === 0 ? <InsetEmpty /> : <LineChart points={metrics.netRevenueSeries} height={90} />}
        </Widget>

        <Widget title="Client LTV" tooltip="Average lifetime spend per client record.">
          <p className="tabular text-[22px] font-semibold">{money(metrics.appUserLtvCents)}</p>
          <InsetEmpty />
        </Widget>

        <Widget
          title="Top Clients"
          right={
            <button
              type="button"
              onClick={() => router.push(`/m/${merchantId}/clients`)}
              className="flex items-center gap-1 text-[11px] text-primary"
            >
              <Eye className="h-3 w-3" /> See All
            </button>
          }
        >
          {metrics.topClients.length === 0 ? (
            <InsetEmpty text="No client data available" />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-ink-faint">
                  <th className="pb-1 font-medium">Name</th>
                  <th className="pb-1 text-right font-medium">Total Spend</th>
                </tr>
              </thead>
              <tbody>
                {metrics.topClients.map((c) => (
                  <tr key={c.name} className="text-[12px]">
                    <td className="py-0.5">{c.name}</td>
                    <td className="tabular py-0.5 text-right">{money(c.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Widget>

        <Widget
          title="Top Team Members"
          right={<span className="flex items-center gap-1 text-[11px] text-primary"><Eye className="h-3 w-3" /> See All</span>}
        >
          <InsetEmpty text="No team member data available" />
        </Widget>

        <Widget title="App Users">
          <p className="tabular text-[22px] font-semibold">{metrics.appUsers}</p>
          {metrics.appUsers === 0 ? <InsetEmpty /> : <LineChart points={metrics.appUserSeries} height={90} />}
        </Widget>

        <Widget title="Referrals">
          <p className="tabular text-[22px] font-semibold">{metrics.referrals}</p>
          <InsetEmpty />
        </Widget>
      </div>
    </section>
  );
}
