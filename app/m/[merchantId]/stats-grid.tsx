"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Eye } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Panel, Chip } from "@/components/ui/primitives";
import { InsetEmpty } from "@/components/ui/empty-state";
import { LineChart } from "@/components/ui/line-chart";
import { formatMoney } from "@/lib/utils";
import type { HomeMetrics } from "@/lib/home-metrics";

const RANGE_KEYS = ["today", "7d", "30d", "90d"] as const;

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
  const t = useTranslations("portal.stats");
  const locale = useLocale();
  const money = (c: number) => formatMoney(c, metrics.currency, locale === "nl" ? "nl-NL" : "en-US");
  const sourcesTotal = metrics.revenueSources.reduce((s, r) => s + r.cents, 0);

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-[15px] font-semibold">{t("title")}</h2>
        {RANGE_KEYS.map((key) => (
          <Chip key={key} active={range === key} onClick={() => router.push(`/m/${merchantId}?range=${key}`)}>
            {t(`ranges.${key}`)}
          </Chip>
        ))}
        <span className="ml-2 text-[12px] text-ink-muted">{t("comparedTo")}</span>
        <select className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none">
          <option>{t("noComparison")}</option>
          <option>{t("previousPeriod")}</option>
          <option>{t("samePeriodLastYear")}</option>
        </select>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Widget title={t("netRevenue")}>
          <p className="tabular text-[22px] font-semibold">{money(metrics.netRevenueCents)}</p>
          {metrics.netRevenueCents === 0 ? <InsetEmpty /> : <LineChart points={metrics.netRevenueSeries} height={90} />}
        </Widget>

        <Widget title={t("mrr")} tooltip={t("mrrTooltip")}>
          <p className="tabular text-[22px] font-semibold">{money(metrics.mrrCents)}</p>
          {metrics.mrrCents === 0 ? <InsetEmpty /> : <LineChart points={metrics.mrrSeries} height={90} />}
        </Widget>

        <Widget title={t("revenueSourcesBreakdown")}>
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

        <Widget title={t("appUserLtv")} tooltip={t("appUserLtvTooltip")}>
          <p className="tabular text-[22px] font-semibold">{money(metrics.appUserLtvCents)}</p>
          {metrics.appUserLtvCents === 0 ? <InsetEmpty /> : <LineChart points={metrics.netRevenueSeries} height={90} />}
        </Widget>

        <Widget title={t("clientLtv")} tooltip={t("clientLtvTooltip")}>
          <p className="tabular text-[22px] font-semibold">{money(metrics.appUserLtvCents)}</p>
          <InsetEmpty />
        </Widget>

        <Widget
          title={t("topClients")}
          right={
            <button
              type="button"
              onClick={() => router.push(`/m/${merchantId}/clients`)}
              className="flex items-center gap-1 text-[11px] text-primary"
            >
              <Eye className="h-3 w-3" /> {t("seeAll")}
            </button>
          }
        >
          {metrics.topClients.length === 0 ? (
            <InsetEmpty text={t("noClientData")} />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-ink-faint">
                  <th className="pb-1 font-medium">{t("name")}</th>
                  <th className="pb-1 text-right font-medium">{t("totalSpend")}</th>
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
          title={t("topTeamMembers")}
          right={<span className="flex items-center gap-1 text-[11px] text-primary"><Eye className="h-3 w-3" /> {t("seeAll")}</span>}
        >
          <InsetEmpty text={t("noTeamData")} />
        </Widget>

        <Widget title={t("appUsers")}>
          <p className="tabular text-[22px] font-semibold">{metrics.appUsers}</p>
          {metrics.appUsers === 0 ? <InsetEmpty /> : <LineChart points={metrics.appUserSeries} height={90} />}
        </Widget>

        <Widget title={t("referrals")}>
          <p className="tabular text-[22px] font-semibold">{metrics.referrals}</p>
          <InsetEmpty />
        </Widget>
      </div>
    </section>
  );
}
