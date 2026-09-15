-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('IN_APP', 'EXTERNAL');

-- AlterTable
ALTER TABLE "LoyaltyProgramme" ADD COLUMN     "reviewPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "bookingMode" "BookingMode" NOT NULL DEFAULT 'IN_APP',
ADD COLUMN     "externalBookingUrl" TEXT,
ADD COLUMN     "googleReviewUrl" TEXT,
ADD COLUMN     "notifyAppointmentReminders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyBookingConfirmations" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyMembershipBilling" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPointsEarned" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "publiclyListed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shopBannerButtonLabel" TEXT,
ADD COLUMN     "shopBannerHeadline" TEXT,
ADD COLUMN     "shopBannerSubtitle" TEXT;
