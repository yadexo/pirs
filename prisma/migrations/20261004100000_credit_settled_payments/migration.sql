-- An order can now be paid for out of the client's account credit — a
-- membership's included credit, or goodwill from the clinic. No card and no
-- provider is involved, so the payment needs a provider of its own rather
-- than being recorded as a mock or a Stripe charge it never was.
ALTER TYPE "PaymentProviderName" ADD VALUE 'ACCOUNT_CREDIT';
