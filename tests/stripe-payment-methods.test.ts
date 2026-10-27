import { describe, it, expect } from "vitest";
import { paymentIntentMethodParams } from "@/lib/stripe-payments";

/**
 * Which payment methods a PaymentIntent offers, by the clinic's currency.
 * iDEAL, Wero and Bancontact are EUR-only at Stripe's own level and would
 * never be offered for another currency regardless — the one thing worth
 * pinning down here is Klarna, which Stripe does support in USD/GBP, and
 * which this app keeps EUR-only as a deliberate choice.
 */
describe("paymentIntentMethodParams", () => {
  it("leaves EUR to Stripe's own dynamic selection — iDEAL, Wero, Bancontact, Klarna, card and wallets together", () => {
    expect(paymentIntentMethodParams("EUR")).toEqual({ automatic_payment_methods: { enabled: true } });
  });

  it("restricts USD to card only, keeping Klarna off even though Stripe would otherwise allow it", () => {
    expect(paymentIntentMethodParams("USD")).toEqual({ payment_method_types: ["card"] });
  });

  it("restricts GBP to card only the same way", () => {
    expect(paymentIntentMethodParams("GBP")).toEqual({ payment_method_types: ["card"] });
  });
});
