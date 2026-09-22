"use client";

import * as React from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { money } from "@/components/client-app/ui";

/**
 * Card details for a charge on the clinic's own Stripe account.
 *
 * Stripe.js is loaded with the clinic's account id, so the payment sheet knows
 * whose payment it is and which methods that clinic accepts — the same
 * component later carries Apple Pay and iDEAL | Wero without changing here.
 *
 * Nothing on this screen decides the outcome. It confirms with Stripe and then
 * asks our server what actually happened; the webhook is what settles the
 * order, so closing the tab mid-payment still completes it.
 */

export interface PaymentHandoff {
  clientSecret: string;
  publishableKey: string | null;
  stripeAccountId: string;
}

/** One Stripe.js instance per publishable key + account, kept across renders. */
const clients = new Map<string, Promise<Stripe | null>>();
function stripeFor(publishableKey: string, stripeAccount: string) {
  const key = `${publishableKey}:${stripeAccount}`;
  let client = clients.get(key);
  if (!client) {
    client = loadStripe(publishableKey, { stripeAccount });
    clients.set(key, client);
  }
  return client;
}

export function CardPayment({
  payment,
  amountCents,
  currency,
  onPaid,
  onCancel,
}: {
  payment: PaymentHandoff;
  amountCents: number;
  currency: string;
  /** The payment went through, as far as the browser can tell. */
  onPaid: () => void;
  onCancel: () => void;
}) {
  if (!payment.publishableKey) {
    return (
      <p style={{ color: "var(--danger)", fontSize: 15, padding: "12px 0" }}>
        This clinic&apos;s payments aren&apos;t set up completely yet. Please pay at the clinic.
      </p>
    );
  }
  return (
    <Elements
      stripe={stripeFor(payment.publishableKey, payment.stripeAccountId)}
      options={{
        clientSecret: payment.clientSecret,
        appearance: {
          theme: "flat",
          variables: { colorPrimary: "#0b0d12", colorText: "#1b2233", colorDanger: "#e5484d", borderRadius: "14px", fontSizeBase: "15px" },
        },
      }}
    >
      <PayForm amountCents={amountCents} currency={currency} onPaid={onPaid} onCancel={onCancel} />
    </Elements>
  );
}

function PayForm({ amountCents, currency, onPaid, onCancel }: { amountCents: number; currency: string; onPaid: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);

    // Shows the Apple Pay / Google Pay sheet when one of those is chosen.
    const submitted = await elements.submit();
    if (submitted.error) {
      setError(submitted.error.message ?? "Check your payment details.");
      setBusy(false);
      return;
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      // Card payments stay on this page; bank methods still redirect and come
      // back to the clinic's app.
      confirmParams: { return_url: `${window.location.origin}${window.location.pathname}?paid=1` },
      redirect: "if_required",
    });
    setBusy(false);
    if (confirmError) {
      setError(confirmError.message ?? "That payment didn't go through. Try another method.");
      return;
    }
    onPaid();
  }

  return (
    <form onSubmit={submit} style={{ paddingTop: 4 }}>
      <PaymentElement onReady={() => setReady(true)} options={{ layout: "tabs" }} />
      {error && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 14, marginTop: 12 }}>
          {error}
        </p>
      )}
      <button className="btn-black" type="submit" disabled={!stripe || !ready || busy} style={{ width: "100%", marginTop: 16 }}>
        {busy ? "Paying…" : `Pay ${money(amountCents, currency)}`}
      </button>
      <button type="button" className="press" onClick={onCancel} disabled={busy} style={{ width: "100%", marginTop: 10, fontSize: 14, color: "var(--muted)" }}>
        Cancel
      </button>
    </form>
  );
}
