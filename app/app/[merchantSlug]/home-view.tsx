"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useBasePath } from "./base-path";
import { Gloss, Icon, Sheet, money } from "@/components/client-app/ui";
import type { ClientSummary, HomeData } from "@/lib/client-app-data";

export function HomeView({
  merchantName,
  currency,
  summary,
  home,
}: {
  merchantName: string;
  currency: string;
  summary: ClientSummary;
  home: HomeData;
}) {
  const router = useRouter();
  const base = useBasePath();
  const [offer, setOffer] = React.useState<HomeData["offers"][number] | null>(null);
  const [locIndex, setLocIndex] = React.useState(0);

  return (
    <div>
      {/* 1. Hero */}
      <Gloss className="hero">
        <div className="hero-inner">
          <h1 className="hero-hi">Welcome back, {summary.firstName}!</h1>
          <div className="hero-ghost">{merchantName}</div>
        </div>
        <div className="hero-fade" />
      </Gloss>

      {/* 2. Wallet strip, overlapping the hero seam */}
      <button className="wallet" onClick={() => router.push(`${base}/rewards`)} aria-label="Open rewards and wallet">
        <span className="pill-light tabular">{money(summary.cashBalanceCents, currency)}</span>
        <span style={{ fontSize: 15, color: "var(--muted)" }}>Patient App Cash</span>
        <span style={{ flex: 1 }} />
        <span className="status-pill">{summary.isMember ? "Member" : "Not a member"}</span>
        <span style={{ color: "var(--faint)", display: "grid", placeItems: "center" }}>
          <Icon name="chevR" size={18} />
        </span>
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", padding: "var(--gap) var(--pad-x) 0" }}>
        {/* 3. Membership: the plan they hold, or the upsell */}
        {summary.isMember ? (
          <div className="ca-card" style={{ padding: "var(--pad-card)" }}>
            <h3 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink-strong)" }}>Your membership</h3>
            <p style={{ color: "var(--ink)", fontWeight: 600, margin: "2px 0 0" }}>
              {summary.membershipPlanName}
              {summary.membershipPriceCents != null && ` · ${money(summary.membershipPriceCents, currency)}/month`}
            </p>
            {summary.membershipNextBillingAt && (
              <p style={{ color: "var(--muted)", fontSize: 15, margin: "6px 0 16px" }}>
                Next billing{" "}
                {new Date(summary.membershipNextBillingAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            )}
            <button className="btn-black" style={{ width: "auto", padding: "0 28px" }} onClick={() => router.push(`${base}/profile?tab=membership`)}>
              Manage
            </button>
          </div>
        ) : (
          home.hasPlans && (
            <div className="ca-card" style={{ padding: "var(--pad-card)" }}>
              <h3 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink-strong)" }}>
                Save big money <span style={{ fontWeight: 400 }}>as a {merchantName} member</span>
              </h3>
              <p style={{ color: "var(--muted)", fontSize: 15, margin: "6px 0 16px" }}>Free treatments. Exclusive perks.</p>
              <button
                className="btn-black"
                style={{ width: "auto", padding: "0 28px" }}
                onClick={() => router.push(`${base}/shop?tab=memberships`)}
              >
                See benefits
              </button>
            </div>
          )
        )}
      </div>

      {/* 4. Pay later — only when the clinic enabled it in App Builder */}
      {home.payLaterEnabled && (
        <div className="payband">
          <span className="klarna">Klarna.</span>
          <div>
            <b style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--ink-strong)" }}>
              Treat today. Pay later. Earn rewards.
            </b>
            <span style={{ fontSize: 14, color: "var(--muted)" }}>Make monthly payments with no late fees</span>
          </div>
        </div>
      )}

      {/* 5. Offers */}
      {home.offers.length > 0 && (
        <>
          <div style={{ padding: "8px var(--pad-x) 12px" }}>
            <h2 className="h-sec">Offers for you</h2>
          </div>
          <div className="offrow no-scrollbar">
            {home.offers.map((o) => (
              <button key={o.id} className="offcard" onClick={() => setOffer(o)}>
                {o.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.imageUrl} alt="" style={{ width: "100%", height: 112, objectFit: "cover" }} loading="lazy" />
                ) : (
                  <Gloss style={{ height: 112 }} />
                )}
                <span style={{ display: "block", padding: "12px 14px 14px" }}>
                  <b style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-strong)", display: "block" }}>{o.title}</b>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    Ends {new Date(o.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* 6. Locations */}
      {home.locations.length > 0 && (
        <section style={{ marginTop: 6 }}>
          <div
            className="locs"
            onScroll={(e) => setLocIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          >
            {home.locations.map((l) => (
              <div className="locslide" key={l.id}>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(l.address || l.name)}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${l.name} in maps`}
                >
                  <Gloss style={{ height: 300 }}>
                    <span style={{ display: "grid", placeItems: "center", height: "100%" }}>
                      <span
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 999,
                          background: "var(--on-black)",
                          display: "grid",
                          placeItems: "center",
                          color: "var(--ink-strong)",
                        }}
                      >
                        <Icon name="pin" size={22} />
                      </span>
                    </span>
                  </Gloss>
                </a>
                <div className="locinfo">
                  <h4>{l.name}</h4>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--muted)", fontSize: 15 }}>
                    <Icon name="pin" size={18} /> {l.address || "Address not set"}
                  </span>
                  {l.phone && (
                    <a className="btn-black" href={`tel:${l.phone}`}>
                      <Icon name="phone" size={20} /> Call now
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
          {home.locations.length > 1 && (
            <div className="dots">
              {home.locations.map((l, i) => (
                <i key={l.id} className={i === locIndex ? "on" : undefined} />
              ))}
            </div>
          )}
        </section>
      )}

      <Sheet
        open={!!offer}
        onClose={() => setOffer(null)}
        title={offer?.title}
        cta={
          <button
            className="btn-black"
            onClick={() => {
              setOffer(null);
              router.push(`${base}/shop`);
            }}
          >
            Go to shop
          </button>
        }
      >
        {offer && (
          <>
            <p style={{ color: "var(--muted)", fontSize: 15, marginTop: -6 }}>
              Ends {new Date(offer.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
            {offer.description && <p style={{ fontSize: 16, paddingTop: 8 }}>{offer.description}</p>}
            {offer.code && (
              <p style={{ fontSize: 16, paddingTop: 8 }}>
                Use code <b>{offer.code}</b> at checkout.
              </p>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}
