"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Gloss, Sheet, Icon, Stepper, Carousel, EmptyState, money, useToast } from "@/components/client-app/ui";
import { clientAddToCartAction, clientJoinPlanAction } from "@/lib/actions/client-app";
import { useCart } from "../cart-context";
import { BookingSheet } from "./booking-sheet";

export interface ShopProduct {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  images: string[];
  soldOut: boolean;
  categoryId: string | null;
}
export interface ShopService {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMinutes: number;
  images: string[];
  bookable: boolean;
  categoryName: string;
}
export interface ShopPlan {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  interval: string;
  benefits: string[];
}

const SEGMENTS = [
  { key: "browse", label: "Browse" },
  { key: "memberships", label: "Memberships" },
  { key: "treatments", label: "Treatments" },
];

export function ShopView({
  merchantSlug,
  currency,
  tab,
  categoryId,
  categories,
  products,
  services,
  plans,
  currentPlanId,
  pointsPerEuro,
}: {
  merchantSlug: string;
  currency: string;
  tab: string;
  categoryId: string | null;
  categories: { id: string; name: string }[];
  products: ShopProduct[];
  services: ShopService[];
  plans: ShopPlan[];
  currentPlanId: string | null;
  pointsPerEuro: number;
}) {
  const router = useRouter();
  const { refresh } = useCart();
  const { toast } = useToast();
  const segRef = React.useRef<HTMLDivElement>(null);

  const [detail, setDetail] = React.useState<{ kind: "product"; item: ShopProduct } | { kind: "service"; item: ShopService } | null>(null);
  const [qty, setQty] = React.useState(1);
  const [howOpen, setHowOpen] = React.useState(false);
  const [booking, setBooking] = React.useState<ShopService | null>(null);
  const [planDetail, setPlanDetail] = React.useState<ShopPlan | null>(null);
  const [pending, setPending] = React.useState(false);

  // Treatment filters/sort — client-side over an already-scoped list.
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);
  const [priceBand, setPriceBand] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState<number | null>(null);
  const [sort, setSort] = React.useState("pop");

  const [indicator, setIndicator] = React.useState<{ left: number; width: number }>({ left: 0, width: 0 });
  React.useLayoutEffect(() => {
    const active = segRef.current?.querySelector<HTMLButtonElement>("button.on");
    if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
  }, [tab]);

  function go(next: string, cat?: string | null) {
    const sp = new URLSearchParams();
    if (next !== "browse") sp.set("tab", next);
    if (cat) sp.set("category", cat);
    router.push(`/app/${merchantSlug}/shop${sp.toString() ? `?${sp}` : ""}`);
  }

  const visibleTreatments = React.useMemo(() => {
    let list = [...services];
    if (priceBand === "u50") list = list.filter((s) => s.priceCents < 5000);
    if (priceBand === "50-100") list = list.filter((s) => s.priceCents >= 5000 && s.priceCents <= 10000);
    if (priceBand === "o100") list = list.filter((s) => s.priceCents > 10000);
    if (duration) list = list.filter((s) => s.durationMinutes === duration);
    if (sort === "pasc") list.sort((a, b) => a.priceCents - b.priceCents);
    if (sort === "pdesc") list.sort((a, b) => b.priceCents - a.priceCents);
    return list;
  }, [services, priceBand, duration, sort]);

  const activeCategory = categories.find((c) => c.id === categoryId) ?? null;

  async function addToCart() {
    if (!detail) return;
    setPending(true);
    const res = await clientAddToCartAction(merchantSlug, detail.kind, detail.item.id, detail.kind === "product" ? qty : 1);
    setPending(false);
    if ("error" in res) {
      toast(res.error);
      return;
    }
    await refresh();
    setDetail(null);
    toast("Added to cart");
  }

  async function joinPlan(id: string) {
    setPending(true);
    const res = await clientJoinPlanAction(merchantSlug, id);
    setPending(false);
    if ("error" in res) {
      toast(res.error);
      return;
    }
    setPlanDetail(null);
    toast(`Welcome to ${res.name}`);
    router.refresh();
  }

  return (
    <div>
      <div className="seg" ref={segRef}>
        {SEGMENTS.map((s) => (
          <button key={s.key} className={tab === s.key ? "on" : undefined} onClick={() => go(s.key, categoryId)}>
            {s.label}
          </button>
        ))}
        <i className="ind" style={{ left: indicator.left, width: indicator.width }} />
      </div>

      <div style={{ padding: "var(--gap) var(--pad-x) 0", display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
        {tab === "browse" && (
          <>
            <Gloss className="banner" particles seed={merchantSlug}>
              <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--on-black)" }}>
                Treat today. Pay later.
                <br />
                Earn rewards.
              </h2>
              <p style={{ fontSize: 15, color: "var(--on-black-muted)" }}>Free treatments &amp; exclusive perks.</p>
              <button className="btn-white" style={{ marginTop: 8 }} onClick={() => setHowOpen(true)}>
                How does it work?
              </button>
            </Gloss>

            {categories.length > 0 && (
              <div className={`catrow no-scrollbar ${categories.length === 1 ? "single" : ""}`}>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    className={`cattile ${categoryId === c.id ? "on" : ""}`}
                    onClick={() => go("browse", categoryId === c.id ? null : c.id)}
                  >
                    <Icon name="tag" size={28} />
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            <div>
              <h2 className="h-sec">{activeCategory ? `All “${activeCategory.name}”` : "All products"}</h2>
            </div>

            {products.length === 0 ? (
              <div className="ca-card">
                <EmptyState text="The shop is being stocked" sub="Check back soon — new products are on their way." />
              </div>
            ) : (
              <div className={`pgrid ${products.length === 1 ? "single" : ""}`}>
                {products.map((p) => (
                  <button
                    key={p.id}
                    className={`pcard ${p.soldOut ? "sold" : ""}`}
                    onClick={() => {
                      setQty(1);
                      setDetail({ kind: "product", item: p });
                    }}
                  >
                    <span style={{ position: "relative", display: "block" }}>
                      {p.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.images[0]} alt={p.name} loading="lazy" />
                      ) : (
                        <span style={{ display: "block", aspectRatio: "4/5", background: "var(--pill-bg)" }} />
                      )}
                      {p.soldOut && <span className="soldpill">SOLD OUT</span>}
                    </span>
                    <span style={{ display: "block", fontSize: 15, color: "var(--ink)", padding: "8px 12px 2px" }}>{p.name}</span>
                    <span className="tabular" style={{ display: "block", fontSize: 17, fontWeight: 700, color: "var(--ink-strong)", padding: "0 12px 12px" }}>
                      {money(p.priceCents, currency)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "memberships" &&
          (plans.length === 0 ? (
            <div className="ca-card">
              <EmptyState text="No memberships available" sub="Plans will appear here once the clinic publishes them." />
            </div>
          ) : (
            plans.map((pl) => {
              const current = pl.id === currentPlanId;
              return (
                <div key={pl.id} className="ca-card plancard">
                  <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <h3 style={{ fontSize: 20, fontWeight: 700 }}>{pl.name}</h3>
                    <span style={{ flex: 1 }} />
                    <span className="tabular" style={{ fontSize: 24, fontWeight: 700, color: "var(--ink-strong)" }}>
                      {money(pl.priceCents, currency)}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: 15 }}>/{pl.interval}</span>
                  </span>
                  {pl.benefits.length > 0 && (
                    <div className="bens">
                      {pl.benefits.map((b, i) => (
                        <div key={i}>
                          <Icon name="check" size={18} /> {b}
                        </div>
                      ))}
                    </div>
                  )}
                  {current ? (
                    <span className="status-pill dark" style={{ alignSelf: "flex-start" }}>
                      Current plan
                    </span>
                  ) : (
                    <button className="btn-black" disabled={pending} onClick={() => joinPlan(pl.id)}>
                      Join
                    </button>
                  )}
                </div>
              );
            })
          ))}

        {tab === "treatments" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <button className="chip" onClick={() => setFilterOpen(true)}>
                <Icon name="sliders" size={18} /> Filter
              </button>
              <button className="chip" onClick={() => setSortOpen(true)}>
                Sort <Icon name="chevD" size={16} />
              </button>
            </div>

            {visibleTreatments.length === 0 ? (
              <div className="ca-card">
                <EmptyState text="No treatments found" sub="Try clearing filters, or check back soon." />
              </div>
            ) : (
              visibleTreatments.map((s) => (
                <button key={s.id} className="treatcard" onClick={() => setDetail({ kind: "service", item: s })}>
                  {s.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.images[0]} alt={s.name} loading="lazy" />
                  ) : (
                    <Gloss style={{ height: 190 }} />
                  )}
                  <span style={{ display: "flex", flexDirection: "column", gap: 9, alignItems: "flex-start", padding: 20 }}>
                    <span className="status-pill">Session</span>
                    <h3 style={{ fontSize: 20, fontWeight: 700, color: "var(--ink-strong)" }}>{s.name}</h3>
                    {s.description && <p style={{ fontSize: 15, color: "var(--muted)" }}>{s.description}</p>}
                    <span className="outline-chip">{s.categoryName}</span>
                    <span className="tabular" style={{ color: "var(--muted)", fontSize: 16 }}>
                      From {money(s.priceCents, currency)} · {s.durationMinutes} min
                    </span>
                  </span>
                </button>
              ))
            )}
          </>
        )}
      </div>

      {/* ---------------------------------------------------------- sheets */}

      <Sheet
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.item.name}
        cta={
          detail?.kind === "product" ? (
            <button className="btn-black" disabled={pending || detail.item.soldOut} onClick={addToCart}>
              {detail.item.soldOut ? "Sold out" : "Add to cart"}
            </button>
          ) : detail?.kind === "service" ? (
            detail.item.bookable ? (
              <button
                className="btn-black"
                onClick={() => {
                  setBooking(detail.item);
                  setDetail(null);
                }}
              >
                <Icon name="calendar" size={20} /> Book now
              </button>
            ) : (
              <button className="btn-black" disabled={pending} onClick={addToCart}>
                Add to cart
              </button>
            )
          ) : undefined
        }
      >
        {detail && (
          <>
            {detail.item.images.length > 0 && <Carousel images={detail.item.images} alt={detail.item.name} />}
            <div className="dsec" style={{ paddingBottom: 4 }}>
              <span style={{ fontSize: 21, fontWeight: 700, color: "var(--ink-strong)" }}>{detail.item.name}</span>
              <span className="tabular" style={{ fontSize: 17, fontWeight: 700 }}>
                {money(detail.item.priceCents, currency)}
              </span>
            </div>
            {detail.item.description && (
              <p style={{ color: "var(--muted)", fontSize: 15, paddingBottom: 6 }}>{detail.item.description}</p>
            )}
            {detail.kind === "product" ? (
              <div className="dsec">
                <span style={{ color: "var(--muted)", fontSize: 15 }}>Quantity</span>
                <Stepper value={qty} onChange={setQty} />
              </div>
            ) : (
              <div className="dsec">
                <span className="outline-chip">{detail.item.categoryName}</span>
                <span style={{ color: "var(--muted)", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="clock" size={15} /> {detail.item.durationMinutes} min
                </span>
              </div>
            )}
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              Earn {Math.floor(((detail.item.priceCents * (detail.kind === "product" ? qty : 1)) / 100) * pointsPerEuro)} points with this purchase
            </p>
          </>
        )}
      </Sheet>

      <Sheet
        open={howOpen}
        onClose={() => setHowOpen(false)}
        title="How does it work?"
        cta={
          <button
            className="btn-black"
            onClick={() => {
              setHowOpen(false);
              go("browse", categoryId);
            }}
          >
            Browse the shop
          </button>
        }
      >
        <ol style={{ fontSize: 16, display: "flex", flexDirection: "column", gap: 12, paddingLeft: 0, listStyle: "none" }}>
          <li>1. Browse treatments and products from this clinic.</li>
          <li>2. Pay now, or spread the cost over monthly payments.</li>
          <li>3. Earn points on everything you spend and redeem them for rewards.</li>
        </ol>
      </Sheet>

      <Sheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filter treatments"
        cta={
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn-ghost"
              style={{ flex: 1 }}
              onClick={() => {
                setPriceBand(null);
                setDuration(null);
              }}
            >
              Reset
            </button>
            <button className="btn-black" style={{ flex: 2 }} onClick={() => setFilterOpen(false)}>
              Apply
            </button>
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
            <button className="btn-black" disabled={pending} onClick={() => joinPlan(planDetail.id)}>
              Join {planDetail.name}
            </button>
          )
        }
      >
        {planDetail && (
          <div className="bens">
            {planDetail.benefits.map((b, i) => (
              <div key={i}>
                <Icon name="check" size={18} /> {b}
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
