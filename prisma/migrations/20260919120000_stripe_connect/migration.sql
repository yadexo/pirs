-- CreateEnum
CREATE TYPE "StripeConnectStatus" AS ENUM ('NOT_CONNECTED', 'ONBOARDING', 'PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeCountry" TEXT,
ADD COLUMN     "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeStatus" "StripeConnectStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
ADD COLUMN     "stripeStatusCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_stripeAccountId_key" ON "Tenant"("stripeAccountId");

