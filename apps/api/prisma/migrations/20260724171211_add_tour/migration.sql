-- CreateTable
CREATE TABLE "Tour" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTourId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER,
    "ratingAvg" DOUBLE PRECISION,
    "ratingCount" INTEGER,
    "priceMinor" INTEGER,
    "currency" TEXT,
    "affiliateUrl" TEXT,
    "locationRef" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tour_provider_deletedAt_idx" ON "Tour"("provider", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tour_provider_providerTourId_key" ON "Tour"("provider", "providerTourId");
