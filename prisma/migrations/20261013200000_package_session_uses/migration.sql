-- CreateTable
CREATE TABLE "PackageSessionUse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerPackageId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "usedById" TEXT,
    "note" TEXT,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageSessionUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackageSessionUse_tenantId_customerPackageId_idx" ON "PackageSessionUse"("tenantId", "customerPackageId");

-- AddForeignKey
ALTER TABLE "PackageSessionUse" ADD CONSTRAINT "PackageSessionUse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionUse" ADD CONSTRAINT "PackageSessionUse_customerPackageId_fkey" FOREIGN KEY ("customerPackageId") REFERENCES "CustomerPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionUse" ADD CONSTRAINT "PackageSessionUse_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionUse" ADD CONSTRAINT "PackageSessionUse_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

