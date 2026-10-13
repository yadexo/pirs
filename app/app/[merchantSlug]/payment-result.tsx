"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, Sheet, money } from "@/components/client-app/ui";
import { Button, Tag } from "@/components/client-app/v2";
import { clientOrderStatusAction, clientOrderReceiptAction } from "@/lib/actions/client-app";
import { useBasePath } from "./base-path";
import { phaseFor, shouldAskAgain, POLL_MS, type Phase } from "./payment-phase";

/**
 * What happened to a payment, told by the server.
 *
 * Never by the ?paid=1 in the address: that flag only says the client came
 * back from somewhere, not that any money moved. The order's real state
 * arrives with the webhook, which can be a second or two behind a card and
 * noticeably behind iDEAL, so this says "confirming" and asks again rather
 * than guessing.
 *
 * It also has to work in a Safari view. A redirect payment can land the client
 * outside the installed app, where "go back to the app" is the only useful
 * thing to say — so the result is shown here too rather than only inside.
 */

type Receipt = Extract<Awaited<ReturnType<typeof clientOrderReceiptAction>>, { ok: true }>;

/** "ideal" from the provider becomes something a client would recognise. */
const METHOD_NAMES: Record<string, string> = {
  ideal: "iDEAL | Wero",
  wero: "iDEAL | Wero",
  card: "card",
  klarna: "Klarna",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  credit: "Credit",
};

