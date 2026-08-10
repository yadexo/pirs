"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Gloss, Sheet, Icon, EmptyState, QrCode, CountUp, money, useToast } from "@/components/client-app/ui";
import { clientRedeemRewardAction, clientReferralAction } from "@/lib/actions/client-app";
import type { ClientSummary, RewardsData } from "@/lib/client-app-data";

export function RewardsView({
  merchantSlug,
  currency,
  summary,
  data,
}: {
  merchantSlug: string;
  currency: string;
  summary: ClientSummary;
  data: RewardsData;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [selected, setSelected] = React.useState<RewardsData["rewards"][number] | null>(null);
  const [seeAll, setSeeAll] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [redeemed, setRedeemed] = React.useState<{ code: string; name: string } | null>(null);

  async function redeem(id: string) {
    setPending(true);
    const res = await clientRedeemRewardAction(merchantSlug, id);
    setPending(false);
    if ("error" in res) {
      toast(res.error);
      return;
    }
    setRedeemed({ code: res.code, name: res.name });
    setSelected(null);
    router.refresh();
  }

  async function onEarnRow(key: string) {
    if (key === "referral") {
      const url = typeof window !== "undefined" ? window.location.origin + `/app/${merchantSlug}` : "";
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({ title: "Join me", url });
        } catch {
          return; // user dismissed the share sheet — no points
        }
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => {});
        toast("Referral link copied");
      }
      const res = await clientReferralAction(merchantSlug);
      if ("error" in res) toast(res.error);
      else {
        toast(`+${res.points} points`);
        router.refresh();
      }
      return;
    }
    if (key === "purchase") router.push(`/app/${merchantSlug}/shop`);
    if (key === "visit") router.push(`/app/${merchantSlug}/scan`);
  }

  return (
    <div>
      {/* Loyalty card */}
      <div style={{ padding: "var(--pad-x) var(--pad-x) 4px" }}>
        <Gloss className="loyal" bevel>
          <div>
            <div style={{ fontSize: 42, fontWeight: 700, color: "var(--on-black)", lineHeight: 1.05 }}>
              <CountUp to={summary.loyaltyPoints} />
            </div>
            <div style={{ fontSize: 14, color: "var(--on-black-muted)" }}>Loyalty Points</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--on-black)" }}>{summary.firstName}</div>
              <div style={{ fontSize: 13, color: "var(--on-black-muted)" }}>Joined {summary.joinedDaysAgo} days ago</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span className="pill-light tabular">{money(summary.cashBalanceCents, currency)}</span>
              <span style={{ fontSize: 19, color: "var(--on-black-muted)" }}>Patient App Cash</span>
            </div>
          </div>
        </Gloss>
      </div>

      {/* Rewards */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px var(--pad-x) 10px" }}>
        <h2 className="h-sec">Rewards</h2>
        {data.rewards.length > 0 && (
          <button onClick={() => setSeeAll(true)} style={{ color: "var(--muted)", fontSize: 15, fontWeight: 500 }}>
            See more ›
          </button>
        )}
      </div>

      {data.rewards.length === 0 ? (
        <div style={{ padding: "0 var(--pad-x)" }}>
          <div className="ca-card">
            <EmptyState text="No rewards available yet" sub="Your clinic hasn't published any rewards." />
          </div>
        </div>
      ) : (
        <div className="rwrow no-scrollbar">
          {data.rewards.map((r) => {
            const affordable = summary.loyaltyPoints >= r.pointsCost;
            return (
              <div key={r.id} className="rwcard">
                <Gloss style={{ height: 100 }}>
                  <span style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--on-black-muted)" }}>
                    <Icon name="gift" size={30} />
                  </span>
                </Gloss>
                <span style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                  <b style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-strong)" }}>{r.name}</b>
                  <span className="tabular" style={{ fontSize: 12, color: "var(--muted)" }}>
                    {r.pointsCost} points
                  </span>
                  {affordable ? (
                    <button className="pill-badge" onClick={() => setSelected(r)}>
                      Redeem
                    </button>
                  ) : (
                    <span className="pill-light dis tabular">{r.pointsCost - summary.loyaltyPoints} more points</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Need more points? */}
      {data.earnRules.length > 0 && (
        <>
          <div style={{ padding: "20px var(--pad-x) 2px" }}>
            <h2 className="h-sec">Need more points?</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "10px var(--pad-x) 0" }}>
            {data.earnRules.map((r) => (
              <button key={r.key} className="needrow" onClick={() => onEarnRow(r.key)}>
                <span style={{ color: "var(--ink-strong)", flex: "none", display: "grid", placeItems: "center" }}>
                  <Icon name={r.key === "referral" ? "users" : r.key === "purchase" ? "bag" : r.key === "visit" ? "qr" : "sparkle"} size={22} />
                </span>
                <span style={{ flex: 1 }}>
                  <b style={{ fontSize: 16, fontWeight: 500, color: "var(--ink)", display: "block" }}>{r.title}</b>
                  {r.subtitle && <span style={{ fontSize: 13, color: "var(--muted)" }}>{r.subtitle}</span>}
                </span>
                <span className="pill-badge">{r.badge}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Confirm redemption */}
      <Sheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        cta={
          selected && (
            <button className="btn-black" disabled={pending} onClick={() => redeem(selected.id)}>
              {pending ? "Redeeming…" : `Redeem for ${selected.pointsCost} points`}
            </button>
          )
        }
      >
        {selected && (
          <>
            {selected.description && <p style={{ color: "var(--muted)", fontSize: 15, marginTop: -8 }}>{selected.description}</p>}
            <p style={{ fontSize: 16, marginTop: 12 }}>
              This costs <b>{selected.pointsCost} points</b>. You have {summary.loyaltyPoints}.
            </p>
          </>
        )}
      </Sheet>

      {/* Redemption code */}
      <Sheet
        open={!!redeemed}
        onClose={() => setRedeemed(null)}
        title="Your reward"
        cta={
          <button className="btn-black" onClick={() => setRedeemed(null)}>
            Done
          </button>
        }
      >
        {redeemed && (
          <>
            <p style={{ color: "var(--muted)", fontSize: 15, marginTop: -8 }}>
              Show this at the desk. Single use.
            </p>
            <div style={{ display: "flex", justifyContent: "center", padding: "18px 0" }}>
              <div className="qwhite" style={{ width: "56%", padding: 16, boxShadow: "var(--shadow-card)" }}>
                <QrCode value={redeemed.code} />
              </div>
            </div>
            <p style={{ textAlign: "center", fontWeight: 700, fontSize: 18, letterSpacing: "0.06em" }}>{redeemed.code}</p>
          </>
        )}
      </Sheet>

      {/* All rewards */}
      <Sheet open={seeAll} onClose={() => setSeeAll(false)} title="All rewards">
        {data.rewards.map((r) => {
          const affordable = summary.loyaltyPoints >= r.pointsCost;
          return (
            <div key={r.id} className="optrow">
              <span style={{ flex: 1 }}>
                <b style={{ fontSize: 15 }}>{r.name}</b>
                <br />
                <span className="tabular" style={{ color: "var(--muted)", fontSize: 13 }}>
                  {r.pointsCost} points
                </span>
              </span>
              {affordable ? (
                <button
                  className="pill-badge"
                  onClick={() => {
                    setSeeAll(false);
                    setSelected(r);
                  }}
                >
                  Redeem
                </button>
              ) : (
                <span className="pill-light dis tabular">{r.pointsCost - summary.loyaltyPoints} more</span>
              )}
            </div>
          );
        })}
      </Sheet>
    </div>
  );
}
