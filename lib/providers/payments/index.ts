import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";
import { StripePaymentProvider } from "./stripe";
import { isStripeConfigured } from "@/lib/stripe-connect";

/**
 * Real Stripe only when there's actually a key to call it with — PAYMENT_PROVIDER
 * alone isn't enough to go on. clinicPaymentMode() (lib/stripe-payments.ts), the
 * other place that decides mock vs. real, keys off isStripeConfigured() for the
 * same reason: a deployment can have PAYMENT_PROVIDER=stripe set ahead of the
 * actual key landing (environments get configured one variable at a time), and
 * callers that already checked clinicPaymentMode() and got "not stripe" assume
 * this falls back to the mock provider. Disagreeing here used to mean the real
 * StripePaymentProvider was built anyway and threw the moment it tried to use a
 * key that doesn't exist.
 */
export function getPaymentProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === "stripe" && isStripeConfigured() ? new StripePaymentProvider() : new MockPaymentProvider();
}

export * from "./types";
