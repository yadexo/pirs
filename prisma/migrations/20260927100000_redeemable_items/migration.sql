-- CreateEnum
CREATE TYPE "RedemptionMethod" AS ENUM ('QR', 'BACKUP_CODE', 'MANUAL');

-- CreateEnum
CREATE TYPE "RedeemableStatus" AS ENUM ('AVAILABLE', 'REDEEMED', 'VOIDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "RedeemableItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "unitIndex" INTEGER NOT NULL,
    "itemType" "CatalogItemType" NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "RedeemableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedById" TEXT,
    "redemptionMethod" "RedemptionMethod",
    "redemptionNote" TEXT,
    "refundedAfterUse" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedeemableItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RedeemableItem_token_key" ON "RedeemableItem"("token");

-- CreateIndex
CREATE INDEX "RedeemableItem_tenantId_status_idx" ON "RedeemableItem"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RedeemableItem_customerProfileId_status_idx" ON "RedeemableItem"("customerProfileId", "status");

-- CreateIndex
CREATE INDEX "RedeemableItem_orderId_idx" ON "RedeemableItem"("orderId");

-- CreateIndex
CREATE INDEX "RedeemableItem_tenantId_redeemedAt_idx" ON "RedeemableItem"("tenantId", "redeemedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RedeemableItem_orderItemId_unitIndex_key" ON "RedeemableItem"("orderItemId", "unitIndex");

-- CreateIndex
CREATE UNIQUE INDEX "RedeemableItem_tenantId_code_key" ON "RedeemableItem"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "RedeemableItem" ADD CONSTRAINT "RedeemableItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemableItem" ADD CONSTRAINT "RedeemableItem_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemableItem" ADD CONSTRAINT "RedeemableItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemableItem" ADD CONSTRAINT "RedeemableItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemableItem" ADD CONSTRAINT "RedeemableItem_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

