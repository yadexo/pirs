-- Two-factor authentication: one TOTP enrollment per account, and its
-- single-use recovery codes. See prisma/schema.prisma for the full story.

CREATE TABLE "TwoFactorSecret" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwoFactorSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TwoFactorSecret_userId_key" ON "TwoFactorSecret"("userId");

ALTER TABLE "TwoFactorSecret" ADD CONSTRAINT "TwoFactorSecret_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TwoFactorBackupCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoFactorBackupCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TwoFactorBackupCode_userId_idx" ON "TwoFactorBackupCode"("userId");

ALTER TABLE "TwoFactorBackupCode" ADD CONSTRAINT "TwoFactorBackupCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
