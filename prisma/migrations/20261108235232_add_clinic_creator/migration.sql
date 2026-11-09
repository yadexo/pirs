-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Tenant_createdByUserId_idx" ON "Tenant"("createdByUserId");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
