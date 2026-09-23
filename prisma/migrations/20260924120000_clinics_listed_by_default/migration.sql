-- AlterTable
ALTER TABLE "TenantSettings" ALTER COLUMN "publiclyListed" SET DEFAULT true;


-- Clinics that existed before listing was the default are findable too: none of
-- them ever chose to be hidden, the flag simply started out off.
UPDATE "TenantSettings" SET "publiclyListed" = true WHERE "publiclyListed" = false;
