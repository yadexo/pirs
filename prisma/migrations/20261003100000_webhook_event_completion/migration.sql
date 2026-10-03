-- A Stripe event is claimed when it arrives and stamped when its handler
-- finishes. Without the stamp there is no way to tell an event that was
-- handled from one whose handler was killed halfway, and Stripe's retry of the
-- second was being answered "already done" — leaving the order unpaid for good.
ALTER TABLE "ProcessedStripeEvent" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Rows written before this column existed have already been answered as
-- duplicates for as long as they have existed, so treating them as finished
-- changes nothing; the alternative would re-run old events on their next retry.
UPDATE "ProcessedStripeEvent" SET "completedAt" = "processedAt";
