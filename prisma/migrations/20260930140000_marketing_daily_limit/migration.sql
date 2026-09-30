-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "marketingDailyLimit" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "NotificationCampaign" ADD COLUMN     "ignoreDailyLimit" BOOLEAN NOT NULL DEFAULT false;

