-- CreateTable
CREATE TABLE "AgencySettings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'DezaAI',
    "logoLightUrl" TEXT,
    "logoDarkUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2DD4D9',
    "customDomain" TEXT,
    "supportLabel" TEXT,
    "supportUrl" TEXT,
    "senderName" TEXT,
    "loginBgUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencySettings_pkey" PRIMARY KEY ("id")
);
