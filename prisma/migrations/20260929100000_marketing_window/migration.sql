-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "marketingWindowEndMinutes" INTEGER NOT NULL DEFAULT 1320,
ADD COLUMN     "marketingWindowStartMinutes" INTEGER NOT NULL DEFAULT 540;

