import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";
import { StripePaymentProvider } from "./stripe";

export function getPaymentProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === "stripe" ? new StripePaymentProvider() : new MockPaymentProvider();
}

export * from "./types";
