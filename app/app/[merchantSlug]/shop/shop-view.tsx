"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useBasePath } from "../base-path";
import { Sheet, Icon, Stepper, Carousel, EmptyState, money, useToast } from "@/components/client-app/ui";
import { Button, PriceBlock, ProductCard, SegmentedControl, Tag } from "@/components/client-app/v2";
import { clientAddToCartAction, clientJoinPlanAction } from "@/lib/actions/client-app";
import { useCart } from "../cart-context";
import { CardPayment } from "../card-payment";
import { BookingSheet, type BookableService } from "./booking-sheet";
import type { ShopCard } from "@/lib/client-app-catalog";

export interface ShopPlan {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  interval: string;
  benefits: string[];
}

const SEGMENTS = [
  { value: "browse", label: "Browse" },
  { value: "memberships", label: "Memberships" },
  { value: "treatments", label: "Treatments" },
] as const;

export function ShopView({
  merchantSlug,
  merchantName,
  openProductId,
  currency,
  tab,
  categoryId,
  categories,
  treatments,
  popularTreatments,
  products,
  isMember,
  pitchPlan,
  plans,
  currentPlanId,
  membershipPending,
  pointsPerCents,
  externalBookingUrl,
}: {
  merchantSlug: string;
  merchantName: string;
  /** An item to open straight away — a notification linking to one. */
  openProductId?: string | null;
  currency: string;
  tab: string;
  categoryId: string | null;
  categories: { id: string; name: string }[];
  treatments: ShopCard[];
  popularTreatments: ShopCard[];
  products: ShopCard[];
  isMember: boolean;
  /** The plan behind "Members save X%", or null for a member. */
  pitchPlan: { id: string; name: string; serviceDiscountPercent: number | null; productDiscountPercent: number | null } | null;
  plans: ShopPlan[];
  currentPlanId: string | null;
  /** Their membership exists but its first payment hasn't been confirmed. */
  membershipPending?: boolean;
  /** Same rate checkout uses: points = floor(amount in cents × rate). */
  pointsPerCents: number;
  /** Set when the clinic books on its own website instead of in the app. */
  externalBookingUrl: string | null;
}) {
  const router = useRouter();
  const base = useBasePath();
  const { refresh } = useCart();
  const { toast } = useToast();

  const [detail, setDetail] = React.useState<ShopCard | null>(null);
  const [qty, setQty] = React.useState(1);
  const [booking, setBooking] = React.useState<BookableService | null>(null);
  const [planDetail, setPlanDetail] = React.useState<ShopPlan | null>(null);
  const [pending, setPending] = React.useState(false);
  /** The first invoice of a membership, waiting to be confirmed by the client. */
  const [firstPayment, setFirstPayment] = React.useState<{
    plan: string;
    amountCents: number;
    payment: { clientSecret: string; publishableKey: string | null; stripeAccountId: string };
  } | null>(null);

  // Treatment filters/sort — client-side over an already-scoped list.
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);
  const [priceBand, setPriceBand] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState<number | null>(null);
  const [sort, setSort] = React.useState("pop");

  const everything = React.useMemo(() => [...treatments, ...products], [treatments, products]);

  // A notification can link to one item. Opening its sheet here means the
  // client lands on the thing they tapped, not on the shop for them to find it
  // again. An item that has since gone just leaves the shop open.
  React.useEffect(() => {
    if (!openProductId) return;
    const item = everything.find((p) => p.id === openProductId);
    if (item) {
      setQty(1);
      setDetail(item);
    }
  }, [openProductId, everything]);

  function go(next: string, cat?: string | null) {
    const sp = new URLSearchParams();
    if (next !== "browse") sp.set("tab", next);
    if (cat) sp.set("category", cat);
    router.push(`${base}/shop${sp.toString() ? `?${sp}` : ""}`);
  }

  const inCategory = React.useCallback((list: ShopCard[]) => (categoryId ? list.filter((c) => c.categoryId === categoryId) : list), [categoryId]);

  const visibleTreatments = React.useMemo(() => {
    let list = inCategory([...treatments]);
    if (priceBand === "u50") list = list.filter((s) => s.viewerPriceCents < 5000);
    if (priceBand === "50-100") list = list.filter((s) => s.viewerPriceCents >= 5000 && s.viewerPriceCents <= 10000);
    if (priceBand === "o100") list = list.filter((s) => s.viewerPriceCents > 10000);
    if (duration) list = list.filter((s) => s.durationMinutes === duration);
    if (sort === "pop") list.sort((a, b) => Number(b.popular) - Number(a.popular));
    if (sort === "pasc") list.sort((a, b) => a.viewerPriceCents - b.viewerPriceCents);
    if (sort === "pdesc") list.sort((a, b) => b.viewerPriceCents - a.viewerPriceCents);
    return list;
  }, [treatments, inCategory, priceBand, duration, sort]);

  const addCard = React.useCallback(
    async (card: ShopCard, quantity = 1) => {
      setPending(true);
      const res = await clientAddToCartAction(merchantSlug, card.kind === "SERVICE" ? "service" : "product", card.id, quantity);
      setPending(false);
      if ("error" in res) {
        toast(res.error);
        return false;
      }
      await refresh();
      toast(`${card.name} added to cart`);
      return true;
    },
    [merchantSlug, refresh, toast],
  );

  /**
   * Joining asks for the first payment. Nothing is a membership until that
   * payment is confirmed by the clinic's Stripe account — so the client
   * confirms it here, and the webhook is what switches the plan on.
   */
  async function joinPlan(id: string) {
    setPending(true);
    const res = await clientJoinPlanAction(merchantSlug, id);
    setPending(false);
    if ("error" in res) {
      toast(res.error);
      return;
    }
    setPlanDetail(null);

    if (res.paid) {
      toast(`Welcome to ${res.name}`);
      router.refresh();
      return;
    }
    if (!res.payment.clientSecret) {
      // Nothing to pay for this plan; Stripe still confirms it by webhook.
      toast("Setting up your membership…");
      router.refresh();
      return;
    }
    setFirstPayment({ plan: res.name, amountCents: res.firstPaymentCents, payment: res.payment });
  }

  const card = (c: ShopCard) => (
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
        isMember={isMember}
        onJoin={() => go("memberships")}
        onOpen={() => {
          setQty(1);
          setDetail(c);
        }}
        onAdd={c.soldOut || pending ? undefined : () => void addCard(c)}
      />
    </div>
  );

  const shelf = (title: string, cards: ShopCard[], seeAll: string) =>
    cards.length === 0 ? null : (
      <section className="v2-sec" key={title}>
        <div className="v2-sechead">
          <h2>{title}</h2>
          <button type="button" onClick={() => go(seeAll, categoryId)}>
            See all <Icon name="chevR" size={18} />
          </button>
        </div>
        <div className="v2-rail no-scrollbar">{cards.map(card)}</div>
      </section>
    );

  const memberRate = pitchPlan ? Math.max(pitchPlan.serviceDiscountPercent ?? 0, pitchPlan.productDiscountPercent ?? 0) : 0;

  return (
    <div className="v2-shop">
      <div className="v2-shopseg">
        {/* A clinic that cannot bill a recurring plan has no memberships to
            show, so the tab goes too rather than leading to an empty shelf. */}
        <SegmentedControl
          label="Shop sections"
          value={tab}
          onChange={(next) => go(next, categoryId)}
          options={SEGMENTS.filter((s) => s.value !== "memberships" || plans.length > 0).map((s) => ({ value: s.value as string, label: s.label }))}
        />
      </div>

      {tab === "browse" && (
        <>
          {categories.length > 0 && (
            <div className="v2-chips no-scrollbar">
              <button type="button" className={categoryId === null ? "on" : undefined} onClick={() => go("browse", null)}>
                All
              </button>
              {categories.map((c) => (
                <button key={c.id} type="button" className={categoryId === c.id ? "on" : undefined} onClick={() => go("browse", categoryId === c.id ? null : c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {!isMember && memberRate > 0 && (
            <button type="button" className="v2-memberstrip" onClick={() => go("memberships")}>
              <span className="ic" aria-hidden="true">
                <Icon name="star" size={20} />
              </span>
              <span className="txt">
                <b>Members save {memberRate}%</b> on everything at {merchantName}
              </span>
              <Icon name="chevR" size={20} />
            </button>
          )}

          {everything.length === 0 ? (
            <div className="v2-sec">
              <div className="v2-empty">
                <EmptyState text="The shop is being stocked" sub="Check back soon — new treatments and products are on their way." />
              </div>
            </div>
          ) : (
            <>
              {shelf("Popular treatments", inCategory(popularTreatments), "treatments")}
              {shelf("Skin care products", inCategory(products), "browse")}
              <p className="v2-vatnote">All prices include VAT.</p>
            </>
          )}
        </>
      )}

      {tab === "memberships" && (
        <div className="v2-plans">
          {plans.length === 0 ? (
            <div className="v2-empty">
              <EmptyState text="No memberships available" sub="Plans will appear here once the clinic publishes them." />
            </div>
          ) : (
            plans.map((pl) => {
              const current = pl.id === currentPlanId;
              return (
                <div key={pl.id} className="v2-plan" data-plan={pl.id}>
                  <div className="top">
                    <h3>{pl.name}</h3>
                    <span className="price">
                      <b className="tabular">{money(pl.priceCents, currency)}</b>
                      <span>per {pl.interval}</span>
                    </span>
                  </div>
                  {pl.description && <p className="blurb">{pl.description}</p>}
                  {pl.benefits.length > 0 && (
                    <ul className="bens">
                      {pl.benefits.map((b, i) => (
                        <li key={i}>
                          <Icon name="check" size={18} /> {b}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="terms">
                    Price includes VAT. Renews automatically every {pl.interval}. Cancel any time in Profile → Membership.
                  </p>
                  {current ? (
                    <span className="v2-tag v2-tag-soft">{membershipPending ? "Waiting for your first payment" : "Current plan"}</span>
                  ) : (
                    <Button disabled={pending || membershipPending} onClick={() => joinPlan(pl.id)}>
                      Join {pl.name}
                    </Button>
                  )}
                </div>
              );
            })
          )}
          {plans.length > 0 && (
            <div className="v2-reassure">
              <span>
                <Icon name="check" size={18} /> Cancel anytime
              </span>
              <span>
                <Icon name="check" size={18} /> Perks start today
              </span>
              <span>
                <Icon name="shield" size={18} /> Pay securely
              </span>
            </div>
          )}
        </div>
      )}

      {tab === "treatments" && (
        <div className="v2-treatments">
          <div className="filters">
            <button type="button" className="v2-btn v2-btn-pill" onClick={() => setFilterOpen(true)}>
              <Icon name="sliders" size={18} /> Filter
            </button>
            <button type="button" className="v2-btn v2-btn-pill" onClick={() => setSortOpen(true)}>
              Sort <Icon name="chevD" size={16} />
            </button>
          </div>

          {visibleTreatments.length === 0 ? (
            <div className="v2-empty">
              <EmptyState text="No treatments found" sub="Try clearing filters, or check back soon." />
            </div>
          ) : (
            <div className="rows">
              {visibleTreatments.map((s) => (
                <ProductCard
                  key={s.id}
                  shape="row"
                  name={s.name}
                  meta={[s.meta, pointsPerCents > 0 ? `+${Math.floor(s.viewerPriceCents * pointsPerCents)} points` : null].filter(Boolean).join(" · ")}
                  imageUrl={s.imageUrl}
                  tags={s.tag && <Tag kind={s.tag.kind}>{s.tag.label}</Tag>}
                  cents={s.viewerPriceCents}
                  currency={currency}
                  wasCents={s.wasCents}
                  memberCents={s.memberPriceCents}
                  isMember={isMember}
                  onJoin={() => go("memberships")}
                  onOpen={() => {
                    setQty(1);
                    setDetail(s);
                  }}
                  onAdd={pending ? undefined : () => void addCard(s)}
                />
              ))}
            </div>
          )}
          <p className="v2-vatnote">All prices include VAT. Results vary per person.</p>
        </div>
      )}

      {/* ---------------------------------------------------------- sheets */}

      <Sheet
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.name}
        cta={
          detail &&
          (detail.soldOut ? (
            <Button disabled>Sold out</Button>
          ) : detail.kind === "SERVICE" && detail.bookable && !externalBookingUrl ? (
            <div className="v2-ctapair">
              <Button
                variant="outline"
                disabled={pending}
                onClick={async () => {
                  if (await addCard(detail, qty)) setDetail(null);
                }}
              >
                Add to cart
              </Button>
              <Button
                onClick={() => {
                  setBooking({ id: detail.id, name: detail.name, priceCents: detail.viewerPriceCents, durationMinutes: detail.durationMinutes ?? 30 });
                  setDetail(null);
                }}
              >
                <Icon name="calendar" size={20} /> Book
              </Button>
            </div>
          ) : (
            <Button
              amount={detail.viewerPriceCents * qty}
              currency={currency}
              loading={pending}
              onClick={async () => {
                if (await addCard(detail, qty)) setDetail(null);
              }}
            >
              Add to cart
            </Button>
          ))
        }
      >
        {detail && (
          <div className="v2-detail">
            {detail.images.length > 0 ? (
              <Carousel images={detail.images} alt={detail.name} />
            ) : (
              <div className="shot" aria-hidden="true">
                <span>{detail.name.charAt(0).toUpperCase()}</span>
              </div>
            )}
            {/* The sheet is the one place the handoff allows two tags. */}
            <div className="tags">
              {detail.offerLabel && <Tag kind="brand">{detail.offerLabel}</Tag>}
              {detail.popular && <Tag kind="photo">Popular</Tag>}
            </div>

            <h2>{detail.name}</h2>
            <div className="priceline">
              <PriceBlock
                cents={detail.viewerPriceCents}
                currency={currency}
                wasCents={detail.wasCents}
                memberCents={detail.memberPriceCents}
                isMember={isMember}
                onJoin={() => {
                  setDetail(null);
                  go("memberships");
                }}
              />
              <span className="facts">
                {[detail.meta, pointsPerCents > 0 ? `+${Math.floor(detail.viewerPriceCents * pointsPerCents)} points` : null].filter(Boolean).join(" · ")}
              </span>
            </div>

            {detail.description && <p className="desc">{detail.description}</p>}
            {detail.kind === "SERVICE" && externalBookingUrl && (
              <p className="desc">After buying, book your time on {merchantName}&rsquo;s booking page.</p>
            )}
            {detail.kind === "SERVICE" && <p className="desc">Results vary per person.</p>}

            <div className="qty">
              <span>Quantity</span>
              <Stepper value={qty} onChange={setQty} />
            </div>
          </div>
        )}
      </Sheet>

      <Sheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filter treatments"
        cta={
          <div className="v2-ctapair">
            <Button
              variant="grey"
              onClick={() => {
                setPriceBand(null);
                setDuration(null);
              }}
            >
              Reset
            </Button>
            <Button onClick={() => setFilterOpen(false)}>Apply</Button>
          </div>
        }
      >
        <div className="grouplab">Price</div>
        <div className="chipsel">
          {(
            [
              ["u50", "Under €50"],
              ["50-100", "€50–€100"],
              ["o100", "Over €100"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`schip ${priceBand === k ? "on" : ""}`} onClick={() => setPriceBand(priceBand === k ? null : k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="grouplab">Duration</div>
        <div className="chipsel">
          {[30, 45, 60].map((d) => (
            <button key={d} className={`schip ${duration === d ? "on" : ""}`} onClick={() => setDuration(duration === d ? null : d)}>
              {d} min
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort treatments">
        {(
          [
            ["pop", "Popularity"],
            ["pasc", "Price: low → high"],
            ["pdesc", "Price: high → low"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`optrow ${sort === k ? "on" : ""}`}
            onClick={() => {
              setSort(k);
              setSortOpen(false);
            }}
          >
            <span className="rad" />
            {label}
          </button>
        ))}
      </Sheet>

      <BookingSheet
        merchantSlug={merchantSlug}
        currency={currency}
        service={booking}
        onClose={() => setBooking(null)}
        onBooked={() => {
          setBooking(null);
          toast("Booking requested");
          router.refresh();
        }}
      />

      <Sheet
        open={!!planDetail}
        onClose={() => setPlanDetail(null)}
        title={planDetail?.name}
        cta={
          planDetail && (
            <Button disabled={pending} onClick={() => joinPlan(planDetail.id)}>
              Join {planDetail.name}
            </Button>
          )
        }
      >
        {planDetail && (
          <ul className="bens">
            {planDetail.benefits.map((b, i) => (
              <li key={i}>
                <Icon name="check" size={18} /> {b}
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      {/* The first payment. Until it goes through there is no membership, so
          this sheet is the whole of joining rather than a formality after it. */}
      <Sheet open={!!firstPayment} onClose={() => setFirstPayment(null)} title={firstPayment ? `Start ${firstPayment.plan}` : ""}>
        {firstPayment && (
          <>
            <p style={{ fontSize: 14, color: "var(--text-2)", paddingBottom: 4 }}>
              {money(firstPayment.amountCents, currency)} now, then the same each period. Cancel any time from your profile.
            </p>
            <CardPayment
              payment={firstPayment.payment}
              orderNumber={{ membership: true }}
              amountCents={firstPayment.amountCents}
              currency={currency}
              payLabel={`Pay ${money(firstPayment.amountCents, currency)} and start`}
              onPaid={() => {
                setFirstPayment(null);
                // The clinic's Stripe account confirms it; the plan switches on
                // when that lands, which is usually a second or two.
                toast("Payment sent — your membership starts in a moment");
                router.refresh();
              }}
              onCancel={() => setFirstPayment(null)}
            />
          </>
        )}
      </Sheet>
    </div>
  );
}
