import Link from "next/link";
import { CreditCard, Users } from "lucide-react";
import { requireMerchantContext } from "@/lib/merchant-context";
import { MerchantPageHeader } from "@/components/merchant/page-header";
import { KpiCard } from "@/components/ui/stat-card";
import { Panel, PanelHeader, Pill } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { LineChart } from "@/components/ui/line-chart";
import { formatMoney } from "@/lib/utils";

/**
 * Monitoring only. Plans are created and edited in App Builder → Membership,
 * which is why there is no create button here.
 */
export default async function MembershipsPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  const ctx = await requireMerchantContext(merchantId);

  const [branding, active, plans, dunning] = await Promise.all([
    ctx.db.tenantBranding.findFirst({ where: {}, select: { currency: true } }),
    ctx.db.customerMembership.findMany({
      where: { status: "ACTIVE" },
      select: { startedAt: true, membershipPlan: { select: { priceCents: true, billingFrequency: true } } },
    }),
    ctx.db.membershipPlan.findMany({
      where: { active: true },
      orderBy: { priceCents: "asc" },
      include: { _count: { select: { customerMemberships: true } } },
    }),
    ctx.db.customerMembership.findMany({
      where: { status: "PAST_DUE" },
      include: {
        customerProfile: { select: { firstName: true, lastName: true } },
        membershipPlan: { select: { name: true, priceCents: true } },
      },
    }),
  ]);

  const currency = branding?.currency ?? "EUR";
  const mrr = active.reduce(
    (s, m) =>
      s + (m.membershipPlan.billingFrequency === "ANNUAL" ? Math.round(m.membershipPlan.priceCents / 12) : m.membershipPlan.priceCents),
    0,
  );

  const days = 7;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const signups = Array.from({ length: days }, () => 0);
  for (const m of active) {
    const idx = Math.floor((m.startedAt.getTime() - start.getTime()) / 86_400_000);
    if (idx >= 0 && idx < days) signups[idx] = (signups[idx] ?? 0) + 1;
  }
  const dayLabels = Array.from({ length: days }, (_, i) =>
    new Date(start.getTime() + i * 86_400_000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <MerchantPageHeader title="Memberships" merchantName={ctx.merchantName} />

      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-3 lg:col-span-1">
          <KpiCard label="Monthly Recurring Revenue" value={formatMoney(mrr, currency)} icon={<CreditCard className="h-4 w-4" />} />
          <KpiCard
            label="Total active Members"
            value={active.length}
            icon={<Users className="h-4 w-4" />}
            tooltip="Clients with a membership in the ACTIVE state."
          />
        </div>

        <Panel className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-medium">Membership Sign Ups over time</h2>
            <select className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none">
              <option>Daily</option>
              <option>Weekly</option>
              <option>Monthly</option>
            </select>
          </div>
          <LineChart className="mt-4" points={signups} xLabels={dayLabels} height={140} />
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <PanelHeader title="Credit Card Dunning" />
          {dunning.length === 0 ? (
            <EmptyState title="No dunning transactions available" className="py-10" />
          ) : (
            <ul className="divide-y divide-border">
              {dunning.map((d) => (
                <li key={d.id} className="px-5 py-3 text-[12px]">
                  <p className="font-medium">
                    {d.customerProfile.firstName} {d.customerProfile.lastName}
                  </p>
                  <p className="text-ink-muted">
                    {d.membershipPlan.name} · {formatMoney(d.membershipPlan.priceCents, currency)} · {d.failedAttempts} attempts
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader title="Plans" />
          {plans.length === 0 ? (
            <EmptyState
              title="No memberships available"
              action={
                <Link
                  href={`/m/${merchantId}/app-builder?tab=membership`}
                  className="text-[13px] font-medium text-primary underline"
                >
                  Create in App Builder →
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {plans.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-5 py-3 text-[12px]">
                  <div>
                    <p className="text-[13px] font-semibold">{p.name}</p>
                    <p className="text-ink-muted">
                      {formatMoney(p.priceCents, currency)} / {p.billingFrequency === "MONTHLY" ? "mo" : "yr"} ·{" "}
                      {p._count.customerMemberships} member{p._count.customerMemberships === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Pill tone={p.active ? "green" : "neutral"}>{p.active ? "Active" : "Inactive"}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
