"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useBasePath } from "../base-path";
import { Sheet, Icon, EmptyState, QrCode, CountUp, money, useToast } from "@/components/client-app/ui";
import { Button } from "@/components/client-app/v2";
import { clientRedeemRewardAction, clientReviewAction, clientReferralAction } from "@/lib/actions/client-app";
import type { ClientSummary, RewardsData } from "@/lib/client-app-data";

/**
 * Rewards, Pirs v2.
 *
 * Three questions in order: what the client has, what they can take now, and
 * what they are working towards. The last one is a progress bar rather than a
 * number, because "880 more points" means nothing without knowing how far that
 * is.
 */

const EARN_ICONS: Record<string, string> = {
  referral: "users",
  purchase: "bag",
  visit: "qr",
  review: "star",
  birthday: "sparkle",
};

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
  const base = useBasePath();
  const { toast } = useToast();

  const [selected, setSelected] = React.useState<RewardsData["rewards"][number] | null>(null);
  const [howOpen, setHowOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [redeemed, setRedeemed] = React.useState<{ code: string; name: string } | null>(null);

  const points = summary.loyaltyPoints;
  const affordable = data.rewards.filter((r) => r.pointsCost <= points);
  const working = data.rewards.filter((r) => r.pointsCost > points);
  const next = working[0] ?? null;

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

  async function onEarnRow(key: string, url?: string) {
    if (key === "review" && url) {
      // Open synchronously from the tap, or mobile browsers block the new tab.
      window.open(url, "_blank", "noopener,noreferrer");
      const res = await clientReviewAction(merchantSlug);
      if ("error" in res) toast(res.error);
      else {
        toast(`+${res.points} points`);
        router.refresh();
      }
      return;
    }
    if (key === "referral") {
      const link = typeof window !== "undefined" ? window.location.origin + base : "";
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({ title: "Join me", url: link });
        } catch {
          return; // user dismissed the share sheet — no points
        }
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(link).catch(() => {});
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
    if (key === "purchase") router.push(`${base}/shop`);
    if (key === "visit") router.push(`${base}/scan`);
  }

  return (
    <div className="v2-rewards">
      <div className="head">
        <h1>Rewards</h1>
        <button type="button" onClick={() => setHowOpen(true)}>
          How it works
        </button>
      </div>

      {/* What they have, and how far to the next thing. */}
      <div className="v2-balance">
        <div className="top">
          <span>
            <span className="lab">Your points</span>
            <b className="big">
              <CountUp to={points} />
            </b>
          </span>
          <span className="right">
            <span className="lab">Credit</span>
            <b className="tabular">{money(summary.cashBalanceCents, currency)}</b>
          </span>
        </div>
        {next && (
          <>
            <span className="bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.round((points / next.pointsCost) * 100))}%` }} />
            </span>
            <span className="note">
              {next.pointsCost - points} more points for your next reward: {next.name}
            </span>
          </>
        )}
      </div>

      {data.rewards.length === 0 ? (
        <div className="v2-empty">
          <EmptyState text="No rewards yet" sub="Your clinic hasn't published any. The points you earn now are kept for when they do." />
        </div>
      ) : (
        <>
          {affordable.length > 0 && (
            <section className="sec">
              <h2>Ready to redeem</h2>
              <div className="v2-rewardlist">
                {affordable.map((r) => (
                  <div className="row" key={r.id}>
                    <span className="ic" aria-hidden="true">
                      <Icon name="tag" size={22} />
                    </span>
                    <span className="txt">
                      <b>{r.name}</b>
                      <span className="tabular">{r.pointsCost} points</span>
                    </span>
                    <Button variant="pill" className="take" onClick={() => setSelected(r)}>
                      Redeem
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {working.length > 0 && (
            <section className="sec">
              <h2>Keep earning</h2>
              <div className="v2-rewardlist">
                {working.map((r) => (
                  <div className="row goal" key={r.id}>
                    <span className="ic" aria-hidden="true">
                      <Icon name="gift" size={22} />
                    </span>
                    <span className="txt">
                      <span className="line">
                        <b>{r.name}</b>
                        <span className="cost tabular">{r.pointsCost} pts</span>
                      </span>
                      <span className="bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, Math.round((points / r.pointsCost) * 100))}%` }} />
                      </span>
                      <span className="need">Need {r.pointsCost - points} more points</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {data.earnRules.length > 0 && (
        <section className="sec">
          <h2>Earn faster</h2>
          <div className="v2-earn">
            {data.earnRules.map((r) => (
              <button key={r.key} type="button" className="row" onClick={() => onEarnRow(r.key, r.url)}>
                <span className="ic" aria-hidden="true">
                  <Icon name={EARN_ICONS[r.key] ?? "sparkle"} size={20} />
                </span>
                <span className="txt">
                  <b>{r.title}</b>
                  {r.subtitle && <span>{r.subtitle}</span>}
                </span>
                <span className="badge">{r.badge}</span>
                <Icon name="chevR" size={20} />
              </button>
            ))}
          </div>
        </section>
      )}

      <Sheet open={howOpen} onClose={() => setHowOpen(false)} title="How rewards work" cta={<Button onClick={() => setHowOpen(false)}>Got it</Button>}>
        <ol className="v2-steps">
          <li>Earn points on what you spend, and every time you scan your code at the desk.</li>
          <li>Watch the bar fill up towards the next reward.</li>
          <li>Redeem it here and show the code at the desk.</li>
        </ol>
      </Sheet>

      {/* Confirm redemption */}
      <Sheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        cta={
          selected && (
            <Button loading={pending} onClick={() => redeem(selected.id)}>
              Redeem for {selected.pointsCost} points
            </Button>
          )
        }
      >
        {selected && (
          <div className="v2-confirm">
            {selected.description && <p>{selected.description}</p>}
            <p>
              This costs <b>{selected.pointsCost} points</b>. You have {points}.
            </p>
          </div>
        )}
      </Sheet>

      {/* Redemption code */}
      <Sheet open={!!redeemed} onClose={() => setRedeemed(null)} title="Your reward" cta={<Button onClick={() => setRedeemed(null)}>Done</Button>}>
        {redeemed && (
          <div className="v2-redeemed">
            <p>Show this at the desk. Single use.</p>
            <div className="code">
              <QrCode value={redeemed.code} />
            </div>
            <p className="digits">{redeemed.code}</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
