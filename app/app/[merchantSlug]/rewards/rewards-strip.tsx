"use client";

import * as React from "react";
import { ClientCard, BlackButton, BottomSheet } from "@/components/client-app/primitives";

export interface RewardItem {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
}

export function RewardsStrip({ rewards, balance }: { rewards: RewardItem[]; balance: number }) {
  const [selected, setSelected] = React.useState<RewardItem | null>(null);
  const [redeemed, setRedeemed] = React.useState(false);

  return (
    <>
      <div className="no-scrollbar -mx-[var(--space-screen-x)] mt-3 flex gap-3 overflow-x-auto px-[var(--space-screen-x)]">
        {rewards.map((r) => {
          const affordable = balance >= r.pointsCost;
          const shortBy = r.pointsCost - balance;
          return (
            <ClientCard key={r.id} className="flex w-[190px] shrink-0 flex-col p-4">
              <div className="flex h-20 items-center justify-center rounded-[var(--radius-tile)] bg-[var(--pill-bg)]">
                <GiftGlyph />
              </div>
              <p className="mt-3 text-[16px] font-semibold leading-snug text-[var(--ink)]">{r.name}</p>
              <p className="mt-0.5 text-[16px] text-[var(--muted)]">{r.pointsCost} points</p>
              <BlackButton
                className="mt-3 h-11 w-full text-[15px]"
                disabled={!affordable}
                onClick={() => {
                  setRedeemed(false);
                  setSelected(r);
                }}
              >
                {affordable ? "Redeem" : `${shortBy} more points`}
              </BlackButton>
            </ClientCard>
          );
        })}
      </div>

      <BottomSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={redeemed ? "Show this at the clinic" : selected?.name}
        footer={
          redeemed ? (
            <BlackButton className="w-full" onClick={() => setSelected(null)}>
              Done
            </BlackButton>
          ) : (
            <BlackButton className="w-full" onClick={() => setRedeemed(true)}>
              Confirm — {selected?.pointsCost} points
            </BlackButton>
          )
        }
      >
        {selected && !redeemed && (
          <>
            {selected.description && <p className="text-[16px] text-[var(--muted)]">{selected.description}</p>}
            <p className="mt-4 text-[16px] text-[var(--ink)]">
              Redeeming costs <span className="font-semibold">{selected.pointsCost} points</span>. You have {balance}.
            </p>
          </>
        )}
        {redeemed && (
          <div className="flex flex-col items-center py-6">
            {/* Single-use redemption code. Rendered as a placeholder block —
                the encoder is shared with the Scan tab's QR once wired. */}
            <div className="flex h-44 w-44 items-center justify-center rounded-[var(--radius-tile)] bg-[var(--pill-bg)] text-[13px] text-[var(--muted)]">
              Redemption QR
            </div>
            <p className="mt-4 text-center text-[16px] text-[var(--muted)]">Valid once. Staff will scan this to apply your reward.</p>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

function GiftGlyph() {
  return (
    <svg width="34" height="34" viewBox="0 0 26 26" fill="none" stroke="var(--faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="18" height="11" rx="1.5" />
      <path d="M4 14h18M13 10v11" />
      <path d="M13 10c-2.2 0-4-1.1-4-3s1.5-3 2.6-2c1 .9 1.4 3 1.4 5Z" />
      <path d="M13 10c2.2 0 4-1.1 4-3s-1.5-3-2.6-2c-1 .9-1.4 3-1.4 5Z" />
    </svg>
  );
}
