-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 2100;


-- Every clinic starts on the Dutch standard rate. The column's default only
-- applies to new rows, and these settings already exist.
UPDATE "TenantSettings" SET "vatRateBasisPoints" = 2100;
