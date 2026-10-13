"use client";

import * as React from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { money } from "@/components/client-app/ui";
import { Button } from "@/components/client-app/v2";

/**
 * Paying for a charge on the clinic's own Stripe account.
 *
 * Stripe.js is loaded with the clinic's account id, so the sheet knows whose
 * payment it is and which methods that clinic accepts.
 *
 * The brand marks — Apple Pay's button, iDEAL, Wero, Klarna, the card networks
 * — are all drawn by Stripe's own Elements, which is the only way to show them
 * unchanged without shipping copies of other people's trademarks. The Express
 * Checkout Element renders Apple Pay's official button, to Apple's rules about
 * size, corner radius and wording; the Payment Element renders each method's
 * own mark beside its row. Nothing here draws a logo by hand.
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
  orderNumber,
  amountCents,
  currency,
  payLabel,
  onPaid,
  onCancel,
}: {
  payment: PaymentHandoff;
  /**
   * Carried into the return URL so a redirect can be resolved on the way back.
   * A membership's first payment has no order, and says so: the page it comes
   * back to reports the membership rather than looking for an order number.
   */
  orderNumber: string | { membership: true };
  amountCents: number;
  currency: string;
  /** Overrides "Pay €X" — a first membership payment says what it starts. */
  payLabel?: string;
  /** The payment went through, as far as the browser can tell. */
  onPaid: () => void;
  onCancel: () => void;
}) {
  if (!payment.publishableKey) {
    return (
      <p style={{ color: "var(--danger)", fontSize: "var(--small-size)", padding: "12px 0" }}>
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
          variables: {
            colorPrimary: "#0d0d0d",
            colorText: "#0d0d0d",
            colorTextSecondary: "#545450",
            colorBackground: "#f5f5f4",
            colorDanger: "#c42b1c",
            borderRadius: "16px",
            fontSizeBase: "16px",
            spacingUnit: "4px",
          },
        },
      }}
    >
      <PayForm orderNumber={orderNumber} amountCents={amountCents} currency={currency} payLabel={payLabel} onPaid={onPaid} onCancel={onCancel} />
    </Elements>
  );
}

function PayForm({
  orderNumber,
  amountCents,
  currency,
  payLabel,
  onPaid,
  onCancel,
}: {
  orderNumber: string | { membership: true };
  amountCents: number;
  currency: string;
  payLabel?: string;
  onPaid: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  /** False until Stripe says the device actually offers a wallet. */
  const [hasWallet, setHasWallet] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const returnUrl =
    typeof orderNumber === "string"
      ? `?order=${encodeURIComponent(orderNumber)}`
      : `?membership=1`;

  /** Shared by the wallet button and the Pay button; only the trigger differs. */
  const confirm = React.useCallback(async () => {
    if (!stripe || !elements) return;
    setError(null);

    const submitted = await elements.submit();
    if (submitted.error) {
      setError(submitted.error.message ?? "Check your payment details.");
      setBusy(false);
      return;
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      // Cards and wallets stay on this page; iDEAL, Wero and Klarna leave the
      // site entirely, and the order number is how the page they come back to
      // knows what to report.
      confirmParams: { return_url: `${window.location.origin}${window.location.pathname}${returnUrl}` },
      redirect: "if_required",
    });
    setBusy(false);
    if (confirmError) {
      setError(confirmError.message ?? "That payment didn't go through. Try another method.");
      return;
    }
    onPaid();
  }, [stripe, elements, returnUrl, onPaid]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    await confirm();
  }

  return (
    <form onSubmit={submit} className="v2-pay">
      {/*
        Apple Pay and Google Pay, as their owners' own buttons. The element
        hides itself on a device that offers neither, so there is no empty
        slot and no "Apple Pay" written on an Android.
      */}
      <div className="wallet" hidden={!hasWallet}>
        <ExpressCheckoutElement
          options={{ buttonHeight: 48, layout: { maxColumns: 1, maxRows: 2 } }}
          onReady={(event) => setHasWallet(!!event.availablePaymentMethods)}
          onConfirm={() => {
            setBusy(true);
            void confirm();
          }}
        />
        <span className="or">
          <i /> or <i />
        </span>
      </div>

      <PaymentElement onReady={() => setReady(true)} options={{ layout: "accordion" }} />

      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}

      <Button type="submit" disabled={!stripe || !ready || busy} loading={busy} className="go">
        {payLabel ?? `Pay ${money(amountCents, currency)}`}
      </Button>
      <button type="button" className="cancel" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}
