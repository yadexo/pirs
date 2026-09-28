-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "birthdayDiscountDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "birthdayDiscountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "birthdayMessage" TEXT,
ADD COLUMN     "birthdayMessageEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "autoApply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "customerProfileId" TEXT,
ADD COLUMN     "minOrderCents" INTEGER;

-- AlterTable
ALTER TABLE "PromotionEligibility" ADD COLUMN     "productCategoryId" TEXT,
ADD COLUMN     "serviceCategoryId" TEXT;

-- AlterTable
ALTER TABLE "NotificationCampaign" ADD COLUMN     "customerProfileId" TEXT,
ADD COLUMN     "devicesReached" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "marketing" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "promotionId" TEXT;

-- CreateTable
CREATE TABLE "BirthdayGreeting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "promotionId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayGreeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BirthdayGreeting_tenantId_year_idx" ON "BirthdayGreeting"("tenantId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayGreeting_tenantId_customerProfileId_year_key" ON "BirthdayGreeting"("tenantId", "customerProfileId", "year");

-- CreateIndex
CREATE INDEX "Promotion_tenantId_customerProfileId_idx" ON "Promotion"("tenantId", "customerProfileId");

-- CreateIndex
CREATE INDEX "NotificationCampaign_status_scheduledAt_idx" ON "NotificationCampaign"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionEligibility" ADD CONSTRAINT "PromotionEligibility_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "ProductCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionEligibility" ADD CONSTRAINT "PromotionEligibility_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreeting" ADD CONSTRAINT "BirthdayGreeting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreeting" ADD CONSTRAINT "BirthdayGreeting_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

