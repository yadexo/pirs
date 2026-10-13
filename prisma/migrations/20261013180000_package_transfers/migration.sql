-- AlterTable
ALTER TABLE "CustomerPackage" ADD COLUMN     "expiryReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedFromCustomerProfileId" TEXT;

-- AddForeignKey
ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_receivedFromCustomerProfileId_fkey" FOREIGN KEY ("receivedFromCustomerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

