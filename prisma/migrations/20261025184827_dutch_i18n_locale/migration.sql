-- CreateEnum
CREATE TYPE "Formality" AS ENUM ('INFORMAL', 'FORMAL');

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "clientFormality" "Formality" NOT NULL DEFAULT 'INFORMAL',
ADD COLUMN     "defaultClientLocale" TEXT NOT NULL DEFAULT 'nl';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'nl';
