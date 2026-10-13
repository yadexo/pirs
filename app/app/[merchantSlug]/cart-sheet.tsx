"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useBasePath } from "./base-path";
import { Sheet, Stepper, EmptyState, Icon, money, useToast } from "@/components/client-app/ui";
import { Button, Switch, Tag } from "@/components/client-app/v2";
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

/**
 * The buy flow: cart, checkout, payment, result — one sheet, four stages, so a
 * client can step back without losing what they chose.
 *
 * Nothing here decides a price. The lines, the discount and the credit are all
 * read back from the server, and clientCheckoutAction works the same sums out
 * again from the database when it charges. What this screen shows is a
 * statement of what the server will do, not an instruction to it.
 */

interface Reward {
  id: string;
  name: string;
  pointsCost: number;
  discountAmountCents: number | null;
  discountPercent: number | null;
}

type Stage = "cart" | "pay" | "card" | "done";

const TITLES: Record<Stage, string> = { cart: "Your cart", pay: "Checkout", card: "Payment", done: "" };

export function CartSheet({
  merchantSlug,
  merchantName,
  currency,
  pointsPerCents,
  vatRateBasisPoints,
  clientName,
  clientEmail,
  clientPhone,
  open,
  onClose,
}: {
  merchantSlug: string;
  merchantName: string;
  currency: string;
  /** Same rate checkout uses: points = floor(amount in cents × rate). */
  pointsPerCents: number;
  /** The VAT already inside the prices, for the "of which VAT" line. */
  vatRateBasisPoints: number;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
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
  /** The client's spendable credit, and whether this order should use it. */
  const [credit, setCredit] = React.useState(0);
  const [useCredit, setUseCredit] = React.useState(true);
  /** What the server says this basket is discounted by, if anything. */
  const [autoDiscount, setAutoDiscount] = React.useState<{ title: string; source: string; discountCents: number } | null>(null);
  const [memberNote, setMemberNote] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ orderNumber: string } | null>(null);
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
  const { creditUsedCents: creditUsed, totalCents: total, vatCents, settledByCreditAlone } = cartTotals({
    subtotalCents: subtotal,
    rewardDiscountCents: discount,
    autoDiscountCents: autoDiscount?.discountCents ?? 0,
    creditAvailableCents: credit,
    useCredit,
    vatRateBasisPoints,
  });
  const pointsToEarn = Math.floor(total * pointsPerCents);

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
    setResult({ orderNumber: res.orderNumber });
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
    setResult({ orderNumber: handoff.orderNumber });
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

  /*
   * The final button always says what it costs: "Pay €132.50", never "Place
   * order", which would hide the one number the client is agreeing to. When
   * credit covers the whole order there is no payment to make, so it says
   * "Confirm order" and no amount is quoted.
   */
  const footer =
    stage === "done" ? undefined : stage === "card" ? undefined : items.length === 0 ? undefined : stage === "pay" ? (
      <Button amount={settledByCreditAlone ? undefined : total} currency={currency} loading={pending} onClick={pay}>
        {settledByCreditAlone ? "Confirm order" : "Pay"}
      </Button>
    ) : (
      <Button amount={total} currency={currency} onClick={() => setStage("pay")}>
        Checkout
      </Button>
    );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={TITLES[stage] || undefined}
      onBack={stage === "pay" ? () => setStage("cart") : undefined}
      cta={footer}
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
          merchantName={merchantName}
          currency={currency}
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
            <Button
              onClick={() => {
                onClose();
                router.push(`${base}/shop`);
              }}
            >
              Browse the shop
            </Button>
          }
        />
      ) : (
        <div className="v2-buy">
          {stage === "pay" && (
            <>
              <h3 className="grouphead">Your details</h3>
              <div className="v2-details">
                <div>
                  <b>{clientName}</b>
                  <span>{[clientEmail, clientPhone].filter(Boolean).join(" · ")}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    router.push(`${base}/profile?tab=settings`);
                  }}
                >
                  Edit
                </button>
              </div>

              <div className="v2-options">
                {credit > 0 && (
                  <div className="row">
                    <span className="ic" aria-hidden="true">
                      <Icon name="tag" size={20} />
                    </span>
                    <span className="txt">
                      <b>Use Credit</b>
                      <span>{money(credit, currency)} available</span>
                    </span>
                    <Switch checked={useCredit} onChange={setUseCredit} label="Use Credit on this order" />
                  </div>
                )}
                {rewards.length > 0 && (
                  <button type="button" className="row" onClick={() => setPickingReward(true)}>
                    <span className="ic" aria-hidden="true">
                      <Icon name="gift" size={20} />
                    </span>
                    <span className="txt">
                      <b>{reward ? reward.name : "Use a reward"}</b>
                      {reward && <span>−{money(discount, currency)}</span>}
                    </span>
                    <Icon name="chevR" size={20} />
                  </button>
                )}
              </div>
            </>
          )}

          {stage === "cart" &&
            items.map((l) => <CartRow key={l.id} line={l} currency={currency} onQty={setQty} />)}

          {stage === "pay" && (
            <div className="v2-lines">
              {items.map((l) => (
                <div className="line" key={l.id}>
                  <span>
                    {l.name}
                    {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                  </span>
                  <b className="tabular">{money(l.unitPriceCents * l.quantity, currency)}</b>
                </div>
              ))}
              {autoDiscount && (
                <div className="line off">
                  <span>{autoDiscount.title}</span>
                  <b className="tabular">−{money(autoDiscount.discountCents, currency)}</b>
                </div>
              )}
              {reward && (
                <div className="line off">
                  <span>{reward.name}</span>
                  <b className="tabular">−{money(discount, currency)}</b>
                </div>
              )}
              {creditUsed > 0 && (
                <div className="line off">
                  <span>Credit</span>
                  <b className="tabular">−{money(creditUsed, currency)}</b>
                </div>
              )}
            </div>
          )}

          {stage === "cart" && autoDiscount && (
            <div className="v2-saving">
              <Tag kind="soft">{autoDiscount.source === "MEMBERSHIP" ? "MEMBER" : "OFFER"}</Tag>
              <span>
                {autoDiscount.title} · −{money(autoDiscount.discountCents, currency)}
              </span>
            </div>
          )}

          {memberNote && <p className="v2-note">{memberNote}</p>}

          <div className="v2-totals">
            <div className="row total">
              <span>Total incl. VAT</span>
              <b className="tabular">{money(total, currency)}</b>
            </div>
            {vatCents > 0 && (
              <div className="row vat">
                <span>of which VAT</span>
                <span className="tabular">{money(vatCents, currency)}</span>
              </div>
            )}
            {pointsToEarn > 0 && (
              <div className="row earn">
                <span>You{stage === "pay" ? "’ll" : ""} earn</span>
                <b className="tabular">+{pointsToEarn} points</b>
              </div>
            )}
          </div>

          {/* Everything that is going to be charged is above the button. */}
          <p className="v2-nocosts">No extra costs.</p>

          {stage === "pay" && settledByCreditAlone && (
            // There is nothing left to charge, so offering a payment method
            // would be asking for something that will not be used.
            <div className="v2-paidwith">
              <Icon name="check" size={20} />
              <span>Paid with Credit</span>
            </div>
          )}

          {error && (
            <p className="v2-error" role="alert">
              {error}
            </p>
          )}

          <Sheet open={pickingReward} onClose={() => setPickingReward(false)} title="Use a reward">
            {rewards.map((r) => (
              <button
                key={r.id}
                className={`optrow ${rewardId === r.id ? "on" : ""}`}
                onClick={() => {
                  setRewardId(rewardId === r.id ? null : r.id);
                  setPickingReward(false);
                  if (rewardId !== r.id) toast(`${r.name} applied`);
                }}
              >
                <span className="rad" />
                <span style={{ flex: 1 }}>
                  {r.name}
                  <br />
                  <span style={{ color: "var(--text-2)", fontSize: "var(--caption-size)" }}>{r.pointsCost} points</span>
                </span>
                <b>−{r.discountAmountCents != null ? money(r.discountAmountCents, currency) : `${r.discountPercent}%`}</b>
              </button>
            ))}
          </Sheet>
        </div>
      )}
    </Sheet>
  );
}

/** Swipe left to reveal remove; releasing past the threshold deletes the line. */
function CartRow({ line, currency, onQty }: { line: CartLine; currency: string; onQty: (id: string, qty: number) => Promise<void> }) {
  const [dx, setDx] = React.useState(0);
  const startX = React.useRef<number | null>(null);

  return (
    <div className="crow">
      <div className="delbg">Remove</div>
      <div
        className="cin v2-cartline"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: startX.current !== null ? "none" : undefined }}
        onPointerDown={(e) => {
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
        <div className="thumb">
          {line.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={line.imageUrl} alt="" />
          ) : (
            <span aria-hidden="true">{line.name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="info">
          <b>{line.name}</b>
        </div>
        <div className="right">
          <b className="tabular">{money(line.unitPriceCents, currency)}</b>
          <Stepper value={line.quantity} min={0} onChange={(q) => void onQty(line.id, q)} />
        </div>
      </div>
    </div>
  );
}
