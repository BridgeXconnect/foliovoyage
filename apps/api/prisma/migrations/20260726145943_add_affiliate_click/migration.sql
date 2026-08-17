-- CreateTable
CREATE TABLE "AffiliateClick" (
    "id" BIGSERIAL NOT NULL,
    "tourId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "sessionId" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AffiliateClick_createdAt_idx" ON "AffiliateClick"("createdAt");
