-- CreateEnum
CREATE TYPE "TourCopyStatus" AS ENUM ('published', 'failed');

-- CreateTable
CREATE TABLE "TourCopy" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "status" "TourCopyStatus" NOT NULL,
    "aiSummary" TEXT,
    "groundingHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "failureReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TourCopy_tourId_key" ON "TourCopy"("tourId");

-- AddForeignKey
ALTER TABLE "TourCopy" ADD CONSTRAINT "TourCopy_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE CASCADE ON UPDATE CASCADE;