export function PaymentResult({
  merchantSlug,
  merchantName,
  currency,
  orderNumber,
  bare,
  outsideApp,
  onClose,
  onRetry,
}: {
  merchantSlug: string;
  merchantName?: string;
  currency?: string;
  orderNumber: string;
  /** Render without a sheet of its own — for use inside one. */
  bare?: boolean;
  /**
   * The client is looking at this in a browser tab rather than the app they
   * installed, which happens after a bank redirect. Then the one useful
   * thing to say is how to get back.
   */
  outsideApp?: boolean;
  onClose?: () => void;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const base = useBasePath();
  const [phase, setPhase] = React.useState<Phase>("confirming");
  const [receipt, setReceipt] = React.useState<Receipt | null>(null);
  const [gaveUp, setGaveUp] = React.useState(false);

  React.useEffect(() => {
    let stop = false;
    const startedAt = Date.now();

    async function check() {
      const res = await clientOrderStatusAction(merchantSlug, orderNumber).catch(() => null);
      if (stop) return;

      const next = phaseFor(res);
      setPhase(next);
      // The rest of the app — balances, items, history — is now out of date.
      if (next === "paid") {
        router.refresh();
        const full = await clientOrderReceiptAction(orderNumber).catch(() => null);
        if (!stop && full && "ok" in full) setReceipt(full);
      }

      if (shouldAskAgain(next, Date.now() - startedAt)) timer = setTimeout(() => void check(), POLL_MS);
      else if (next === "confirming") setGaveUp(true);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    void check();

    // Coming back to the app is the moment to ask again: an iDEAL payment
    // usually finishes while the app is in the background.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stop) void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [merchantSlug, orderNumber, router]);

  const method = receipt?.paymentMethod ? (METHOD_NAMES[receipt.paymentMethod] ?? receipt.paymentMethod) : null;
  const nextReward = receipt?.nextReward ?? null;
  const toBook = receipt?.toBook ?? [];
  const progress = nextReward ? Math.min(100, Math.round((receipt!.pointsBalance / nextReward.pointsCost) * 100)) : 0;

  const body = (
    <div className="v2-result">
      {phase === "confirming" && !gaveUp && (
        <div className="head">
          <span className="ca-spinner" aria-hidden="true" />
          <h2>Confirming your payment…</h2>
          <p>This usually takes a few seconds. You can leave this open.</p>
        </div>
      )}

      {phase === "confirming" && gaveUp && (
        <div className="head">
          <span className="mark waiting" aria-hidden="true">
            <Icon name="clock" size={32} />
          </span>
          <h2>Still waiting on your bank</h2>
          <p>
            Your payment for {orderNumber} hasn&apos;t been confirmed yet. Nothing is lost — it will appear in your order history as soon as it
            lands.
          </p>
        </div>
      )}

      {phase === "paid" && (
        <>
          <div className="head">
            <span className="mark ok" aria-hidden="true">
              <Icon name="check" size={34} />
            </span>
            <h2>Payment complete</h2>
            <p>
              {receipt?.firstName ? `Thanks, ${receipt.firstName}. ` : ""}
              {receipt?.email ? `Your receipt is on its way to ${receipt.email}.` : "Your receipt is on its way."}
            </p>
          </div>

          {/*
            The next step is whatever is actually left to do. A treatment the
            clinic gave a booking page to is booked — one button per treatment,
            because an order with three of them needs three appointments. An
            order with none leads with the items, which are collected at the
            desk, and so does a clinic that has set no links at all.
          */}
          <div className="v2-next">
            <div className="top">
              <span className="ic" aria-hidden="true">
                <Icon name={toBook.length > 0 ? "calendar" : "qr"} size={22} />
              </span>
              <span>
                <span className="lead">Next step</span>
                <b>
                  {toBook.length === 0
                    ? "Your items are ready"
                    : toBook.length === 1
                      ? "Book your treatment"
                      : "Book your treatments"}
                </b>
              </span>
            </div>
            {toBook.length === 0 ? (
              <>
                <p>Show your code at the desk when you visit.</p>
                <Button variant="grey" className="go" onClick={() => router.push(`${base}/profile?tab=items`)}>
                  View my items
                </Button>
              </>
            ) : (
              <>
                {/* Anything else in the same order is still waiting at the desk. */}
                {receipt && receipt.itemsToCollect > toBook.length && <p>The rest of your order is ready at the desk.</p>}
                <div className="books">
                  {toBook.map((t) => (
                    <a key={t.url + t.name} className="book" href={t.url} target="_blank" rel="noreferrer">
                      <span>{t.name}</span>
                      <b>Book</b>
                    </a>
                  ))}
                </div>
                <p className="later">You can also book later in My items.</p>
              </>
            )}
          </div>

          {receipt && receipt.pointsEarned > 0 && (
            <button type="button" className="v2-earned" onClick={() => router.push(`${base}/rewards`)}>
              <span className="top">
                <b>+{receipt.pointsEarned} points earned</b>
                <Icon name="chevR" size={20} />
              </span>
              {nextReward && (
                <>
                  <span className="bar" aria-hidden="true">
                    <span style={{ width: `${progress}%` }} />
                  </span>
                  <span className="note">
                    You now have {receipt.pointsBalance} points. {nextReward.pointsCost - receipt.pointsBalance} more for your {nextReward.name}.
                  </span>
                </>
              )}
            </button>
          )}

          {receipt && (
            <div className="v2-receipt">
              <div className="top">
                <b>Order {orderNumber}</b>
                <Tag kind="success">PAID</Tag>
              </div>
              {receipt.lines.map((l, i) => (
                <div className="line" key={i}>
                  <span>
                    {l.name}
                    {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                  </span>
                  <span className="tabular">{money(l.totalCents, currency)}</span>
                </div>
              ))}
              {receipt.discountCents > 0 && (
                <div className="line">
                  <span>{receipt.discountTitle ?? "Discount"}</span>
                  <span className="tabular">−{money(receipt.discountCents, currency)}</span>
                </div>
              )}
              {receipt.loyaltyDiscountCents > 0 && (
                <div className="line">
                  <span>Reward</span>
                  <span className="tabular">−{money(receipt.loyaltyDiscountCents, currency)}</span>
                </div>
              )}
              {receipt.creditAppliedCents > 0 && (
                <div className="line">
                  <span>Credit</span>
                  <span className="tabular">−{money(receipt.creditAppliedCents, currency)}</span>
                </div>
              )}
              <div className="line total">
                <b>Total paid, incl. VAT</b>
                <b className="tabular">{money(receipt.totalCents, currency)}</b>
              </div>
              {receipt.vatCents > 0 && (
                <div className="line vat">
                  <span>of which VAT</span>
                  <span className="tabular">{money(receipt.vatCents, currency)}</span>
                </div>
              )}
              {method && <p className="paidwith">Paid with {method}</p>}
            </div>
          )}

          <Button variant="outline" className="home" onClick={() => (onClose ? onClose() : router.push(base))}>
            Back to home
          </Button>
        </>
      )}

      {phase === "failed" && (
        <>
          <div className="head">
            <span className="mark bad" aria-hidden="true">
              <Icon name="close" size={32} />
            </span>
            <h2>Payment didn&apos;t go through</h2>
            <p>Nothing was charged, and your basket is still here.</p>
          </div>
          <Button onClick={() => (onRetry ? onRetry() : router.push(`${base}/shop`))}>Try again</Button>
        </>
      )}

      {phase === "unknown" && (
        <>
          <div className="head">
            <h2>We couldn&apos;t check that payment</h2>
            <p>Open your order history to see where it stands.</p>
          </div>
          <Button onClick={() => router.push(`${base}/profile?tab=settings`)}>Order history</Button>
        </>
      )}

      {outsideApp && phase !== "confirming" && (
        <p className="outside">
          You&apos;re in a browser tab, not the app{merchantName ? ` for ${merchantName}` : ""}. Close this tab and open the app from your Home
          Screen — everything here is saved.
        </p>
      )}
    </div>
  );

  // Inside another sheet it draws no sheet of its own.
  if (bare) return body;
  return (
    <Sheet open onClose={onClose ?? (() => undefined)} title="Your payment">
      {body}
    </Sheet>
  );
}
