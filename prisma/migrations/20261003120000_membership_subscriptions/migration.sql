-- Memberships become real Stripe subscriptions on the clinic's own connected
-- account: the client confirms a first payment, and the webhook is what
-- activates the membership and grants its included credit.

-- PENDING: signed up, first payment not yet confirmed — no benefits, no credit.
-- SUSPENDED: past due for longer than the grace period.
ALTER TYPE "MembershipStatus" ADD VALUE 'PENDING';
ALTER TYPE "MembershipStatus" ADD VALUE 'SUSPENDED';

-- The platform's cut of this clinic's memberships, set by the agency. NULL
-- means the same percentage as the clinic's other sales; 0 means nothing.
ALTER TABLE "Tenant" ADD COLUMN "membershipFeePercent" DOUBLE PRECISION;

-- The client as a customer on their own clinic's Stripe account.
ALTER TABLE "CustomerProfile" ADD COLUMN "stripeCustomerId" TEXT;

-- The recurring price the plan is billed by, on the clinic's account.
ALTER TABLE "MembershipPlan" ADD COLUMN "stripePriceId" TEXT,
ADD COLUMN "stripeProductId" TEXT;

-- When the current run of payment failures began; the grace period counts from here.
ALTER TABLE "CustomerMembership" ADD COLUMN "pastDueSince" TIMESTAMP(3);
