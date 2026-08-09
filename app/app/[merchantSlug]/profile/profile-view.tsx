"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BlackButton, ClientCard, ClientEmptyState, SegmentedTabs, StatusPill } from "@/components/client-app/primitives";
import { formatMoney } from "@/lib/utils";
import { signOutAction } from "@/lib/actions/session";
import type { ClientSummary } from "@/lib/client-app-data";

const SEGMENTS = [
  { key: "treatments", label: "Treatments" },
  { key: "membership", label: "Membership" },
  { key: "settings", label: "Settings" },
];

export function ProfileView({
  merchantSlug,
  currency,
  tab,
  summary,
  appointments,
  orders,
  billing,
}: {
  merchantSlug: string;
  currency: string;
  tab: string;
  summary: ClientSummary | null;
  appointments: { id: string; name: string; location: string; startAt: string; status: string }[];
  orders: { id: string; number: string; placedAt: string; totalCents: number; itemNames: string[] }[];
  billing: { id: string; description: string; amountCents: number | null; occurredAt: string }[];
}) {
  const router = useRouter();
  const base = `/app/${merchantSlug}`;
  const money = (c: number) => formatMoney(c, currency);
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  function setTab(next: string) {
    router.push(`${base}/profile${next === "treatments" ? "" : `?tab=${next}`}`);
  }

  const hasTreatments = appointments.length > 0 || orders.length > 0;

  return (
    <div>
      <SegmentedTabs segments={SEGMENTS} active={tab} onSelect={setTab} />

      {tab === "treatments" && (
        <div className="space-y-3 px-[var(--space-screen-x)] pt-5">
          {!hasTreatments ? (
            <ClientCard>
              <ClientEmptyState
                text="No treatment purchased"
                action={
                  <BlackButton className="px-6" onClick={() => router.push(`${base}/shop`)}>
                    Browse the shop
                  </BlackButton>
                }
              />
            </ClientCard>
          ) : (
            <>
              {appointments.map((a) => (
                <ClientCard key={a.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-semibold text-[var(--ink)]">{a.name}</p>
                      <p className="text-[16px] text-[var(--muted)]">
                        {date(a.startAt)} · {a.location}
                      </p>
                    </div>
                    <StatusPill tone={a.status === "CONFIRMED" ? "active" : "neutral"}>{a.status}</StatusPill>
                  </div>
                </ClientCard>
              ))}
              {orders.map((o) => (
                <ClientCard key={o.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-semibold text-[var(--ink)]">
                        {o.itemNames[0] ?? o.number}
                        {o.itemNames.length > 1 && ` +${o.itemNames.length - 1}`}
                      </p>
                      <p className="text-[16px] text-[var(--muted)]">{date(o.placedAt)}</p>
                    </div>
                    <span className="tabular shrink-0 text-[16px] font-semibold">{money(o.totalCents)}</span>
                  </div>
                </ClientCard>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "membership" && (
        <div className="space-y-3 px-[var(--space-screen-x)] pt-5">
          {summary?.isMember ? (
            <>
              <ClientCard className="p-[var(--space-card-pad)]">
                <p className="text-[23px] font-bold text-[var(--ink-strong)]">{summary.membershipPlanName}</p>
                {summary.membershipNextBillingAt && (
                  <p className="mt-1 text-[16px] text-[var(--muted)]">Next billing {date(summary.membershipNextBillingAt)}</p>
                )}
                <div className="mt-4 flex gap-3">
                  <BlackButton variant="outline" className="h-11 px-5 text-[15px]">
                    Manage
                  </BlackButton>
                  <button type="button" className="press text-[15px] font-semibold text-[var(--danger)]">
                    Cancel
                  </button>
                </div>
              </ClientCard>

              {billing.length > 0 && (
                <ClientCard className="p-4">
                  <p className="text-[16px] font-semibold text-[var(--ink)]">Billing history</p>
                  <ul className="mt-2 divide-y divide-[var(--hairline)]">
                    {billing.map((b) => (
                      <li key={b.id} className="flex items-center justify-between py-2.5 text-[16px]">
                        <span className="text-[var(--muted)]">{b.description}</span>
                        <span className="tabular">{b.amountCents !== null ? money(b.amountCents) : "—"}</span>
                      </li>
                    ))}
                  </ul>
                </ClientCard>
              )}
            </>
          ) : (
            <ClientCard className="p-[var(--space-card-pad)]">
              <p className="text-[23px] font-bold leading-tight text-[var(--ink-strong)]">Become a member</p>
              <p className="mt-2 text-[16px] text-[var(--muted)]">Free treatments. Exclusive perks.</p>
              <BlackButton className="mt-4 px-6" onClick={() => router.push(`${base}/shop?tab=memberships`)}>
                See memberships
              </BlackButton>
            </ClientCard>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div className="px-[var(--space-screen-x)] pt-5">
          <ClientCard className="overflow-hidden">
            {[
              "Personal details",
              "Notification preferences",
              "Payment methods",
              "Order history",
              "Referral link",
              "Language",
              "Help & support",
              "Terms & privacy",
            ].map((label) => (
              <button
                key={label}
                type="button"
                className="press flex w-full items-center justify-between border-b border-[var(--hairline)] px-4 py-4 text-left last:border-b-0"
              >
                <span className="text-[16px] text-[var(--ink)]">{label}</span>
                <span className="text-[18px] leading-none text-[var(--faint)]">›</span>
              </button>
            ))}
          </ClientCard>

          <form action={signOutAction} className="mt-5">
            <button type="submit" className="press w-full py-3 text-center text-[16px] font-semibold text-[var(--ink)]">
              Log out
            </button>
          </form>
          <button type="button" className="press w-full py-2 text-center text-[16px] font-semibold text-[var(--danger)]">
            Delete account
          </button>
        </div>
      )}
    </div>
  );
}
