"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useBasePath } from "./base-path";
import { Icon, money, useToast } from "@/components/client-app/ui";
import { NotificationCard } from "@/components/client-app/push";
import { Button, ProductCard, Tag } from "@/components/client-app/v2";
import { useCart } from "./cart-context";
import { clientAddToCartAction } from "@/lib/actions/client-app";
import type { HomeSections, ShopCard } from "@/lib/client-app-home";
import { homeOrder } from "@/lib/home-layout";
import type { ClientSummary } from "@/lib/client-app-data";
import { formatShortDay } from "@/lib/client-format";
import { useClinicTimeZone } from "./base-path";

/**
 * Home, Pirs v2.
 *
 * Every section below renders only when it has something in it, and the order
 * they come in is decided on the server by homeOrder — a client who has never
 * bought anything would otherwise open the app to three empty shelves.
 */



export function HomeView({
  merchantSlug,
  merchantName,
  logoUrl,
  currency,
  summary,
  sections,
}: {
  merchantSlug: string;
  merchantName: string;
  logoUrl: string | null;
  currency: string;
  summary: ClientSummary;
  sections: HomeSections;
}) {
  const router = useRouter();
  const base = useBasePath();
  const timeZone = useClinicTimeZone();
  const { refresh } = useCart();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  const add = React.useCallback(
    async (kind: "SERVICE" | "PRODUCT", id: string, name: string) => {
      setBusy(id);
      const result = await clientAddToCartAction(merchantSlug, kind === "SERVICE" ? "service" : "product", id, 1);
      setBusy(null);
      if ("error" in result) {
        toast(result.error);
        return;
      }
      await refresh();
      toast(`${name} added to cart`);
    },
    [merchantSlug, refresh, toast],
  );

  const openItem = (card: { kind: "SERVICE" | "PRODUCT"; id: string }) =>
    router.push(`${base}/shop?product=${card.id}&kind=${card.kind.toLowerCase()}`);

  const row = (title: string, cards: ShopCard[], seeAllTab: string) =>
    cards.length === 0 ? null : (
      <section className="v2-sec" key={title}>
        <div className="v2-sechead">
          <h2>{title}</h2>
          <button type="button" onClick={() => router.push(`${base}/shop?tab=${seeAllTab}`)}>
            See all <Icon name="chevR" size={18} />
          </button>
        </div>
        <div className="v2-rail no-scrollbar">
          {cards.map((c) => (
            <div className="v2-railitem" key={c.id}>
              <ProductCard
                name={c.name}
                meta={c.meta}
                imageUrl={c.imageUrl}
                tags={c.tag && <Tag kind={c.tag.kind}>{c.tag.label}</Tag>}
                cents={c.viewerPriceCents}
                currency={currency}
                wasCents={c.wasCents}
                memberCents={c.memberPriceCents}
                isMember={summary.isMember}
                onJoin={() => router.push(`${base}/shop?tab=memberships`)}
                onOpen={() => openItem(c)}
                onAdd={c.soldOut || busy === c.id ? undefined : () => void add(c.kind, c.id, c.name)}
              />
            </div>
          ))}
        </div>
      </section>
    );

  const blocks: Record<string, React.ReactNode> = {
    itemsToRedeem:
      sections.itemsToRedeem > 0 ? (
        <button type="button" className="v2-redeem" key="redeem" onClick={() => router.push(`${base}/scan`)}>
          <span className="ic" aria-hidden="true">
            <Icon name="gift" size={22} />
            <span className="n tabular">{sections.itemsToRedeem}</span>
          </span>
          <span className="txt">
            <b>
              You have {sections.itemsToRedeem} {sections.itemsToRedeem === 1 ? "item" : "items"} to redeem
            </b>
            <span>Show your code at the desk</span>
          </span>
          <Icon name="chevR" size={20} />
        </button>
      ) : null,

    personalOffer: sections.personalOffer ? (
      <div className="v2-personal" key="personal">
        <span className="lead">Just for you</span>
        <b>{sections.personalOffer.title}</b>
        {sections.personalOffer.scope && <span className="scope">{sections.personalOffer.scope}</span>}
        <Button variant="brand" className="use" onClick={() => router.push(`${base}/shop`)}>
          Use now
        </Button>
      </div>
    ) : null,

    buyAgain:
      sections.buyAgain.length > 0 ? (
        <section className="v2-sec" key="buyagain">
          <div className="v2-sechead">
            <h2>Buy again</h2>
          </div>
          <div className="v2-stack">
            {sections.buyAgain.map((b) => (
              <div className="v2-again" key={b.id}>
                <div className="thumb">
                  {b.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.imageUrl} alt="" />
                  ) : (
                    <span aria-hidden="true">{b.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="info">
                  <b>{b.name}</b>
                  <span>
                    {formatShortDay(b.lastBoughtAt, timeZone)} · {money(b.lastPaidCents, currency)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  className="again"
                  loading={busy === b.id}
                  onClick={() => void add(b.kind, b.id, b.name)}
                >
                  Buy again
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null,

    offers:
      sections.offers.length > 0 ? (
        <section className="v2-sec" key="offers">
          <div className="v2-sechead">
            <h2>Featured offers</h2>
            <button type="button" onClick={() => router.push(`${base}/shop`)}>
              See all <Icon name="chevR" size={18} />
            </button>
          </div>
          <div className="v2-rail no-scrollbar">
            {sections.offers.map((o) => (
              <button type="button" className="v2-offer" key={o.id} onClick={() => router.push(`${base}/shop`)}>
                <span className="art">
                  {o.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.imageUrl} alt="" loading="lazy" />
                  ) : null}
                  {o.discountLabel && <span className="disc">{o.discountLabel}</span>}
                </span>
                <b>{o.title}</b>
                <span className="meta">
                  {o.scope ? `${o.scope} · ` : ""}until {formatShortDay(o.endsAt, timeZone)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null,

    popularTreatments: row("Popular treatments", sections.popularTreatments, "treatments"),
    products: row("Skin care products", sections.products, "browse"),

    membershipPitch: sections.membershipPitch ? (
      <section className="v2-sec" key="pitch">
        <div className="v2-pitch">
          <div className="top">
            <Tag kind="soft">MEMBERSHIP</Tag>
            <span className="price">
              <b className="tabular">{money(sections.membershipPitch.priceCents, currency)}</b>
              <span>per {sections.membershipPitch.interval}</span>
            </span>
          </div>
          <h3>
            {sections.membershipPitch.savingCents
              ? `Save ${money(sections.membershipPitch.savingCents, currency)} a ${sections.membershipPitch.interval}`
              : `Become a ${merchantName} member`}
          </h3>
          {sections.membershipPitch.blurb && <p>{sections.membershipPitch.blurb}</p>}
          {sections.membershipPitch.savingCents != null && <p className="basis">Based on what you bought before.</p>}
          <Button onClick={() => router.push(`${base}/shop?tab=memberships`)}>Become a member</Button>
        </div>
      </section>
    ) : null,

    nextReward: sections.nextReward ? (
      <section className="v2-sec" key="points">
        <button type="button" className="v2-points" onClick={() => router.push(`${base}/rewards`)}>
          <div className="head">
            <span>
              <span className="lab">Your points</span>
              <b className="tabular">{sections.points}</b>
            </span>
            <span className="next">
              <span className="lab">Next reward</span>
              <b>{sections.nextReward.name}</b>
            </span>
          </div>
          <span className="bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round((sections.points / sections.nextReward.pointsCost) * 100))}%` }} />
          </span>
          <span className="togo">{sections.nextReward.pointsToGo} more points to go</span>
        </button>
      </section>
    ) : null,
  };

  return (
    <div className="v2-home">
      {/* 1. Clinic header */}
      <header className="v2-clinic">
        <div className="cover">
          {sections.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sections.coverImageUrl} alt="" />
          ) : null}
          <span className="logo">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={merchantName} />
            ) : (
              <span aria-hidden="true">{merchantName.charAt(0).toUpperCase()}</span>
            )}
          </span>
        </div>
        <p className="hi">Welcome back, {summary.firstName}</p>
        <h1>{merchantName}</h1>
        {sections.address && (
          <p className="addr">
            <Icon name="pin" size={18} />
            <span>{sections.address}</span>
            <a href={`https://maps.google.com/?q=${encodeURIComponent(sections.address)}`} target="_blank" rel="noreferrer">
              Directions
            </a>
          </p>
        )}
      </header>

      {/* 2. Wallet strip */}
      <div className="v2-wallet">
        <button type="button" className="credit" onClick={() => router.push(`${base}/profile`)}>
          <span className="lab">Credit</span>
          <b className="tabular">{money(sections.creditCents, currency)}</b>
        </button>
        <div className="side">
          <button type="button" className="chip" onClick={() => router.push(`${base}/profile?tab=membership`)}>
            {sections.membershipLabel}
          </button>
          <button type="button" className="chip points" onClick={() => router.push(`${base}/rewards`)}>
            <Icon name="star" size={14} />
            <span className="tabular">{sections.points} points</span>
          </button>
        </div>
      </div>

      <div className="v2-notify">
        <NotificationCard clinicName={merchantName} />
      </div>

      {homeOrder(sections.returning).map((key) => blocks[key])}
    </div>
  );
}
