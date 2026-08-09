import Link from "next/link";
import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary, getHomeData } from "@/lib/client-app-data";
import { GlossSurface } from "@/components/client-app/gloss-surface";
import { ClientCard, StatusPill, ValuePill, BlackButton } from "@/components/client-app/primitives";
import { formatMoney } from "@/lib/utils";
import { LocationBlock } from "./location-block";

export default async function ClientHomePage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);
  const [summary, home] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId!),
    getHomeData(ctx.db),
  ]);
  if (!summary) return null;

  const base = `/app/${merchantSlug}`;
  const money = (c: number) => formatMoney(c, ctx.merchant.currency);

  return (
    <div>
      {/* 1. Hero */}
      <GlossSurface
        radius="0px"
        className="min-h-[30dvh]"
        // Bottom edge dissolves into the app background.
      >
        <div
          className="px-[var(--space-screen-x)] pb-16 pt-8"
          style={{ maskImage: "linear-gradient(to bottom, black 72%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 72%, transparent 100%)" }}
        >
          <p className="text-[32px] font-bold leading-tight text-[var(--on-black)]">Welcome back, {summary.firstName}!</p>
          <p className="text-[32px] font-bold leading-tight text-white/[0.12]">{ctx.merchant.name}</p>
        </div>
      </GlossSurface>

      {/* 2. Wallet strip — overlaps the hero seam */}
      <div className="-mt-9 px-[var(--space-screen-x)]">
        <Link href={`${base}/rewards`} className="press block">
          <div className="flex h-[72px] items-center gap-3 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] px-4 shadow-[var(--shadow-float)]">
            <ValuePill>{money(summary.cashBalanceCents)}</ValuePill>
            <span className="text-[16px] text-[var(--muted)]">Patient App Cash</span>
            <span className="ml-auto flex items-center gap-2">
              <StatusPill tone={summary.isMember ? "active" : "neutral"}>{summary.isMember ? "Member" : "Not a member"}</StatusPill>
              <span className="text-[20px] leading-none text-[var(--faint)]">›</span>
            </span>
          </div>
        </Link>
      </div>

      <div className="space-y-[var(--space-stack)] px-[var(--space-screen-x)] pt-[var(--space-stack)]">
        {/* 3. Membership card — upsell, or the plan they already hold */}
        {summary.isMember ? (
          <ClientCard className="p-[var(--space-card-pad)]">
            <p className="text-[23px] font-bold leading-tight text-[var(--ink-strong)]">Your membership</p>
            <p className="mt-1 text-[16px] text-[var(--muted)]">
              {summary.membershipPlanName}
              {summary.membershipNextBillingAt &&
                ` · renews ${new Date(summary.membershipNextBillingAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            </p>
            <Link href={`${base}/profile?tab=membership`} className="press mt-3 inline-block text-[16px] font-semibold text-[var(--ink)] underline">
              Manage
            </Link>
          </ClientCard>
        ) : (
          <ClientCard className="p-[var(--space-card-pad)]">
            <p className="text-[23px] leading-tight text-[var(--ink-strong)]">
              <span className="font-bold">Save big money</span>{" "}
              <span className="font-normal">as a {ctx.merchant.name} member</span>
            </p>
            <p className="mt-2 text-[16px] text-[var(--muted)]">Free treatments. Exclusive perks.</p>
            <Link href={`${base}/shop?tab=memberships`} className="press mt-4 inline-block">
              <BlackButton className="px-6">See benefits</BlackButton>
            </Link>
          </ClientCard>
        )}

        {/* 4. Pay-later row — only when the merchant enabled it */}
        {home.payLaterEnabled && (
          <ClientCard className="flex items-center gap-3 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-tile)] bg-[#FFB3C7] text-[13px] font-bold text-[var(--ink-strong)]">
              K
            </span>
            <span>
              <span className="block text-[16px] font-semibold text-[var(--ink)]">Treat today. Pay later. Earn rewards.</span>
              <span className="block text-[16px] text-[var(--muted)]">Make monthly payments with no late fees</span>
            </span>
          </ClientCard>
        )}

        {/* 5. Offers strip */}
        {home.offers.length > 0 && (
          <section>
            <h2 className="text-[23px] font-bold text-[var(--ink-strong)]">Offers</h2>
            <div className="no-scrollbar -mx-[var(--space-screen-x)] mt-3 flex gap-3 overflow-x-auto px-[var(--space-screen-x)]">
              {home.offers.map((o) => (
                <ClientCard key={o.id} className="w-[240px] shrink-0 overflow-hidden">
                  {o.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.imageUrl} alt="" className="h-28 w-full object-cover" loading="lazy" />
                  )}
                  <div className="p-4">
                    <p className="text-[16px] font-semibold text-[var(--ink)]">{o.title}</p>
                    <p className="mt-1 text-[13px] text-[var(--muted)]">
                      Ends {new Date(o.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </ClientCard>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 6. Location block */}
      <LocationBlock locations={home.locations} merchantName={ctx.merchant.name} />
    </div>
  );
}
