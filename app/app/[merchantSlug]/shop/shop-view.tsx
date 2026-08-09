"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GlossSurface } from "@/components/client-app/gloss-surface";
import {
  BlackButton,
  BottomSheet,
  ClientCard,
  ClientEmptyState,
  QuantityStepper,
  SegmentedTabs,
  StatusPill,
} from "@/components/client-app/primitives";
import { formatMoney } from "@/lib/utils";
import { addProductToBasketAction, addServiceToBasketAction } from "@/lib/actions/basket";
import { joinMembershipAction } from "@/lib/actions/memberships";
import { useCart } from "../cart-context";
import { CartSheet } from "./cart-sheet";

export interface ShopProduct {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  soldOut: boolean;
}
export interface ShopService {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMinutes: number;
  imageUrl: string | null;
}
export interface ShopPlan {
  id: string;
  name: string;
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
  activeCategoryId,
  activeCategoryName,
  currentPlanName,
  categories,
  products,
  services,
  plans,
}: {
  merchantSlug: string;
  currency: string;
  tab: string;
  activeCategoryId: string | null;
  activeCategoryName: string | null;
  currentPlanName: string | null;
  categories: { id: string; name: string }[];
  products: ShopProduct[];
  services: ShopService[];
  plans: ShopPlan[];
}) {
  const router = useRouter();
  const { refresh } = useCart();
  const [selected, setSelected] = React.useState<ShopProduct | null>(null);
  const [howOpen, setHowOpen] = React.useState(false);
  const money = (c: number) => formatMoney(c, currency);

  function setTab(next: string) {
    router.push(`/app/${merchantSlug}/shop${next === "browse" ? "" : `?tab=${next}`}`);
  }
  function setCategory(id: string | null) {
    const sp = new URLSearchParams();
    if (id) sp.set("category", id);
    router.push(`/app/${merchantSlug}/shop${sp.toString() ? `?${sp}` : ""}`);
  }

  return (
    <div>
      <SegmentedTabs segments={SEGMENTS} active={tab} onSelect={setTab} />

      {tab === "browse" && (
        <div className="space-y-6 px-[var(--space-screen-x)] pt-5">
          {/* Hero banner */}
          <GlossSurface particles className="flex min-h-[200px] flex-col items-center justify-center px-6 py-8 text-center">
            <p className="text-[27px] font-bold leading-tight text-[var(--on-black)]">
              Treat today. Pay later.
              <br />
              Earn rewards.
            </p>
            <p className="mt-2 text-[16px] text-[var(--on-black-muted)]">Free treatments exclusive perks.</p>
            <BlackButton variant="white" className="mt-5 px-6" onClick={() => setHowOpen(true)}>
              How does it work?
            </BlackButton>
          </GlossSurface>

          {/* Categories */}
          {categories.length > 0 && (
            <div className={`no-scrollbar -mx-[var(--space-screen-x)] flex gap-3 overflow-x-auto px-[var(--space-screen-x)] ${categories.length === 1 ? "justify-center" : ""}`}>
              {categories.map((c) => {
                const active = c.id === activeCategoryId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(active ? null : c.id)}
                    className={`press flex h-[140px] w-[140px] shrink-0 flex-col items-center justify-center gap-2 rounded-[var(--radius-tile)] border-2 border-[var(--black)] ${
                      active ? "bg-[var(--black)] text-[var(--on-black)]" : "bg-[var(--bg-surface)] text-[var(--ink)]"
                    }`}
                  >
                    <TagGlyph />
                    <span className="px-2 text-center text-[15px] font-medium">{c.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          <section>
            <h2 className="text-[27px] font-bold leading-tight text-[var(--ink-strong)]">
              {activeCategoryName ? `All "${activeCategoryName}" Treatments` : "All Treatments"}
            </h2>

            {products.length === 0 ? (
              <ClientCard className="mt-4">
                <ClientEmptyState text="No products available yet" />
              </ClientCard>
            ) : (
              <div className={`mt-4 grid gap-4 ${products.length === 1 ? "grid-cols-1 px-[15%]" : "grid-cols-2"}`}>
                {products.map((p) => (
                  <button key={p.id} type="button" onClick={() => setSelected(p)} className="press text-left">
                    <ClientCard className="overflow-hidden">
                      <div className={`relative aspect-[4/5] bg-[var(--pill-bg)] ${p.soldOut ? "opacity-55" : ""}`}>
                        {p.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                        )}
                        {p.soldOut && (
                          <span className="absolute left-2 top-2">
                            <StatusPill>Sold out</StatusPill>
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="text-[16px] text-[var(--ink)]">{p.name}</p>
                        <p className="tabular mt-1 text-[18px] font-bold text-[var(--ink-strong)]">{money(p.priceCents)}</p>
                      </div>
                    </ClientCard>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "memberships" && (
        <div className="space-y-4 px-[var(--space-screen-x)] pt-5">
          {plans.length === 0 ? (
            <ClientCard>
              <ClientEmptyState text="No memberships available yet" />
            </ClientCard>
          ) : (
            plans.map((m) => {
              const isCurrent = m.name === currentPlanName;
              return (
                <ClientCard key={m.id} className="p-[var(--space-card-pad)]">
                  <p className="text-[23px] font-bold text-[var(--ink-strong)]">{m.name}</p>
                  <p className="tabular mt-1 text-[23px] font-bold text-[var(--ink-strong)]">
                    {money(m.priceCents)}
                    <span className="text-[16px] font-normal text-[var(--muted)]">/{m.interval}</span>
                  </p>
                  {m.benefits.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {m.benefits.map((b, i) => (
                        <li key={i} className="flex items-start gap-2 text-[16px] text-[var(--ink)]">
                          <CheckGlyph /> {b}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-4">
                    {isCurrent ? (
                      <StatusPill tone="active">Current plan</StatusPill>
                    ) : (
                      <BlackButton
                        className="px-8"
                        onClick={async () => {
                          await joinMembershipAction(merchantSlug, m.id);
                          refresh();
                        }}
                      >
                        Join
                      </BlackButton>
                    )}
                  </div>
                </ClientCard>
              );
            })
          )}
        </div>
      )}

      {tab === "treatments" && (
        <div className="space-y-4 px-[var(--space-screen-x)] pt-5">
          {services.length === 0 ? (
            <ClientCard>
              <ClientEmptyState text="No treatments available yet" />
            </ClientCard>
          ) : (
            services.map((s) => (
              <ClientCard key={s.id} className="flex items-center gap-4 p-4">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius-tile)] bg-[var(--pill-bg)]">
                  {s.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-[var(--ink)]">{s.name}</p>
                  <p className="text-[16px] text-[var(--muted)]">
                    {s.durationMinutes} min · {money(s.priceCents)}
                  </p>
                </div>
                <BlackButton
                  className="h-11 shrink-0 px-5 text-[15px]"
                  onClick={async () => {
                    await addServiceToBasketAction(merchantSlug, s.id);
                    refresh();
                  }}
                >
                  Book
                </BlackButton>
              </ClientCard>
            ))
          )}
        </div>
      )}

      <ProductSheet
        product={selected}
        currency={currency}
        onClose={() => setSelected(null)}
        onAdd={async (qty) => {
          if (!selected) return;
          await addProductToBasketAction(merchantSlug, selected.id, qty);
          refresh();
          setSelected(null);
        }}
      />

      <BottomSheet open={howOpen} onClose={() => setHowOpen(false)} title="How does it work?">
        <ol className="space-y-3 text-[16px] text-[var(--ink)]">
          <li>1. Browse treatments and products from this clinic.</li>
          <li>2. Pay now, or spread the cost over monthly payments.</li>
          <li>3. Earn points on everything you spend and redeem them for rewards.</li>
        </ol>
      </BottomSheet>

      <CartSheet merchantSlug={merchantSlug} currency={currency} />
    </div>
  );
}

function ProductSheet({
  product,
  currency,
  onClose,
  onAdd,
}: {
  product: ShopProduct | null;
  currency: string;
  onClose: () => void;
  onAdd: (qty: number) => Promise<void>;
}) {
  const [qty, setQty] = React.useState(1);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (product) setQty(1);
  }, [product]);

  return (
    <BottomSheet
      open={!!product}
      onClose={onClose}
      title={product?.name}
      footer={
        <BlackButton
          className="w-full"
          loading={pending}
          disabled={product?.soldOut}
          onClick={async () => {
            setPending(true);
            try {
              await onAdd(qty);
            } finally {
              setPending(false);
            }
          }}
        >
          {product?.soldOut ? "Sold out" : "Add to cart"}
        </BlackButton>
      }
    >
      {product && (
        <>
          <div className="aspect-[4/3] overflow-hidden rounded-[var(--radius-tile)] bg-[var(--pill-bg)]">
            {product.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <p className="tabular mt-4 text-[23px] font-bold text-[var(--ink-strong)]">{formatMoney(product.priceCents, currency)}</p>
          {product.description && <p className="mt-2 text-[16px] text-[var(--muted)]">{product.description}</p>}
          <div className="mt-4 flex items-center justify-between">
            <QuantityStepper value={qty} onChange={setQty} />
            <span className="text-[16px] text-[var(--muted)]">
              Earn {Math.floor((product.priceCents * qty) / 100)} points
            </span>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function TagGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-1 shrink-0">
      <path d="m4 9.5 3.2 3L14 6" />
    </svg>
  );
}
