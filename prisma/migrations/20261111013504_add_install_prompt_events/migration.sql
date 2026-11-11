-- CreateEnum
CREATE TYPE "InstallPromptKind" AS ENUM ('SHOWN', 'STARTED', 'ACCEPTED', 'OPENED', 'DISMISSED', 'NEVER');

-- CreateEnum
CREATE TYPE "InstallClientOs" AS ENUM ('IOS', 'IPADOS', 'ANDROID', 'MACOS', 'WINDOWS', 'OTHER');

-- CreateEnum
CREATE TYPE "InstallBrowser" AS ENUM ('SAFARI', 'CHROME', 'EDGE', 'SAMSUNG', 'FIREFOX', 'OPERA', 'OTHER');

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "installNudgeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "installNudgeMessageEn" TEXT,
ADD COLUMN     "installNudgeMessageNl" TEXT;

-- CreateTable
CREATE TABLE "InstallPromptEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "kind" "InstallPromptKind" NOT NULL,
    "os" "InstallClientOs" NOT NULL DEFAULT 'OTHER',
    "browser" "InstallBrowser" NOT NULL DEFAULT 'OTHER',
    "origin" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallPromptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstallPromptEvent_tenantId_kind_createdAt_idx" ON "InstallPromptEvent"("tenantId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "InstallPromptEvent_customerProfileId_kind_createdAt_idx" ON "InstallPromptEvent"("customerProfileId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "InstallPromptEvent" ADD CONSTRAINT "InstallPromptEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallPromptEvent" ADD CONSTRAINT "InstallPromptEvent_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
