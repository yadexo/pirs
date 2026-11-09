-- CreateEnum
CREATE TYPE "ClinicDomainType" AS ENUM ('CLIENT', 'PORTAL');

-- CreateEnum
CREATE TYPE "ClinicDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "ClinicDomain" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ClinicDomainType" NOT NULL DEFAULT 'CLIENT',
    "host" TEXT NOT NULL,
    "status" "ClinicDomainStatus" NOT NULL DEFAULT 'PENDING',
    "verification" JSONB,
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicDomain_host_key" ON "ClinicDomain"("host");

-- CreateIndex
CREATE INDEX "ClinicDomain_status_idx" ON "ClinicDomain"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicDomain_tenantId_type_key" ON "ClinicDomain"("tenantId", "type");

-- AddForeignKey
ALTER TABLE "ClinicDomain" ADD CONSTRAINT "ClinicDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicDomain" ADD CONSTRAINT "ClinicDomain_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
