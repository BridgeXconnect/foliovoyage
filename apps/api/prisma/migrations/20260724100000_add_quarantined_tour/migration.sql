-- CreateTable
CREATE TABLE "QuarantinedTour" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTourId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "reasonCodes" TEXT[],
    "reasons" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "quarantinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuarantinedTour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuarantinedTour_provider_providerTourId_idx" ON "QuarantinedTour"("provider", "providerTourId");
