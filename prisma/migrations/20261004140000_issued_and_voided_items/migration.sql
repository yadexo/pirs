-- Items a clinic gives or takes back, rather than ones a client bought.
--
-- A gift has no order behind it, so the order link becomes optional: inventing
-- a zero-value order would put a sale that never happened into the client's
-- history and the clinic's figures. `source` says which kind each item is, and
-- the issued/voided columns record who decided it and why — a voided item is
-- kept rather than deleted, because the client saw it and may ask.
CREATE TYPE "RedeemableSource" AS ENUM ('PURCHASE', 'GIFT', 'REISSUE');

ALTER TABLE "RedeemableItem" ADD COLUMN "issuedByStaffProfileId" TEXT,
ADD COLUMN "issuedReason" TEXT,
ADD COLUMN "source" "RedeemableSource" NOT NULL DEFAULT 'PURCHASE',
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedByStaffProfileId" TEXT,
ADD COLUMN "voidedReason" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL,
ALTER COLUMN "orderItemId" DROP NOT NULL;

ALTER TABLE "RedeemableItem" ADD CONSTRAINT "RedeemableItem_issuedByStaffProfileId_fkey" FOREIGN KEY ("issuedByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RedeemableItem" ADD CONSTRAINT "RedeemableItem_voidedByStaffProfileId_fkey" FOREIGN KEY ("voidedByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
