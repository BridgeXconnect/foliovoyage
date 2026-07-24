-- CreateTable
CREATE TABLE "ProviderLocation" (
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'viator',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "name" TEXT,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderLocation_pkey" PRIMARY KEY ("reference")
);
