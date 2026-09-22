"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sheet, Stepper, EmptyState, Icon, money, useToast, Gloss, CountUp } from "@/components/client-app/ui";
import {
  clientSetCartQtyAction,
  clientCheckoutAction,
  clientRedeemableRewardsAction,
  clientOrderStatusAction,
  clientAbandonOrderAction,
} from "@/lib/actions/client-app";
import { useCart, type CartLine } from "./cart-context";
import { CardPayment, type PaymentHandoff } from "./card-payment";

interface Reward {
  id: string;
  name: string;
  pointsCost: number;
  discountAmountCents: number | null;
  discountPercent: number | null;
}

type Stage = "cart" | "pay" | "card" | "done";

export function CartSheet({
  merchantSlug,
  currency,
  open,
  onClose,
}: {
  merchantSlug: string;
  currency: string;
  open: boolean;
  onClose: () => void;
}) {
  const { items, refresh } = useCart();
  const { toast } = useToast();
  const router = useRouter();

  const [stage, setStage] = React.useState<Stage>("cart");
  const [rewards, setRewards] = React.useState<Reward[]>([]);
  const [rewardId, setRewardId] = React.useState<string | null>(null);
  const [pickingReward, setPickingReward] = React.useState(false);
  const [method, setMethod] = React.useState<"card" | "later">("card");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ orderNumber: string; pointsEarned: number } | null>(null);
  /** Set when the clinic takes real cards: the client confirms in the Payment Element. */
  const [handoff, setHandoff] = React.useState<{ payment: PaymentHandoff; orderNumber: string; totalCents: number } | null>(null);
  const [settling, setSettling] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStage("cart");
    setError(null);
    setRewardId(null);
    setResult(null);
    setHandoff(null);
    void refresh();
    clientRedeemableRewardsAction().then(setRewards).catch(() => setRewards([]));
  }, [open, refresh]);

  const subtotal = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const reward = rewards.find((r) => r.id === rewardId) ?? null;
  const discount = reward
    ? reward.discountAmountCents != null
      ? Math.min(reward.discountAmountCents, subtotal)
      : Math.round((subtotal * (reward.discountPercent ?? 0)) / 100)
    : 0;
  const total = Math.max(0, subtotal - discount);

  async function setQty(id: string, qty: number) {
    const res = await clientSetCartQtyAction(merchantSlug, id, qty);
    if ("error" in res) setError(res.error);
    await refresh();
  }

  async function pay() {
    setPending(true);
    setError(null);
    const res = await clientCheckoutAction(merchantSlug, rewardId);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    if (!res.paid) {
      // The clinic takes real cards: collect them, then let the webhook settle.
      setHandoff({ payment: res.payment, orderNumber: res.orderNumber, totalCents: res.totalCents });
      setStage("card");
      return;
    }
    setResult({ orderNumber: res.orderNumber, pointsEarned: res.pointsEarned });
    setStage("done");
    await refresh();
    router.refresh();
  }

  /**
   * Stripe says the payment went through; our order is settled by the webhook,
   * which usually lands within a second. Ask a few times before saying it is
   * still processing — never claim an outcome the server hasn't confirmed.
   */
  async function afterCardPayment() {
    if (!handoff) return;
    setSettling(true);
    let pointsEarned = 0;
    let settled = false;
    for (let attempt = 0; attempt < 6 && !settled; attempt++) {
      const status = await clientOrderStatusAction(merchantSlug, handoff.orderNumber).catch(() => null);
      if (status && "ok" in status) {
        if (status.status === "PAID") {
          pointsEarned = status.pointsEarned;
          settled = true;
          break;
        }
        if (status.status === "FAILED") {
          setSettling(false);
          setStage("pay");
          setError("That payment didn't go through. Please try another method.");
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    setSettling(false);
    setResult({ orderNumber: handoff.orderNumber, pointsEarned });
    setStage("done");
    setHandoff(null);
    await refresh();
    router.refresh();
    if (!settled) toast("Payment received. Your order is being confirmed.");
  }

  async function cancelCardPayment() {
    if (handoff) await clientAbandonOrderAction(merchantSlug, handoff.orderNumber).catch(() => undefined);
    setHandoff(null);
    setStage("cart");
    await refresh();
  }

  const title = stage === "done" ? "Order confirmed" : stage === "card" ? "Payment" : stage === "pay" ? "Checkout" : "Your cart";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      cta={
        stage === "done" ? (
          <button className="btn-black" onClick={onClose}>
            Done
          </button>
        ) : stage === "card" ? undefined : items.length === 0 ? undefined : stage === "pay" ? (
          <button className="btn-black" disabled={pending} onClick={pay}>
            {pending ? "Processing…" : `Pay ${money(total, currency)}`}
          </button>
        ) : (
          <button className="btn-black" onClick={() => setStage("pay")}>
            Checkout · {money(total, currency)}
          </button>
        )
      }
    >
      {stage === "card" && handoff ? (
        settling ? (
          <p style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)", fontSize: 15 }}>Confirming your payment…</p>
        ) : (
          <CardPayment
            payment={handoff.payment}
            amountCents={handoff.totalCents}
            currency={currency}
            onPaid={afterCardPayment}
            onCancel={cancelCardPayment}
          />
        )
      ) : stage === "done" && result ? (
        <div style={{ textAlign: "center", paddingTop: 8 }}>
          <span className="okring" style={{ margin: "0 auto 10px" }}>
            <Icon name="check" size={40} width={2.4} />
          </span>
          <p style={{ fontSize: 16 }}>Order {result.orderNumber} is confirmed.</p>
          {result.pointsEarned > 0 && (
            <Gloss className="ptsCard">
              <span style={{ fontSize: 32, fontWeight: 700, color: "var(--on-black)" }}>
                +<CountUp to={result.pointsEarned} />
              </span>
              <span style={{ fontSize: 14, color: "var(--on-black-muted)" }}>points earned</span>
            </Gloss>
          )}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          text="Your cart is empty"
          sub="Add something from the shop to get started."
          cta={
            <button
              className="btn-black"
              onClick={() => {
                onClose();
                router.push(`/app/${merchantSlug}/shop`);
              }}
            >
              Browse the shop
            </button>
          }
        />
      ) : (
        <>
          {items.map((l) => (
            <CartRow key={l.id} line={l} currency={currency} editable={stage === "cart"} onQty={setQty} />
          ))}

          <div className="optrow">
            <span>Subtotal</span>
            <span style={{ flex: 1 }} />
            <b className="tabular">{money(subtotal, currency)}</b>
          </div>

          {reward ? (
            <div className="optrow">
              <span>{reward.name}</span>
              <span style={{ flex: 1 }} />
              <b className="tabular">−{money(discount, currency)}</b>
              <button aria-label="Remove reward" onClick={() => setRewardId(null)} style={{ color: "var(--muted)" }}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : (
            stage === "cart" &&
            rewards.length > 0 && (
              <button className="optrow" onClick={() => setPickingReward(true)}>
                <span>Apply reward</span>
                <span style={{ flex: 1 }} />
                <Icon name="chevR" size={18} />
              </button>
            )
          )}

          {stage === "pay" && (
            <>
              <div className="grouplab">Payment</div>
              <button className={`optrow ${method === "card" ? "on" : ""}`} onClick={() => setMethod("card")}>
                <span className="rad" />
                <Icon name="card" size={20} /> Card on file
              </button>
              <button className={`optrow ${method === "later" ? "on" : ""}`} onClick={() => setMethod("later")}>
                <span className="rad" />
                <span className="klarna" style={{ width: 32, height: 32, borderRadius: 8, fontSize: 10 }}>
                  Klarna.
                </span>
                Pay later in 3 instalments
              </button>
            </>
          )}

          <div className="optrow" style={{ border: 0 }}>
            <span style={{ fontWeight: 600 }}>Total</span>
            <span style={{ flex: 1 }} />
            <b className="tabular" style={{ fontSize: 20 }}>
              {money(total, currency)}
            </b>
          </div>

          {error && <p style={{ color: "var(--danger)", fontSize: 14 }}>{error}</p>}

          <Sheet
            open={pickingReward}
            onClose={() => setPickingReward(false)}
            title="Apply a reward"
          >
            {rewards.map((r) => (
              <button
                key={r.id}
                className="optrow"
                onClick={() => {
                  setRewardId(r.id);
                  setPickingReward(false);
                  toast(`${r.name} applied`);
                }}
              >
                <span className="rad" />
                <span style={{ flex: 1 }}>
                  {r.name}
                  <br />
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>{r.pointsCost} points</span>
                </span>
                <b>
                  −
                  {r.discountAmountCents != null
                    ? money(r.discountAmountCents, currency)
                    : `${r.discountPercent}%`}
                </b>
              </button>
            ))}
          </Sheet>
        </>
      )}
    </Sheet>
  );
}

/** Swipe left to reveal remove; releasing past the threshold deletes the line. */
function CartRow({
  line,
  currency,
  editable,
  onQty,
}: {
  line: CartLine;
  currency: string;
  editable: boolean;
  onQty: (id: string, qty: number) => Promise<void>;
}) {
  const [dx, setDx] = React.useState(0);
  const startX = React.useRef<number | null>(null);

  return (
    <div className="crow">
      <div className="delbg">Remove</div>
      <div
        className="cin"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: startX.current !== null ? "none" : undefined }}
        onPointerDown={(e) => {
          if (!editable) return;
          startX.current = e.clientX;
        }}
        onPointerMove={(e) => {
          if (startX.current === null) return;
          setDx(Math.min(0, Math.max(-140, e.clientX - startX.current)));
        }}
        onPointerUp={() => {
          if (dx < -90) void onQty(line.id, 0);
          setDx(0);
          startX.current = null;
        }}
      >
        {line.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={line.imageUrl} alt="" width={52} height={52} style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", flex: "none" }} />
        ) : (
          <span style={{ width: 52, height: 52, borderRadius: 12, background: "var(--pill-bg)", flex: "none" }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 15, display: "block" }}>{line.name}</b>
          <span className="tabular" style={{ fontSize: 13, color: "var(--muted)" }}>
            {money(line.unitPriceCents, currency)}
          </span>
        </div>
        {editable ? (
          <Stepper value={line.quantity} min={0} onChange={(q) => void onQty(line.id, q)} />
        ) : (
          <span className="tabular" style={{ color: "var(--muted)" }}>×{line.quantity}</span>
        )}
      </div>
    </div>
  );
}
