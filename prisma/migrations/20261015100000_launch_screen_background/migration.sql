-- The launch screen's background: the brand colour, or white when that reads
-- better against the clinic's logo. See prisma/schema.prisma (TenantBranding).
ALTER TABLE "TenantBranding" ADD COLUMN "launchBackground" TEXT NOT NULL DEFAULT 'brand';
