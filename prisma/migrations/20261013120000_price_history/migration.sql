-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemType" "CatalogItemType" NOT NULL,
    "serviceId" TEXT,
    "productId" TEXT,
    "priceCents" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceHistory_tenantId_serviceId_recordedAt_idx" ON "PriceHistory"("tenantId", "serviceId", "recordedAt");

-- CreateIndex
CREATE INDEX "PriceHistory_tenantId_productId_recordedAt_idx" ON "PriceHistory"("tenantId", "productId", "recordedAt");

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed the history with what every item costs today. Without this the first
-- 30 days after deploy would have no prior price to compare against, and a
-- clinic that cut a price on day two would show no "was" at all.
INSERT INTO "PriceHistory" ("id", "tenantId", "itemType", "serviceId", "priceCents", "recordedAt")
SELECT gen_random_uuid()::text, "tenantId", 'SERVICE', "id", "priceCents", "createdAt"
FROM "Service";

INSERT INTO "PriceHistory" ("id", "tenantId", "itemType", "productId", "priceCents", "recordedAt")
SELECT gen_random_uuid()::text, "tenantId", 'PRODUCT', "id", "priceCents", "createdAt"
FROM "Product";
