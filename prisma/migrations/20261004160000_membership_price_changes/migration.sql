-- A price change a clinic has promised one member, waiting for the date it was
-- promised for.
--
-- A member gets at least a month's warning, so the new price starts at their
-- first billing date 30 days or more after they are told. When that is their
-- next one, Stripe is updated on the spot and this row is just the record.
-- When their next payment comes sooner, the switch has to wait until after
-- that invoice, or they would be charged a price nobody warned them about:
-- applyAfter is when it becomes safe, and the memberships cron does it.

-- CreateTable
CREATE TABLE "MembershipPriceChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerMembershipId" TEXT NOT NULL,
    "membershipPlanId" TEXT NOT NULL,
    "oldPriceCents" INTEGER NOT NULL,
    "newPriceCents" INTEGER NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "applyAfter" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "noticeSentAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdByStaffProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipPriceChange_tenantId_appliedAt_idx" ON "MembershipPriceChange"("tenantId", "appliedAt");

-- CreateIndex
CREATE INDEX "MembershipPriceChange_applyAfter_idx" ON "MembershipPriceChange"("applyAfter");

-- AddForeignKey
ALTER TABLE "MembershipPriceChange" ADD CONSTRAINT "MembershipPriceChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPriceChange" ADD CONSTRAINT "MembershipPriceChange_customerMembershipId_fkey" FOREIGN KEY ("customerMembershipId") REFERENCES "CustomerMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPriceChange" ADD CONSTRAINT "MembershipPriceChange_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPriceChange" ADD CONSTRAINT "MembershipPriceChange_createdByStaffProfileId_fkey" FOREIGN KEY ("createdByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

