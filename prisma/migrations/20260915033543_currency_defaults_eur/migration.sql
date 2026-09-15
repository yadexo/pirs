-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "TenantBranding" ALTER COLUMN "currency" SET DEFAULT 'EUR';
