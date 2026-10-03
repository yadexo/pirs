"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, Sheet, money } from "@/components/client-app/ui";
import { clientOrderStatusAction } from "@/lib/actions/client-app";
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

export function PaymentResult({
  merchantSlug,
  orderNumber,
  bare,
  outsideApp,
  onClose,
  onRetry,
}: {
  merchantSlug: string;
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
  const [details, setDetails] = React.useState<{ totalCents: number; pointsEarned: number } | null>(null);
  const [gaveUp, setGaveUp] = React.useState(false);

  React.useEffect(() => {
    let stop = false;
    const startedAt = Date.now();

    async function check() {
      const res = await clientOrderStatusAction(merchantSlug, orderNumber).catch(() => null);
      if (stop) return;

      const next = phaseFor(res);
      setPhase(next);
      if (res && !("error" in res)) setDetails({ totalCents: res.totalCents, pointsEarned: res.pointsEarned });
      // The rest of the app — balances, items, history — is now out of date.
      if (next === "paid") router.refresh();

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

  const body = (
    <div style={{ textAlign: "center", padding: "24px 0 8px" }}>
      {phase === "confirming" && !gaveUp && (
        <>
          <span className="ca-spinner" aria-hidden="true" />
          <p className="ca-resulttitle">Confirming your payment…</p>
          <p className="ca-resultbody">This usually takes a few seconds. You can leave this open.</p>
        </>
      )}

      {phase === "confirming" && gaveUp && (
        <>
          <p style={{ fontSize: 40, margin: 0 }} aria-hidden="true">
            ⏳
          </p>
          <p className="ca-resulttitle">Still waiting on your bank</p>
          <p className="ca-resultbody">
            Your payment for {orderNumber} hasn&apos;t been confirmed yet. Nothing is lost — it will appear in your order history as soon as it
            lands.
          </p>
        </>
      )}

      {phase === "paid" && (
        <>
          <p style={{ fontSize: 44, margin: 0, color: "var(--accent-green, #2e7d32)" }} aria-hidden="true">
            ✓
          </p>
          <p className="ca-resulttitle">Payment received</p>
          <p className="ca-resultbody">
            {orderNumber}
            {details ? ` · ${money(details.totalCents)}` : ""}
            {details && details.pointsEarned > 0 ? ` · +${details.pointsEarned} points` : ""}
          </p>
          <button className="btn-black" style={{ marginTop: 18 }} onClick={() => router.push(`${base}/profile?tab=items`)}>
            See what you bought
          </button>
        </>
      )}

      {phase === "failed" && (
        <>
          <p style={{ fontSize: 44, margin: 0, color: "var(--danger)" }} aria-hidden="true">
            ✕
          </p>
          <p className="ca-resulttitle">Payment didn&apos;t go through</p>
          <p className="ca-resultbody">Nothing was charged, and your basket is still here.</p>
          <button className="btn-black" style={{ marginTop: 18 }} onClick={() => (onRetry ? onRetry() : router.push(`${base}/shop`))}>
            Try again
          </button>
        </>
      )}

      {phase === "unknown" && (
        <>
          <p className="ca-resulttitle">We couldn&apos;t check that payment</p>
          <p className="ca-resultbody">Open your order history to see where it stands.</p>
          <button className="btn-black" style={{ marginTop: 18 }} onClick={() => router.push(`${base}/profile?tab=settings`)}>
            Order history
          </button>
        </>
      )}

      {outsideApp && phase !== "confirming" && (
        <p className="ca-resultbody" style={{ marginTop: 20 }}>
          You&apos;re in a browser tab, not the app. Close this tab and open the app from your Home Screen — everything here is saved.
        </p>
      )}
    </div>
  );

  // Inside another sheet it draws no sheet of its own.
  if (bare) return <div style={{ padding: "0 var(--pad-x)" }}>{body}</div>;
  return (
    <Sheet open onClose={onClose ?? (() => undefined)} title="Your payment">
      {body}
      {phase !== "confirming" && (
        <button className="press" style={{ width: "100%", marginTop: 6, fontSize: 14, color: "var(--muted)" }} onClick={onClose}>
          Close
        </button>
      )}
      <span style={{ display: "none" }}>
        <Icon name="check" size={1} />
      </span>
    </Sheet>
  );
}
