-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('SIGNUP', 'BOOKING', 'BOOKING_CANCELLED', 'PURCHASE', 'CHECK_IN', 'REWARD_REDEEMED', 'MEMBERSHIP_JOINED', 'MEMBERSHIP_CANCELLED', 'REFERRAL', 'REVIEW');

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "customerProfileId" TEXT,
    "summary" TEXT NOT NULL,
    "amountCents" INTEGER,
    "points" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityEvent_tenantId_createdAt_idx" ON "ActivityEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_tenantId_type_createdAt_idx" ON "ActivityEvent"("tenantId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
