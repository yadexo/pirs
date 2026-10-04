"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useBasePath } from "./base-path";
import { Sheet, Stepper, EmptyState, Icon, money, useToast } from "@/components/client-app/ui";
import {
  clientSetCartQtyAction,
  clientCheckoutAction,
  clientRedeemableRewardsAction,
  clientAbandonOrderAction,
  clientCartExtrasAction,
} from "@/lib/actions/client-app";
import { useCart, type CartLine } from "./cart-context";
import { cartTotals } from "@/lib/cart-totals";
import { CardPayment, type PaymentHandoff } from "./card-payment";
import { PaymentResult } from "./payment-result";

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
  const base = useBasePath();

  const [stage, setStage] = React.useState<Stage>("cart");
  const [rewards, setRewards] = React.useState<Reward[]>([]);
  const [rewardId, setRewardId] = React.useState<string | null>(null);
  const [pickingReward, setPickingReward] = React.useState(false);
  const [method, setMethod] = React.useState<"card" | "later">("card");
  /** The client's spendable credit, and whether this order should use it. */
  const [credit, setCredit] = React.useState(0);
  const [useCredit, setUseCredit] = React.useState(true);
  /** What the server says this basket is discounted by, if anything. */
  const [autoDiscount, setAutoDiscount] = React.useState<{ title: string; source: string; discountCents: number } | null>(null);
  const [memberNote, setMemberNote] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ orderNumber: string; pointsEarned: number } | null>(null);
  /** Set when the clinic takes real cards: the client confirms in the Payment Element. */
  const [handoff, setHandoff] = React.useState<{ payment: PaymentHandoff; orderNumber: string; totalCents: number } | null>(null);

  /**
   * The discount depends on what is in the basket, so this is re-read after
   * every change to it rather than once when the sheet opens — a client who
   * adds the treatment their plan covers should see the price change.
   */
  const loadExtras = React.useCallback(async () => {
    try {
      const extras = await clientCartExtrasAction();
      setCredit(extras.creditCents);
      setAutoDiscount(extras.discount);
      setMemberNote(extras.memberDiscountNotApplicable);
    } catch {
      setCredit(0);
      setAutoDiscount(null);
      setMemberNote(null);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setStage("cart");
    setError(null);
    setRewardId(null);
    setResult(null);
    setHandoff(null);
    setUseCredit(true);
    void refresh();
    clientRedeemableRewardsAction().then(setRewards).catch(() => setRewards([]));
    void loadExtras();
  }, [open, refresh, loadExtras]);

  const subtotal = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const reward = rewards.find((r) => r.id === rewardId) ?? null;
  const discount = reward
    ? reward.discountAmountCents != null
      ? Math.min(reward.discountAmountCents, subtotal)
      : Math.round((subtotal * (reward.discountPercent ?? 0)) / 100)
    : 0;
  // Promotions and the member price are resolved on the server; the reward
  // is chosen here. Both come off before credit does.
  // Shown, not decided: the server works the same sums out again from the
  // database at checkout, and that is what the client is charged.
  const { creditUsedCents: creditUsed, totalCents: total, settledByCreditAlone } = cartTotals({
    subtotalCents: subtotal,
    rewardDiscountCents: discount,
    autoDiscountCents: autoDiscount?.discountCents ?? 0,
    creditAvailableCents: credit,
    useCredit,
  });

  async function setQty(id: string, qty: number) {
    const res = await clientSetCartQtyAction(merchantSlug, id, qty);
    if ("error" in res) setError(res.error);
    await refresh();
    await loadExtras();
  }

  async function pay() {
    setPending(true);
    setError(null);
    const res = await clientCheckoutAction(merchantSlug, rewardId, { useCredit });
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
   * Stripe says the client is done paying. What actually happened to the
   * order is the server's to tell, and one screen tells it — the same one a
   * client sees after being redirected to their bank, so there is a single
   * answer to "did that work" rather than two that can disagree.
   */
  async function afterCardPayment() {
    if (!handoff) return;
    setResult({ orderNumber: handoff.orderNumber, pointsEarned: 0 });
    setStage("done");
    setHandoff(null);
    await refresh();
    router.refresh();
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
            {pending ? "Processing…" : total === 0 ? "Place order" : `Pay ${money(total, currency)}`}
          </button>
        ) : (
          <button className="btn-black" onClick={() => setStage("pay")}>
            Checkout · {money(total, currency)}
          </button>
        )
      }
    >
      {stage === "card" && handoff ? (
        <CardPayment
            payment={handoff.payment}
            orderNumber={handoff.orderNumber}
            amountCents={handoff.totalCents}
            currency={currency}
          onPaid={afterCardPayment}
          onCancel={cancelCardPayment}
        />
      ) : stage === "done" && result ? (
        <PaymentResult
          merchantSlug={merchantSlug}
          orderNumber={result.orderNumber}
          bare
          onClose={onClose}
          onRetry={() => {
            // The basket is untouched when a payment fails, so going back to
            // it is all that is needed to try again.
            setResult(null);
            setStage("cart");
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          text="Your cart is empty"
          sub="Add something from the shop to get started."
          cta={
            <button
              className="btn-black"
              onClick={() => {
                onClose();
                router.push(`${base}/shop`);
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

          {autoDiscount && (
            <div className="optrow">
              <span>{autoDiscount.title}</span>
              <span style={{ flex: 1 }} />
              <b className="tabular">−{money(autoDiscount.discountCents, currency)}</b>
            </div>
          )}

          {credit > 0 && (
            <div className="optrow">
              <span>{creditUsed > 0 ? "Account credit" : `Account credit (${money(credit, currency)} available)`}</span>
              <span style={{ flex: 1 }} />
              {creditUsed > 0 ? (
                <>
                  <b className="tabular">−{money(creditUsed, currency)}</b>
                  <button aria-label="Don't use my credit" onClick={() => setUseCredit(false)} style={{ color: "var(--muted)" }}>
                    <Icon name="close" size={16} />
                  </button>
                </>
              ) : (
                <button className="press" style={{ fontSize: 14 }} onClick={() => setUseCredit(true)}>
                  Use it
                </button>
              )}
            </div>
          )}

          {memberNote && (
            <p style={{ fontSize: 14, color: "var(--muted)", padding: "0 2px" }}>{memberNote}</p>
          )}

          {stage === "pay" &&
            (settledByCreditAlone ? (
              // There is nothing left to charge, so offering a card would be
              // asking for something that will not be used.
              <>
                <div className="grouplab">Payment</div>
                <div className="optrow" style={{ gap: 8 }}>
                  <Icon name="check" size={20} />
                  <span>Paid with account credit</span>
                </div>
              </>
            ) : (
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
            ))}

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
                  <span style={{ color: "var(--muted)", fontSize: 14 }}>{r.pointsCost} points</span>
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
          <span className="tabular" style={{ fontSize: 14, color: "var(--muted)" }}>
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
