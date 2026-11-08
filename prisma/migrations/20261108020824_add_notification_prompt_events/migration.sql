-- CreateEnum
CREATE TYPE "NotificationPromptKind" AS ENUM ('SHOWN', 'TURNED_ON', 'NOT_NOW', 'BLOCKED');

-- CreateEnum
CREATE TYPE "NotificationPromptSurface" AS ENUM ('SHEET', 'CARD', 'INSTALL', 'SETTINGS_HELP', 'SETTINGS');

-- CreateTable
CREATE TABLE "NotificationPromptEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "kind" "NotificationPromptKind" NOT NULL,
    "surface" "NotificationPromptSurface" NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationPromptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationPromptEvent_tenantId_kind_createdAt_idx" ON "NotificationPromptEvent"("tenantId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationPromptEvent_customerProfileId_kind_createdAt_idx" ON "NotificationPromptEvent"("customerProfileId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationPromptEvent" ADD CONSTRAINT "NotificationPromptEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPromptEvent" ADD CONSTRAINT "NotificationPromptEvent_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
