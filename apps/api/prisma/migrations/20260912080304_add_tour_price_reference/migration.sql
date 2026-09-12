-- AlterTable
ALTER TABLE "Tour" ADD COLUMN     "priceReferenceCurrency" TEXT DEFAULT 'USD',
ADD COLUMN     "priceReferenceMinor" BIGINT;
