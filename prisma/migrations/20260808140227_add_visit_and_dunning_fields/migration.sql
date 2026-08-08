-- AlterTable
ALTER TABLE "CustomerMembership" ADD COLUMN     "dunningState" TEXT,
ADD COLUMN     "failedAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "lastVisitAt" TIMESTAMP(3),
ADD COLUMN     "visitCount" INTEGER NOT NULL DEFAULT 0;
