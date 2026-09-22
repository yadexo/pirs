-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'DISPUTED';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'DISPUTED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "applicationFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disputedAt" TIMESTAMP(3),
ADD COLUMN     "stripeAccountId" TEXT;

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "bookingDepositFixedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bookingDepositPercent" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProcessedStripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accountId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedStripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessedStripeEvent_processedAt_idx" ON "ProcessedStripeEvent"("processedAt");

-- CreateIndex
CREATE INDEX "Payment_providerPaymentId_idx" ON "Payment"("providerPaymentId");

