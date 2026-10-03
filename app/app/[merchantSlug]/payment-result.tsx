"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, Sheet, money } from "@/components/client-app/ui";
import { clientOrderStatusAction } from "@/lib/actions/client-app";
import { useBasePath } from "./base-path";

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

type Phase = "confirming" | "paid" | "failed" | "unknown";

/** Long enough for a webhook, short enough that nobody sits watching a spinner. */
const POLL_MS = 2000;
const GIVE_UP_AFTER_MS = 45_000;

export function PaymentResult({
  merchantSlug,
  orderNumber,
  standalone,
  onClose,
  onRetry,
}: {
  merchantSlug: string;
  orderNumber: string;
  /** True when the client landed here from a redirect, possibly outside the app. */
  standalone?: boolean;
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
      if (!res || "error" in res) {
        setPhase("unknown");
        return;
      }
      setDetails({ totalCents: res.totalCents, pointsEarned: res.pointsEarned });
      if (res.status === "PAID") {
        setPhase("paid");
        // The rest of the app — balances, items, history — is now out of date.
        router.refresh();
        return;
      }
      if (res.status === "FAILED") {
        setPhase("failed");
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(() => void check(), POLL_MS);
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

      {standalone && phase !== "confirming" && (
        <p className="ca-resultbody" style={{ marginTop: 20 }}>
          You can close this tab and go back to the {`app`} — everything is saved.
        </p>
      )}
    </div>
  );

  // A redirect landing is its own page; inside the app it is a sheet.
  if (standalone) return <div style={{ padding: "0 var(--pad-x)" }}>{body}</div>;
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
