-- A cart line or an order line can never have a quantity of zero or less, or
-- a negative price.
--
-- The application checks this on the way in (lib/cart-quantity.ts) and again
-- at checkout. This is the same rule where no code path can forget it: a line
-- of minus one used to subtract its price from the rest of the basket, and an
-- order completed for nothing (docs/security/review-2026-11.md, P-1).
--
-- Prisma has no syntax for CHECK constraints, so these live only here. They
-- do not appear in schema.prisma and `prisma migrate` leaves them alone.

-- An open basket is disposable; a line the till would refuse anyway is
-- removed rather than left to block the constraint.
DELETE FROM "BasketItem" WHERE "quantity" <= 0 OR "unitPriceCents" < 0;

ALTER TABLE "BasketItem" DROP CONSTRAINT IF EXISTS "BasketItem_quantity_positive";
ALTER TABLE "BasketItem" ADD CONSTRAINT "BasketItem_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "BasketItem" DROP CONSTRAINT IF EXISTS "BasketItem_unitPrice_not_negative";
ALTER TABLE "BasketItem" ADD CONSTRAINT "BasketItem_unitPrice_not_negative" CHECK ("unitPriceCents" >= 0);

-- Order lines are history and are never deleted. NOT VALID applies the rule
-- to every row written from now on without re-checking the ones already
-- there, so an order that was placed through the hole stays on record — as
-- evidence — instead of stopping this migration.
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_quantity_positive";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0) NOT VALID;

ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_unitPrice_not_negative";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitPrice_not_negative" CHECK ("unitPriceCents" >= 0) NOT VALID;
