-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpersonationSession_actorUserId_idx" ON "ImpersonationSession"("actorUserId");

-- CreateIndex
CREATE INDEX "ImpersonationSession_merchantId_startedAt_idx" ON "ImpersonationSession"("merchantId", "startedAt");

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
