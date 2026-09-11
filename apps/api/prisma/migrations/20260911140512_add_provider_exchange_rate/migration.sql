-- CreateTable
CREATE TABLE "ProviderExchangeRate" (
    "provider" TEXT NOT NULL DEFAULT 'viator',
    "sourceCurrency" TEXT NOT NULL,
    "targetCurrency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderExchangeRate_pkey" PRIMARY KEY ("provider","sourceCurrency","targetCurrency")
);
