-- AlterTable
ALTER TABLE "NotificationCampaign" ADD COLUMN     "outcomeNote" TEXT,
ADD COLUMN     "skippedDailyCap" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skippedNoConsent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skippedNoDevices" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skippedOutsideHours" INTEGER NOT NULL DEFAULT 0;

