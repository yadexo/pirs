-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aftercareInstructions" TEXT,
ADD COLUMN     "cashBalanceBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consultationNotice" TEXT,
ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "maxQuantity" INTEGER,
ADD COLUMN     "practitionerId" TEXT,
ADD COLUMN     "prepInstructions" TEXT,
ADD COLUMN     "pricingOptions" JSONB,
ADD COLUMN     "requiresConsultation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "schedulingUrl" TEXT,
ADD COLUMN     "unitLabel" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "cashBalanceBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consultationNotice" TEXT,
ADD COLUMN     "maxQuantity" INTEGER,
ADD COLUMN     "practitionerId" TEXT,
ADD COLUMN     "pricingOptions" JSONB,
ADD COLUMN     "requiresConsultation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "schedulingUrl" TEXT,
ADD COLUMN     "unitLabel" TEXT;

-- CreateTable
CREATE TABLE "CatalogTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'sparkle',
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemTag" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "serviceId" TEXT,
    "productId" TEXT,

    CONSTRAINT "CatalogItemTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT,
    "productId" TEXT,
    "beforeImageUrl" TEXT,
    "afterImageUrl" TEXT,
    "testimonial" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogTag_tenantId_name_key" ON "CatalogTag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "CatalogItemTag_serviceId_idx" ON "CatalogItemTag"("serviceId");

-- CreateIndex
CREATE INDEX "CatalogItemTag_productId_idx" ON "CatalogItemTag"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemTag_tagId_serviceId_key" ON "CatalogItemTag"("tagId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemTag_tagId_productId_key" ON "CatalogItemTag"("tagId", "productId");

-- CreateIndex
CREATE INDEX "ClientResult_tenantId_idx" ON "ClientResult"("tenantId");

-- CreateIndex
CREATE INDEX "ClientResult_serviceId_idx" ON "ClientResult"("serviceId");

-- CreateIndex
CREATE INDEX "ClientResult_productId_idx" ON "ClientResult"("productId");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogTag" ADD CONSTRAINT "CatalogTag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemTag" ADD CONSTRAINT "CatalogItemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CatalogTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemTag" ADD CONSTRAINT "CatalogItemTag_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemTag" ADD CONSTRAINT "CatalogItemTag_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientResult" ADD CONSTRAINT "ClientResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientResult" ADD CONSTRAINT "ClientResult_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientResult" ADD CONSTRAINT "ClientResult_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
