import { Coins, Gift, Receipt, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireMerchantContext } from "@/lib/merchant-context";
import { MerchantPageHeader } from "@/components/merchant/page-header";
import { KpiCard } from "@/components/ui/stat-card";
import { Panel, PanelHeader, Pill } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { LineChart } from "@/components/ui/line-chart";
import { formatMoney } from "@/lib/utils";
import { TypeFilter } from "./type-filter";
import { RefundButton } from "./refund-button";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { resolveLocale } from "@/lib/locale";

export default async function ShopSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { merchantId } = await params;
  const { type = "all" } = await searchParams;
  const ctx = await requireMerchantContext(merchantId);
  const t = await getTranslations("portal.shop");
  const locale = await resolveLocale();
  const intlLocale = locale === "nl" ? "nl-NL" : "en-US";
  const REDEMPTION_LABEL: Record<string, string> = {
    QR: t("redemptionMethod.scanned"),
    BACKUP_CODE: t("redemptionMethod.typedCode"),
    MANUAL: t("redemptionMethod.byStaff"),
  };

  const [branding, salesAgg, orderCount, rewardsUnlocked, rewardsRedeemedAgg, orders, redemptions] = await Promise.all([
    ctx.db.tenantBranding.findFirst({ where: {}, select: { currency: true } }),
    ctx.db.order.aggregate({ where: { status: "PAID" }, _sum: { totalCents: true } }),
    ctx.db.order.count({ where: { status: "PAID" } }),
    ctx.db.loyaltyReward.count({ where: { active: true } }),
    ctx.db.loyaltyTransaction.aggregate({ where: { type: "REDEEMED" }, _sum: { points: true } }),
    ctx.db.order.findMany({
      orderBy: { placedAt: "desc" },
      take: 50,
      include: { customerProfile: { select: { firstName: true, lastName: true } }, items: { select: { id: true } } },
    }),
    // Who collected what, and how — a manual redemption with no code shown
    // is the one an owner might want to ask about.
    ctx.db.redeemableItem.findMany({
      where: { status: "REDEEMED" },
      orderBy: { redeemedAt: "desc" },
      take: 25,
      select: {
        id: true,
        name: true,
        redeemedAt: true,
        redemptionMethod: true,
        redemptionNote: true,
        refundedAfterUse: true,
        customerProfile: { select: { firstName: true, lastName: true } },
        redeemedBy: { select: { email: true, staffProfile: { select: { firstName: true, lastName: true } } } },
      },
    }),
  ]);

  const mayRefund = ctx.viewer.permissions === "ALL" || ctx.viewer.permissions.includes("sales.manage");

  const currency = branding?.currency ?? DEFAULT_CURRENCY;
  const totalSales = salesAgg._sum.totalCents ?? 0;
  const aov = orderCount > 0 ? Math.round(totalSales / orderCount) : 0;

  // "Payments" and "Refunds" are the same rows viewed through a status lens —
  // the old Payments page is this filter.
  const filtered = orders.filter((o) => {
    if (type === "payments") return o.status === "PAID";
    if (type === "refunds") return o.status === "REFUNDED" || o.status === "PARTIALLY_REFUNDED";
    if (type === "orders") return true;
    return true;
  });

  const days = 7;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const series = Array.from({ length: days }, () => 0);
  for (const o of orders) {
    if (o.status !== "PAID" || !o.paidAt) continue;
    const idx = Math.floor((o.paidAt.getTime() - start.getTime()) / 86_400_000);
    if (idx >= 0 && idx < days) series[idx] = (series[idx] ?? 0) + o.totalCents;
  }
  const dayLabels = Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    return d.toLocaleDateString(intlLocale, { weekday: "short", month: "short", day: "numeric" });
  });

  return (
    <div className="mx-auto max-w-[1180px]">
      <MerchantPageHeader title={t("title")} description={t("description")} />

      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-3 lg:col-span-1">
          <KpiCard label={t("totalSales")} value={formatMoney(totalSales, currency)} icon={<Receipt className="h-4 w-4" />} />
          <KpiCard
            label={t("averageOrderValue")}
            value={formatMoney(aov, currency)}
            icon={<TrendingUp className="h-4 w-4" />}
            tooltip={t("averageOrderValueTooltip")}
          />
          <KpiCard label={t("rewardsUnlocked")} value={rewardsUnlocked} icon={<Gift className="h-4 w-4" />} />
          <KpiCard
            label={t("rewardsRedeemed")}
            value={Math.abs(rewardsRedeemedAgg._sum.points ?? 0)}
            icon={<Coins className="h-4 w-4" />}
            tooltip={t("rewardsRedeemedTooltip")}
          />
        </div>

        <Panel className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-medium">{t("salesOverTime")}</h2>
            <select className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none">
              <option>{t("daily")}</option>
              <option>{t("weekly")}</option>
              <option>{t("monthly")}</option>
            </select>
          </div>
          <LineChart className="mt-4" points={series} xLabels={dayLabels} height={140} />
        </Panel>
      </div>

      <div className="mt-4">
        <Panel>
          <PanelHeader title={t("transactions")} right={<TypeFilter merchantId={merchantId} value={type} />} />
          {filtered.length === 0 ? (
            <EmptyState title={t("noTransactions")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-faint">
                    <th className="px-5 py-2.5 font-medium">{t("date")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("client")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("items")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("amount")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("status")}</th>
                    {mayRefund && <th className="px-5 py-2.5 font-medium" />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => (
                    <tr key={o.id} className="border-b border-border text-[12px] last:border-b-0 hover:bg-app">
                      <td className="px-5 py-3 text-ink-muted">
                        {o.placedAt.toLocaleDateString(intlLocale, { dateStyle: "medium" })}
                      </td>
                      <td className="px-5 py-3 font-medium">
                        {o.customerProfile.firstName} {o.customerProfile.lastName}
                      </td>
                      <td className="px-5 py-3 text-ink-muted">{o.items.length}</td>
                      <td className="tabular px-5 py-3">{formatMoney(o.totalCents, currency)}</td>
                      <td className="px-5 py-3">
                        <Pill tone={o.status === "PAID" ? "green" : o.status === "FAILED" ? "red" : "neutral"}>
                          {t(`statusLabel.${o.status}`)}
                        </Pill>
                      </td>
                      {mayRefund && (
                        <td className="px-5 py-3 text-right">
                          {(o.status === "PAID" || o.status === "PARTIALLY_REFUNDED") && (
                            <RefundButton merchantId={merchantId} orderId={o.id} orderNumber={o.orderNumber} />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel>
          <PanelHeader title={t("recentRedemptions")} />
          {redemptions.length === 0 ? (
            <EmptyState title={t("nothingRedeemedYet")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-faint">
                    <th className="px-5 py-2.5 font-medium">{t("when")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("item")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("client")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("by")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("how")}</th>
                  </tr>
                </thead>
                <tbody>
                  {redemptions.map((r) => {
                    const staff = r.redeemedBy?.staffProfile;
                    return (
                      <tr key={r.id} className="border-b border-border text-[12px] last:border-b-0 hover:bg-app">
                        <td className="px-5 py-3 text-ink-muted">
                          {r.redeemedAt ? r.redeemedAt.toLocaleString(intlLocale, { dateStyle: "medium", timeStyle: "short" }) : "-"}
                        </td>
                        <td className="px-5 py-3 font-medium">
                          {r.name}
                          {r.refundedAfterUse && <span className="ml-2 text-[11px] text-[var(--accent-red)]">{t("refundedAfterUse")}</span>}
                        </td>
                        <td className="px-5 py-3">
                          {r.customerProfile.firstName} {r.customerProfile.lastName}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {staff ? `${staff.firstName} ${staff.lastName}`.trim() : (r.redeemedBy?.email ?? "-")}
                        </td>
                        <td className="px-5 py-3">
                          <Pill tone={r.redemptionMethod === "MANUAL" ? "amber" : "neutral"}>{REDEMPTION_LABEL[r.redemptionMethod ?? "QR"]}</Pill>
                          {r.redemptionNote && <p className="mt-1 text-[11px] text-ink-muted">{r.redemptionNote}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
